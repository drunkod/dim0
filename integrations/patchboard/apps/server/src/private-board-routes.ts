import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { auth } from "./private-auth/auth.ts";
import { privateAuthDatabase } from "./private-auth/db.ts";
import { memberDisplayNames, tryRememberJazzMemberIdentity } from "./private-auth/member-directory.ts";
import { listPrivateBoards } from "./private-auth/grants.ts";
import { privateAccountProfileRequest } from "./account-adapters/profile-routes.ts";
import { changeNativeBoardMemberRole } from "./account-adapters/board-member-role.ts";
import { claimBearerInvitation } from "./account-adapters/bearer-invitation-claim.ts";
import { BoardRoleChangeError } from "@patchboard/account-domain/native-board-member";
import {
  canvasEntityIdPattern, canvasBoardRole, listCanvasEntities, getCanvasEntity, createCanvasEntity,
  updateCanvasEntity, deleteCanvasEntity,
  CanvasPermissionDenied, CanvasConflict, CanvasInvalid, type CanvasPayload,
} from "./canvas-entity-service.ts";
import { getSharedAppletState, saveSharedAppletState } from "./applet-state-service.ts";
import { patchCanvasLabelMarkdown, CanvasPatchRequestConflict, CanvasPatchCommitUnknown } from "./canvas-versioned-patch.ts";
import {
  patchTypedRecord,readTypedRecord,
  TypedRecordPermissionDenied,TypedRecordGuardDenied,
  TypedRecordFieldInvalid,TypedRecordSchemaConflict,
  TypedRecordVersionConflict,TypedRecordRequestConflict,
  TypedRecordCommitUnknown
} from "./typed-record-patch.ts";
import {qaHttpsCatalogBoardAllowed,qaHttpsCatalogProfile} from "./qa-https-catalog-profile.ts";
import {typedRecordQaEnabled} from "./typed-record-qa-gate.ts";
import {createTextTable,addTextRow,
  TypedCatalogInvalid,TypedCatalogConflict,
  TypedCatalogLimit,TypedCatalogCommitUnknown
} from "./typed-catalog.ts";
import {
  createSavedTypedView,changeSavedTypedView,issueTypedViewShare,
  revokeTypedViewShare,querySavedTypedView,
  listOwnerSavedTypedViews,listOwnerTypedViewShares,
  TypedViewAccessDenied,TypedViewUnsupported,TypedViewCursorChanged,
  TypedViewNotFound,TypedViewVersionConflict
} from "./typed-shared-view.ts";
import {
  changePrivateNote, createMcpNote, DemoBoardMissing, PrivatePermissionDenied,
  readBoard, RequestIdConflict, requirePrivateBoardAccess,
} from "./board-service.ts";

const boardIdSchema = z.string().uuid();
const entityIdSchema = z.string().regex(canvasEntityIdPattern);
const textSchema = z.string().trim().min(1).max(2000);
const requestSchema = z.string().trim().min(1).max(128);
const inviteSchema = z.string().regex(/^[\w-]{43}$/);
const positionSchema = z.number().finite().min(0).max(10000);
const canvasPayloadSchema = z.record(z.string(), z.unknown())
  .transform((value): CanvasPayload => value as CanvasPayload);
const safeJson = async (request: Request, maxBytes = 16_384) => {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Request too large");
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes) throw new Error("Request too large");
  return JSON.parse(raw) as unknown;
};
const noStore = { "cache-control": "no-store", "referrer-policy": "no-referrer" };
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: noStore });

