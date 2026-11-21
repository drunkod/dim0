import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { z } from "zod";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { auth } from "./private-auth/auth.ts";
import {
  listCanvasEntities, getCanvasEntity, createCanvasEntity,
  updateCanvasEntity, deleteCanvasEntity,
  CanvasPermissionDenied, CanvasConflict, CanvasInvalid, type CanvasPayload,
} from "./canvas-entity-service.ts";
import {
  changePrivateNote, createMcpNote, DemoBoardMissing, PrivatePermissionDenied,
  readBoard, RequestIdConflict, requirePrivateBoardAccess,
} from "./board-service.ts";

const boardIdSchema = z.string().uuid();
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
    return json({ signedIn: true, id: session.user.id, accountId, name: session.user.name });
  }
  if (!session) return json({ error: "Sign in required" }, 401);
  const accountId = await jazzAccountFor(session.user.id);

  try {
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
      }).strict().parse(await safeJson(request));
      const board = await db.one(app.boards.where({ id: parsed.board_id }));
      if (!board || board.ownerId !== accountId) return json({ error: "Only owner may invite" }, 403);
      const token = randomBytes(32).toString("base64url");
      const hash = createHash("sha256").update(token).digest("hex");
      const expiry = Date.now() + 7 * 86_400_000;
      const pending = db.insert(app.boardInvites, {
        boardId: parsed.board_id,
        token: hash, // digest only; plaintext is never placed in Jazz
        role: parsed.role,
        singleUse: true,
        expiresAtEpochMs: expiry,
      });
      await pending.wait({ tier: "global", timeoutMs: 10000 });
      const inviteUrl = new URL("/patchboard-private/", request.url);
      inviteUrl.searchParams.set("board", parsed.board_id);
      inviteUrl.searchParams.set("invite", token);
      return json({ invite_url: inviteUrl.href, expires_at: expiry, role: parsed.role }, 201);
    }
    if (pathname === "/patchboard-private/api/join" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, token: inviteSchema,
      }).strict().parse(await safeJson(request));
      const digest = createHash("sha256").update(parsed.token).digest("hex");
      try {
        const write = await db.serializableTransaction(async (tx) => {
          const invite = await tx.one(app.boardInvites.where({
            boardId: parsed.board_id, token: digest,
          }));
          if (!invite || !invite.singleUse || !invite.expiresAtEpochMs ||
              invite.expiresAtEpochMs < Date.now() ||
              (invite.intendedUserId && invite.intendedUserId !== accountId)) {
            throw new Error("INVITE_INVALID");
          }
          if (await tx.one(app.boardMembers.where({
            boardId: parsed.board_id, userId: accountId,
          }))) throw new Error("INVITE_INVALID");
          const board = await tx.one(app.boards.where({ id: parsed.board_id }));
          if (!board) throw new Error("INVITE_INVALID");
          const membershipId = randomUUID();
          tx.insert(app.boardMembers, {
            boardId: parsed.board_id, userId: accountId,
            role: invite.role,
          }, { id: membershipId });
          tx.delete(app.boardInvites, invite.id);
          return membershipId;
        });
        await write.wait({ timeoutMs: 10000 });
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
    // Dim0 canvas transport: all entities are persisted in Jazz and scoped to the
    // Better Auth account, never to an arbitrary actor ID supplied by the browser.
    if (pathname === "/patchboard-private/api/canvas" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      return json({ board_id: boardId, entities: await listCanvasEntities(db, boardId, accountId) });
    }
    if (pathname === "/patchboard-private/api/canvas/entity" && request.method === "GET") {
      const boardId = boardIdSchema.parse(url.searchParams.get("board_id"));
      const entityId = boardIdSchema.parse(url.searchParams.get("entity_id"));
      return json(await getCanvasEntity(db, boardId, accountId, entityId));
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
    if (pathname === "/patchboard-private/api/canvas/update" && request.method === "POST") {
      const parsed = z.object({
        board_id: boardIdSchema, entity_id: boardIdSchema,
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
        board_id: boardIdSchema, entity_id: boardIdSchema,
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
    if (error instanceof CanvasInvalid) return json({ error: "Invalid canvas payload" }, 400);
    // Intentionally do not expose internal Jazz or Better Auth errors over HTTP.
    return json({ error: "Private operation failed" }, 503);
  }
}