/** Only trusted server-side Better Auth sessions may execute private commands. */
export async function privateBoardRequest(
  request: Request,
  db: Db,
  jazzAccountFor: (subject: string) => Promise<string>,
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  if (!pathname.startsWith("/patchboard-private/api/")) return json({ error: "Not found" }, 404);
  const session = await auth.api.getSession({ headers: request.headers });
  if (pathname === "/patchboard-private/api/me" && request.method === "GET") {
    if (!session) return json({ signedIn: false });
    const accountId = await jazzAccountFor(session.user.id);
    tryRememberJazzMemberIdentity(privateAuthDatabase, accountId, session.user.id);
    return json({ signedIn: true, id: session.user.id, accountId, name: session.user.name });
  }
  // Match Dim0's original share-link contract: a holder of the
  // fragment-borne secret may preview the invite BEFORE registering.
  // The digest is checked without consuming the link or creating a grant.
  // Keep private board and account endpoints session-protected.
  if (pathname === "/patchboard-private/api/invites/preview" && request.method === "POST") {
    try {
      const parsed = z.object({
        board_id: boardIdSchema, token: inviteSchema,
      }).strict().parse(await safeJson(request));
      const digest = createHash("sha256").update(parsed.token).digest("hex");
      const invite = await db.one(app.boardInvites.where({
        boardId: parsed.board_id, token: digest,
      }));
      if (!invite || (invite.expiresAtEpochMs !== null &&
          invite.expiresAtEpochMs < Date.now())) {
        return json({ error: "Invitation expired or revoked" }, 404);
      }
      return json({ role: invite.role });
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError) {
        return json({ error: "Invalid invitation request" }, 400);
      }
      throw error;
    }
  }
  if (!session) return json({ error: "Sign in required" }, 401);
  // Self-service profile/locale use the verified Better Auth subject but do
  // not require Jazz network availability just to edit display preferences.
  const profileResponse = await privateAccountProfileRequest(
    request, {id:session.user.id,name:session.user.name},
    privateAuthDatabase(), async (name, headers) => {
      const response = await auth.api.updateUser({headers,body:{name}});
      return response.status === true;
    }
  );
  if (profileResponse) return profileResponse;
  const accountId = await jazzAccountFor(session.user.id);

  try {
    if (pathname === "/patchboard-private/api/boards" && request.method === "GET") {
      return json({ boards: await listPrivateBoards(db, accountId) });
    }
    if (pathname === "/patchboard-private/api/boards" && request.method === "POST") {
      const parsed = z.object({ title: z.string().trim().min(1).max(80) }).strict().parse(await safeJson(request));
      const result = db.insert(app.boards, { title: parsed.title, ownerId: accountId });
      await result.wait({ tier: "global", timeoutMs: 10000 });
      return json({ board_id: result.value.id, title: parsed.title }, 201);
    }
    if (pathname === "/patchboard-private/api/invite" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema,
        role: z.enum(["editor", "viewer"]),
        reusable: z.boolean().optional().default(false),
      }).strict().parse(await safeJson(request));
      const board = await db.one(app.boards.where({ id: parsed.board_id }));
      if (!board || board.ownerId !== accountId) return json({ error: "Only owner may invite" }, 403);
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      // Original Dim0 reusable links stay active until the owner revokes
      // them; only single-use links have the 7-day expiration policy.
      const expiry = parsed.reusable ? null : Date.now() + 7 * 86_400_000;
      const pending = db.insert(app.boardInvites, {
        boardId: parsed.board_id,
        token: hash, // digest only; plaintext is never placed in Jazz
        role: parsed.role,
        singleUse: !parsed.reusable,
        expiresAtEpochMs: expiry,
      });
      await pending.wait({ tier: "global", timeoutMs: 10000 });
      // The original single-use Patchboard invite URL remains backwards-compatible.
      // Reusable group invites land directly on Dim0 Canvas after the passkey join.
      const inviteUrl = new URL(parsed.reusable
        ? "/share/join/" + parsed.board_id : "/patchboard-private/", request.url);
      if (parsed.reusable) inviteUrl.hash = "invite=" + encodeURIComponent(token);
      else {
        inviteUrl.searchParams.set("board", parsed.board_id);
        inviteUrl.searchParams.set("invite", token);
      }
      return json({ invite_url: inviteUrl.href, expires_at: expiry,
        role: parsed.role, reusable: parsed.reusable, invite_id: pending.value.id }, 201);
    }
    if (pathname === "/patchboard-private/api/invites" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const board = await db.one(app.boards.where({ id: boardId }));
      if (!board || board.ownerId !== accountId) return json({ error: "Only owner may manage sharing" }, 403);
      const rows = await db.all(app.boardInvites.where({ boardId }).limit(200));
      // Only opaque IDs and metadata leave the server, never stored invite digests.
      return json({ invites: rows.filter((row) =>
        row.expiresAtEpochMs === null || row.expiresAtEpochMs > Date.now())
        .map((row) => ({ id: row.id, role: row.role, reusable: !row.singleUse,
          expires_at: row.expiresAtEpochMs })) });
    }
    if (pathname === "/patchboard-private/api/invites/revoke-all" && request.method === "POST") {
      const { board_id } = z.object({ board_id: boardIdSchema }).strict().parse(await safeJson(request));
      const result = await db.serializableTransaction(async (tx) => {
        const board = await tx.one(app.boards.where({ id: board_id }));
        if (!board || board.ownerId !== accountId) throw new PrivatePermissionDenied();
        const invites = await tx.all(app.boardInvites.where({ boardId: board_id }));
        for (const invite of invites) tx.delete(app.boardInvites, invite.id);
        return invites.length;
      });
      await result.wait({ timeoutMs: 10000 });
      return json({ revoked_count: result.value });
    }
    if (pathname === "/patchboard-private/api/invites/revoke" && request.method === "POST") {
      const parsed = z.object({ board_id: boardIdSchema, invite_id: boardIdSchema })
        .strict().parse(await safeJson(request));
      const write = await db.serializableTransaction(async (tx) => {
        const board = await tx.one(app.boards.where({ id: parsed.board_id }));
        if (!board || board.ownerId !== accountId) throw new PrivatePermissionDenied();
        const invite = await tx.one(app.boardInvites.where({
          id: parsed.invite_id, boardId: parsed.board_id,
        }));
        if (invite) tx.delete(app.boardInvites, invite.id);
        return Boolean(invite);
      });
      await write.wait({ timeoutMs: 10000 });
      return json({ revoked: write.value });
    }
    if (pathname === "/patchboard-private/api/members" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const board = await db.one(app.boards.where({ id: boardId }));
      if (!board || board.ownerId !== accountId) return json({ error: "Only owner may manage members" }, 403);
      const rows = await db.all(app.boardMembers.where({ boardId }).limit(200));
      const members = [{ id: board.ownerId, role: "owner", role_version: null },
        ...rows.map((row) => ({ id: row.userId, role: row.role,
          role_version: row.roleVersion }))];
      // Server-side owner-only join, scoped strictly to existing Jazz grants.
      // No arbitrary user-profile lookup or email address is exposed.
      const names = memberDisplayNames(privateAuthDatabase(), members.map((member) => member.id));
      return json({ members: members.map((member) => ({
        ...member, name: names.get(member.id) ?? null,
      })) });
    }
    if (pathname === "/patchboard-private/api/members/role" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, user_id: boardIdSchema,
        role: z.enum(["editor", "viewer"]),
        expected_version: z.number().int().positive(),
        request_id: requestSchema,
      }).strict().parse(await safeJson(request));
      // Existing route has already obtained a VERIFIED Better Auth session
      // and original server.jazz.createAccountFor(subject) Jazz actor.
      try {
        const result = await changeNativeBoardMemberRole(db, accountId, {
          boardId: parsed.board_id, memberId: parsed.user_id,
          assignedRole: parsed.role,
          expectedVersion: parsed.expected_version,
          requestId: parsed.request_id,
        });
        return json({
          user_id: result.memberId, previous_role: result.previousRole,
          assigned_role: result.assignedRole,
          role_version: result.membershipVersion,
          changed: result.changed, receipt_id: result.receiptId,
        });
      } catch (error) {
        if (error instanceof BoardRoleChangeError) {
          return json({ error: error.code },
            error.code === "FORBIDDEN" ? 403 :
            error.code === "MEMBER_NOT_FOUND" ? 404 : 409);
        }
        throw error;
      }
    }
    if (pathname === "/patchboard-private/api/members/remove" && request.method === "POST") {
      const parsed = z.object({ board_id: boardIdSchema, user_id: boardIdSchema })
        .strict().parse(await safeJson(request));
      const write = await db.serializableTransaction(async (tx) => {
        const board = await tx.one(app.boards.where({ id: parsed.board_id }));
        if (!board || board.ownerId !== accountId ||
            parsed.user_id === board.ownerId) throw new PrivatePermissionDenied();
        const member = await tx.one(app.boardMembers.where({
          boardId: parsed.board_id, userId: parsed.user_id,
        }));
        if (member) tx.delete(app.boardMembers, member.id);
        return Boolean(member);
      });
      await write.wait({ timeoutMs: 10000 });
      return json({ removed: write.value });
    }
    if (pathname === "/patchboard-private/api/join" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, token: inviteSchema,
      }).strict().parse(await safeJson(request));
      const digest = createHash("sha256").update(parsed.token).digest("hex");
      try {
        // The server-only claim command shares one authoritative transaction
        // with the owner-role CAS contract and is exercised by its own tests.
        await claimBearerInvitation(db, parsed.board_id, digest, accountId);
        return json({ joined: true, board_id: parsed.board_id }, 200);
      } catch (error) {
        if (String(error).includes("INVITE_INVALID")) return json({ error: "Invite invalid, used or expired" }, 404);
        throw error;
      }
    }
    if (pathname === "/patchboard-private/api/board" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      await requirePrivateBoardAccess(db, boardId, accountId);
      const board = await Effect.runPromise(readBoard(db, boardId));
      return json(board);
    }
    if (pathname === "/patchboard-private/api/note" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, text: textSchema, request_id: requestSchema,
      }).strict().parse(await safeJson(request));
      const created = await Effect.runPromise(createMcpNote(db, {
        boardId: parsed.board_id,
        text: parsed.text,
        requestId: parsed.request_id,
        actorId: accountId, // derived solely from Better Auth, never client input
        authorName: session.user.name,
      }));
      return json(created, 201);
    }
    if (pathname === "/patchboard-private/api/note/update" && request.method === "POST") {
      const parsed = z.object({
        note_id: boardIdSchema, text: textSchema,
      }).strict().parse(await safeJson(request));
      return json(await changePrivateNote(db, {
        noteId: parsed.note_id, actorId: accountId, fields: { text: parsed.text },
      }));
    }
    if (pathname === "/patchboard-private/api/note/move" && request.method === "POST") {
      const parsed = z.object({
        note_id: boardIdSchema, x: positionSchema, y: positionSchema,
      }).strict().parse(await safeJson(request));
      return json(await changePrivateNote(db, {
        noteId: parsed.note_id, actorId: accountId,
        fields: { x: parsed.x, y: parsed.y },
      }));
    }
    // Isolated applet runtime values live in their own Jazz rows, with
    // independent optimistic versions from the board geometry.
    if (pathname === "/patchboard-private/api/applet-state" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const noteId = entityIdSchema.parse(url.searchParams.get("note_id"));
      return json(await getSharedAppletState(db, boardId, accountId, noteId));
    }
    if (pathname === "/patchboard-private/api/applet-state" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, note_id: entityIdSchema,
        expected_version: z.number().int().nonnegative(),
        value: z.record(z.string(), z.unknown()),
      }).strict().parse(await safeJson(request, 20_480));
      return json(await saveSharedAppletState(db, {
        boardId: parsed.board_id, noteId: parsed.note_id,
        actorId: accountId, expectedVersion: parsed.expected_version, value: parsed.value,
      }));
    }
    // The SAME QA-gated server catalog API is used by browser controls and
    // isolated server-domain tests. Neither HTTP DTO permits actor or IDs.
    if(pathname==="/patchboard-private/api/records/tables/create" &&
      request.method==="POST"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const parsed=z.object({
        board_id:boardIdSchema,
        request_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        name:z.string(),primary_field_name:z.string(),
        default_view_name:z.string()
      }).strict().parse(await safeJson(request));
      return json(await createTextTable(db,{
        boardId:parsed.board_id,actorId:accountId,
        requestId:parsed.request_id,name:parsed.name,
        primaryFieldName:parsed.primary_field_name,
        defaultViewName:parsed.default_view_name
      }),201);
    }
    if(pathname==="/patchboard-private/api/records/rows/create" &&
      request.method==="POST"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const parsed=z.object({
        board_id:boardIdSchema,dataset_id:boardIdSchema,
        request_id:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
        schema_version:z.number().int().positive(),field_id:boardIdSchema,
        value:z.string().max(2000)
      }).strict().parse(await safeJson(request));
      return json(await addTextRow(db,{
        boardId:parsed.board_id,datasetId:parsed.dataset_id,
        actorId:accountId,requestId:parsed.request_id,
        schemaVersion:parsed.schema_version,
        fieldId:parsed.field_id,value:parsed.value
      }),201);
    }
    // QA only: owner Data picker and share-management metadata. This GET
    // never exposes token hashes, records, credentials or member lists.
    if(pathname==="/patchboard-private/api/records/views" &&
      request.method==="GET"){
      if(!typedRecordQaEnabled()&&!qaHttpsCatalogProfile())return json({error:"Not found"},404);
      const boardId=boardIdSchema.parse(url.searchParams.get("board_id"));
      if(!typedRecordQaEnabled()&&!qaHttpsCatalogBoardAllowed(boardId))return json({error:"Not found"},404);
      return json(await listOwnerSavedTypedViews(db,{
        boardId,actorId:accountId
      }));
    }
    if(pathname==="/patchboard-private/api/records/views/shares" &&
      request.method==="GET"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const boardId=boardIdSchema.parse(url.searchParams.get("board_id"));
      const datasetId=boardIdSchema.parse(url.searchParams.get("dataset_id"));
      const viewId=boardIdSchema.parse(url.searchParams.get("view_id"));
      return json(await listOwnerTypedViewShares(db,privateAuthDatabase(),{
        boardId,datasetId,viewId,actorId:accountId
      }));
    }
    // Dim0 canvas transport: all entities are persisted in Jazz and scoped to the
    // Better Auth account, never to an arbitrary actor ID supplied by the browser.
    if (pathname === "/patchboard-private/api/canvas" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const role = await canvasBoardRole(db, boardId, accountId);
      return json({ board_id: boardId, role, entities: await listCanvasEntities(db, boardId, accountId) });
    }
    if (pathname === "/patchboard-private/api/canvas/entity" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const entityId = entityIdSchema.parse(url.searchParams.get("entity_id"));
      return json(await getCanvasEntity(db, boardId, accountId, entityId));
    }
    // First typed relational-record vertical slice: disabled except for a
    // disposable loopback CI issuer with explicit opt-in. No old OAuth scope
    // gains a new live capability from this browser route.
    // One persisted typed read view; its credential never joins the board
    // membership table. All routes are disposable-QA opt-in only.
    if(pathname.startsWith("/patchboard-private/api/records/views/") &&
      request.method==="POST"){
      if(!typedRecordQaEnabled()&&(!qaHttpsCatalogProfile()||
        pathname!=="/patchboard-private/api/records/views/owner-query"))return json({error:"Not found"},404);
      const definition=z.object({
        name:z.string().trim().min(1).max(80),
        allowed_field_ids:z.array(boardIdSchema).min(1).max(20),
        filter:z.object({
          op:z.literal("text_prefix"),field_id:boardIdSchema,
          value:z.string().max(80)
        }).strict(),
        sort:z.object({
          field_id:boardIdSchema,direction:z.enum(["asc","desc"])
        }).strict(),
      }).strict();
      const viewRef={
        board_id:boardIdSchema,dataset_id:boardIdSchema,view_id:boardIdSchema
      };
      const toDefinition=(value:z.infer<typeof definition>)=>({
        name:value.name,allowedFieldIds:value.allowed_field_ids,
        filter:{op:value.filter.op,fieldId:value.filter.field_id,
          value:value.filter.value},
        sort:{fieldId:value.sort.field_id,
          direction:value.sort.direction}
      });
      if(pathname.endsWith("/owner-query")){
        const input=z.object({...viewRef,
          page_size:z.number().int().min(1).max(20),
          cursor:z.string().max(20000).optional(),
        }).strict().parse(await safeJson(request,32_000));
        if(!typedRecordQaEnabled()&&!qaHttpsCatalogBoardAllowed(input.board_id))return json({error:"Not found"},404);
        return json(await querySavedTypedView(db,privateAuthDatabase(),{
          boardId:input.board_id,datasetId:input.dataset_id,
          viewId:input.view_id,ownerActorId:accountId,
          verifiedSubjectId:session.user.id,channel:"browser",
          pageSize:input.page_size,cursor:input.cursor
        }));
      }
      if(pathname.endsWith("/create")){
        const input=z.object({
          board_id:boardIdSchema,dataset_id:boardIdSchema,
          definition
        }).strict().parse(await safeJson(request));
        return json(await createSavedTypedView(db,{
          boardId:input.board_id,datasetId:input.dataset_id,
          actorId:accountId,definition:toDefinition(input.definition)
        }),201);
      }
      if(pathname.endsWith("/revise")){
        const input=z.object({...viewRef,
          expected_version:z.number().int().positive(),definition
        }).strict().parse(await safeJson(request));
        return json(await changeSavedTypedView(db,{
          boardId:input.board_id,datasetId:input.dataset_id,
          viewId:input.view_id,expectedVersion:input.expected_version,
          actorId:accountId,definition:toDefinition(input.definition)
        }));
      }
      if(pathname.endsWith("/share")){
        const input=z.object(viewRef).strict().parse(await safeJson(request));
        return json(await issueTypedViewShare(db,privateAuthDatabase(),{
          boardId:input.board_id,datasetId:input.dataset_id,
          viewId:input.view_id,actorId:accountId,
          verifiedSubjectId:session.user.id
        }),201);
      }
      if(pathname.endsWith("/revoke")){
        const input=z.object({...viewRef,
          share_id:boardIdSchema,
          expected_version:z.number().int().positive()
        }).strict().parse(await safeJson(request));
        return json(await revokeTypedViewShare(db,privateAuthDatabase(),{
          boardId:input.board_id,datasetId:input.dataset_id,
          viewId:input.view_id,actorId:accountId,
          shareId:input.share_id,expectedVersion:input.expected_version
        }));
      }
      if(pathname.endsWith("/query")){
        const input=z.object({...viewRef,
          share_token:z.string().min(1).max(80),
          page_size:z.number().int().min(1).max(20),
          cursor:z.string().max(20000).optional(),
          record_id:boardIdSchema.optional(),
          requested_field_ids:z.array(boardIdSchema).min(1).max(20).optional(),
          requested_sort_field_id:boardIdSchema.optional(),
          requested_filter_field_id:boardIdSchema.optional(),
        }).strict().parse(await safeJson(request,32_000));
        return json(await querySavedTypedView(db,privateAuthDatabase(),{
          boardId:input.board_id,datasetId:input.dataset_id,
          viewId:input.view_id,shareToken:input.share_token,
          verifiedSubjectId:session.user.id,channel:"browser",
          pageSize:input.page_size,cursor:input.cursor,recordId:input.record_id,
          requestedFieldIds:input.requested_field_ids,
          requestedSortFieldId:input.requested_sort_field_id,
          requestedFilterFieldId:input.requested_filter_field_id
        }));
      }
    }
    if(pathname==="/patchboard-private/api/records/dataset"&&
      request.method==="GET"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const boardId=boardIdSchema.parse(url.searchParams.get("board_id"));
      const datasetId=boardIdSchema.parse(url.searchParams.get("dataset_id"));
      const board=await db.one(app.boards.where({id:boardId}));
      if(!board||board.ownerId!==accountId)
        throw new TypedViewAccessDenied();
      const dataset=await db.one(app.typedDatasets.where({id:datasetId}));
      if(!dataset||dataset.boardId!==boardId)
        throw new TypedViewAccessDenied();
      const records=await db.all(app.typedRecords.where({datasetId}).limit(501));
      if(records.length>500||records.some(r=>r.boardId!==boardId))
        throw new TypedViewUnsupported("VIEW_DATASET_LIMIT_500");
      const fields=await db.all(app.typedFields.where({datasetId}).limit(101));
      if(fields.length>100||fields.some(f=>f.boardId!==boardId))
        throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
      return json({boardId,datasetId,
        fields:fields.map(f=>({id:f.id,name:f.name,kind:f.kind})),
        records:records.map(r=>({id:r.id,version:r.version,cells:r.cells}))});
    }
    if(pathname==="/patchboard-private/api/records/record" &&
      request.method==="GET"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const boardId=boardIdSchema.parse(url.searchParams.get("board_id"));
      const datasetId=boardIdSchema.parse(url.searchParams.get("dataset_id"));
      const recordId=boardIdSchema.parse(url.searchParams.get("record_id"));
      return json(await readTypedRecord(db,{
        boardId,datasetId,recordId,actorId:accountId
      }));
    }
    if(pathname==="/patchboard-private/api/records/patch" &&
      request.method==="POST"){
      if(!typedRecordQaEnabled())return json({error:"Not found"},404);
      const parsed=z.object({
        board_id:boardIdSchema,dataset_id:boardIdSchema,record_id:boardIdSchema,
        schema_version:z.number().int().positive(),
        expected_version:z.number().int().positive(),
        request_id:requestSchema,
        set:z.record(boardIdSchema,z.union([
          z.string().max(2000),z.number().finite(),z.boolean(),z.null()
        ]))
      }).strict().parse(await safeJson(request,20_480));
      return json(await patchTypedRecord(db,{
        boardId:parsed.board_id,datasetId:parsed.dataset_id,
        recordId:parsed.record_id,actorId:accountId,
        schemaVersion:parsed.schema_version,
        expectedVersion:parsed.expected_version,
        requestId:parsed.request_id,set:parsed.set
      }));
    }
    if (pathname === "/patchboard-private/api/canvas/create" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, kind: z.enum(["node", "link"]),
        payload: canvasPayloadSchema,
      }).strict().parse(await safeJson(request, 131_072));
      return json(await createCanvasEntity(db, {
        boardId: parsed.board_id, actorId: accountId, kind: parsed.kind, payload: parsed.payload,
      }), 201);
    }
    if (pathname === "/patchboard-private/api/canvas/patch" && request.method === "POST") {
      const parsed=z.object({
        board_id:boardIdSchema,entity_id:entityIdSchema,
        expected_version:z.number().int().positive(),request_id:requestSchema,
        field_patch:z.object({label_markdown:z.string().max(2000)}).strict()
      }).strict().parse(await safeJson(request, 20_480));
      return json(await patchCanvasLabelMarkdown(db,{
        boardId:parsed.board_id,actorId:accountId,id:parsed.entity_id,
        expectedVersion:parsed.expected_version,requestId:parsed.request_id,
        patch:parsed.field_patch
      }));
    }
    if (pathname === "/patchboard-private/api/canvas/update" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, entity_id: entityIdSchema,
        expected_version: z.number().int().positive(),
        payload: canvasPayloadSchema,
      }).strict().parse(await safeJson(request, 131_072));
      return json(await updateCanvasEntity(db, {
        boardId: parsed.board_id, actorId: accountId, id: parsed.entity_id,
        expectedVersion: parsed.expected_version, payload: parsed.payload,
      }));
    }
    if (pathname === "/patchboard-private/api/canvas/delete" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, entity_id: entityIdSchema,
        expected_version: z.number().int().positive(),
      }).strict().parse(await safeJson(request));
      return json(await deleteCanvasEntity(db, {
        boardId: parsed.board_id, actorId: accountId, id: parsed.entity_id,
        expectedVersion: parsed.expected_version,
      }));
    }
    return json({ error: "Not found" }, 404);
  } catch (error) {
    if (error instanceof z.ZodError || error instanceof SyntaxError) return json({ error: "Invalid input" }, 400);
    if (error instanceof PrivatePermissionDenied) return json({ error: "Not authorized" }, 403);
    if (error instanceof DemoBoardMissing) return json({ error: "Board unavailable" }, 404);
    if (error instanceof RequestIdConflict) return json({ error: "Request ID conflict" }, 409);
    if (error instanceof CanvasPermissionDenied) return json({ error: "Canvas access denied" }, 403);
    if (error instanceof CanvasConflict) return json({ error: "Canvas version conflict" }, 409);
    if (error instanceof CanvasPatchRequestConflict) return json({error:"Request ID conflict"},409);
    if (error instanceof CanvasPatchCommitUnknown) return json({error:"Commit outcome unknown",request_id:error.requestId,retry_same_request_only:true},503);
    if (error instanceof CanvasInvalid) return json({ error: "Invalid canvas payload" }, 400);
    if(error instanceof TypedCatalogInvalid)return json({error:error.message},400);
    if(error instanceof TypedCatalogConflict)return json({error:error.message},409);
    if(error instanceof TypedCatalogLimit)return json({error:error.message},409);
    if(error instanceof TypedCatalogCommitUnknown)
      return json({error:error.message,request_id:error.requestId,
        retry_same_request_only:true},503);
    if(error instanceof TypedViewAccessDenied)return json({error:error.message},403);
    if(error instanceof TypedViewNotFound)return json({error:error.message},404);
    if(error instanceof TypedViewCursorChanged ||
      error instanceof TypedViewVersionConflict)
      return json({error:error.message},409);
    if(error instanceof TypedViewUnsupported)return json({error:error.message},400);
    if(error instanceof TypedRecordPermissionDenied)return json({error:"TYPED_RECORD_ACCESS_DENIED"},403);
    if(error instanceof TypedRecordGuardDenied)return json({error:"SERVICE_GUARD_DENIED"},403);
    if(error instanceof TypedRecordFieldInvalid)return json({error:"INVALID_FIELD"},400);
    if(error instanceof TypedRecordSchemaConflict)return json({error:"SCHEMA_VERSION_CONFLICT"},409);
    if(error instanceof TypedRecordVersionConflict)return json({error:"VERSION_CONFLICT"},409);
    if(error instanceof TypedRecordRequestConflict)return json({error:"REQUEST_ID_CONFLICT"},409);
    if(error instanceof TypedRecordCommitUnknown)return json({error:"COMMIT_OUTCOME_UNKNOWN",
      request_id:error.requestId,retry_same_request_only:true},503);
    // Intentionally do not expose internal Jazz or Better Auth errors over HTTP.
    return json({ error: "Private operation failed" }, 503);
  }
}
