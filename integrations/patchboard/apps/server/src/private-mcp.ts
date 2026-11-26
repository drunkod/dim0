import type { IncomingMessage, ServerResponse } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";
import { access, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { requireMcpAuth } from "@better-auth/mcp";
import { Effect } from "effect";
import { z } from "zod";
import { PersistedWriteRejectedError, type Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import {
  createMcpNote, DemoBoardMissing, PrivatePermissionDenied,
  readBoard, RequestIdConflict, requirePrivateBoardAccess,
} from "./board-service.ts";
import { auth } from "./private-auth/auth.ts";
import {
  canvasEntityIdPattern, listCanvasEntities, getCanvasEntity, createCanvasEntity,
  updateCanvasEntity, deleteCanvasEntity,
  CanvasPermissionDenied, CanvasConflict, CanvasInvalid, type CanvasPayload,
} from "./canvas-entity-service.ts";
import { getSharedAppletState, saveSharedAppletState } from "./applet-state-service.ts";
import { patchCanvasLabelMarkdown, canvasPatchOperationIdentity, CanvasPatchRequestConflict, CanvasPatchCommitUnknown } from "./canvas-versioned-patch.ts";
import {typedRecordQaEnabled} from "./typed-record-qa-gate.ts";
import {
  querySavedTypedView,TypedViewAccessDenied,TypedViewUnsupported,
  TypedViewCursorChanged,TypedViewNotFound
} from "./typed-shared-view.ts";
import {
  patchTypedRecord,typedRecordOperationIdentity,TypedRecordPermissionDenied,TypedRecordGuardDenied,
  TypedRecordFieldInvalid,TypedRecordSchemaConflict,TypedRecordVersionConflict,
  TypedRecordRequestConflict,TypedRecordCommitUnknown
} from "./typed-record-patch.ts";
import { privateAuthConfig } from "./private-auth/config.ts";
import { privateAuthDatabase } from "./private-auth/db.ts";
import { requireConsentBoundBoardGrant, type VerifiedBoardGrant } from "./private-auth/grants.ts";
import {
  admitVerifiedMcpGrant, authorizeProtectedMcpInvocation,
  type GrantAdmission,
} from "./account-adapters/grant-admission.ts";
import {
  beginProtectedMcpWriteLease, runReservedMcpWrite,
  type ProtectedMcpWriteLease, type McpLeaseOperation,
} from "./account-adapters/grant-write-drain.ts";

const boardId = z.string().uuid();
const scopes = ["board:read", "board:write"] as const;
const resource = () => privateAuthConfig().origin + "/patchboard-private-mcp";
const errorText = (message: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
});
class CanvasPatchAdmissionRevoked extends Error {}
const output = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});

/** Protocol tools deliberately share backend Jazz commands with the browser API. */
async function executePrivateMcp(
  request: IncomingMessage,
  response: ServerResponse,
  db: Db,
  actorId: string,
  actorName: string,
  grantedScopes: ReadonlySet<string>,
  grant: VerifiedBoardGrant,
  admission: GrantAdmission,
) {
  // The transport can dispatch multiple/delayed callbacks for one HTTP
  // request. Guard EACH callback with the immutable server-minted SQL receipt.
  // It is never accepted from caller parameters or exposed in tool results.
  const writeContext=new AsyncLocalStorage<ProtectedMcpWriteLease>();
  const admitted = (scope: "board:read" | "board:write") =>
    authorizeProtectedMcpInvocation(privateAuthDatabase(),admission,grant,scope,
      Date.now(),scope==="board:write" ? writeContext.getStore()?.id : undefined);
  /** Check again at Jazz write submission, not just transport/callback dispatch. */
  const beforeWriteSubmit = () => {
    if (!admitted("board:write")) throw new CanvasPatchAdmissionRevoked();
  };
  /** Server-only deterministic pause; only disposable localhost CI can enable. */
  const qaPause=async(phase:"admitted"|"leased",requestId?:string)=>{
    const config=privateAuthConfig();
    if(process.env.PATCHBOARD_ACC051_INFLIGHT_QA!=="1" ||
      process.env.PATCHBOARD_OAUTH_CI_RESTART!=="1" ||
      process.env.PATCHBOARD_PRIVATE_DEV!=="1" ||
      !config.root.startsWith(join(tmpdir(),"patchboard-private-ci-")) ||
      !["localhost","127.0.0.1"].includes(new URL(config.origin).hostname) ||
      !requestId || !new RegExp("^qa_inflight_"+phase+"_[a-f0-9]{32}$").test(requestId))return;
    const dir=join(config.root,"acc051-write-pauses");
    await mkdir(dir,{recursive:true,mode:0o700});
    const marker=join(dir,phase+"-"+requestId+".ready");
    const resume=join(dir,phase+"-"+requestId+".resume");
    await writeFile(marker,"ready",{mode:0o600});
    for(let n=0;n<2400;n++){
      try {await access(resume);return;}catch{}
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    throw new Error("ACC051_QA_PAUSE_EXPIRED");
  };
  /** Every write tool reserves a durable SQL drain lease before Jazz work. */
  const withWriteLease=async<T>(action:()=>Promise<T>,requestId?:string,
    operation?:McpLeaseOperation):Promise<T|ReturnType<typeof errorText>>=>{
    await qaPause("admitted",requestId);
    const lease=beginProtectedMcpWriteLease(privateAuthDatabase(),admission,grant,operation);
    if(!lease)return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    return writeContext.run(lease,()=>runReservedMcpWrite(privateAuthDatabase(),lease,async()=>{
      await qaPause("leased",requestId);
      return action();
    }));
  };
  const canRead = () => grantedScopes.has("board:read");
  const canWrite = () => grantedScopes.has("board:write");
  const mcpServer = new McpServer({ name: "patchboard-private", version: "0.1.0" });
  const transport = new StreamableHTTPServerTransport({});

  if (canRead()) mcpServer.registerTool("list_boards", {
    description: "List the single board approved in this OAuth grant.",
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
    if (!admitted("board:read")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (!canRead()) return errorText("INSUFFICIENT_SCOPE: board:read required");
    try {
      await requirePrivateBoardAccess(db, grant.boardId, actorId);
      const board = await db.one(app.boards.where({ id: grant.boardId }));
      return output({ boards: board ? [{ board_id: board.id, title: board.title }] : [], truncated: false });
    } catch { return errorText("BOARD_ACCESS_DENIED"); }
  });

  if (canRead()) mcpServer.registerTool("read_board", {
    description: "Read up to 50 notes on a private board; requires board:read and current board membership.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ board_id: boardId }).strict(),
  }, async ({ board_id }) => {
    if (!admitted("board:read")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (!canRead()) return errorText("INSUFFICIENT_SCOPE: board:read required");
    try {
      if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
      await requirePrivateBoardAccess(db, grant.boardId, actorId);
      return output(await Effect.runPromise(readBoard(db, grant.boardId)));
    } catch (error) {
      return errorText(error instanceof PrivatePermissionDenied
        ? "BOARD_ACCESS_DENIED"
        : error instanceof DemoBoardMissing ? "BOARD_UNAVAILABLE" : "READ_FAILED");
    }
  });

  // A view bearer token only restricts the existing, separately verified
  // board:read OAuth scope. It never creates an OAuth or board membership.
  if(typedRecordQaEnabled() && canRead())mcpServer.registerTool(
    "read_typed_view",{
      description:"QA only: server-filtered saved typed view. Requires live board:read OAuth grant AND separate revocable view share.",
      annotations:{readOnlyHint:true},
      inputSchema:z.object({
        board_id:boardId,dataset_id:boardId,view_id:boardId,
        share_token:z.string().min(1).max(80),
        page_size:z.number().int().min(1).max(20),
        cursor:z.string().max(20000).optional(),
        record_id:boardId.optional(),
        requested_field_ids:z.array(boardId).min(1).max(20).optional(),
        requested_sort_field_id:boardId.optional(),
        requested_filter_field_id:boardId.optional(),
      }).strict()
    },async args=>{
      if(!admitted("board:read"))return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
      if(args.board_id!==grant.boardId)return errorText("BOARD_ACCESS_DENIED");
      try{
        const result=await querySavedTypedView(db,privateAuthDatabase(),{
          boardId:args.board_id,datasetId:args.dataset_id,viewId:args.view_id,
          shareToken:args.share_token,verifiedSubjectId:grant.userId,
          channel:"mcp",pageSize:args.page_size,cursor:args.cursor,
          recordId:args.record_id,requestedFieldIds:args.requested_field_ids,
          requestedSortFieldId:args.requested_sort_field_id,
          requestedFilterFieldId:args.requested_filter_field_id
        });
        if(!admitted("board:read"))return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
        return output(result);
      }catch(error){
        return errorText(error instanceof TypedViewAccessDenied
          ? "VIEW_ACCESS_DENIED"
          : error instanceof TypedViewCursorChanged
          ? "VIEW_CURSOR_REQUIRES_FRESH_QUERY"
          : error instanceof TypedViewNotFound
          ? "RECORD_NOT_IN_VIEW"
          : error instanceof TypedViewUnsupported
          ? error.code:"VIEW_QUERY_FAILED");
      }
    });

  if (canWrite()) mcpServer.registerTool("create_note", {
    description: "Create a note in a private board. Requires board:write and current editor/owner permission; a stable request_id makes retries idempotent.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId,
      text: z.string().trim().min(1).max(2000),
      request_id: z.string().trim().min(1).max(128),
    }).strict(),
  }, async ({ board_id, text, request_id }) => withWriteLease(async()=>{
    if (!admitted("board:write")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (!canWrite()) return errorText("INSUFFICIENT_SCOPE: board:write required");
    try {
      if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
      return output(await Effect.runPromise(createMcpNote(db, {
        boardId: grant.boardId, text, requestId: request_id,
        actorId, authorName: actorName,
      }, beforeWriteSubmit)));
    } catch (error) {
      return errorText(error instanceof CanvasPatchAdmissionRevoked
        ? "GRANT_ADMISSION_EXPIRED_OR_INVALID"
        : error instanceof PrivatePermissionDenied
        ? "BOARD_WRITE_DENIED"
        : error instanceof DemoBoardMissing ? "BOARD_UNAVAILABLE"
        : error instanceof RequestIdConflict ? "REQUEST_ID_CONFLICT"
        : error instanceof PersistedWriteRejectedError ? "WRITE_REJECTED"
        : "WRITE_FAILED: Check read_board before retrying");
    }
  },request_id,{tool:"create_note"}));

  // Dim0 JSON entities remain in Jazz; every tool is scoped to this OAuth grant.
  const canvasFailure = (error: unknown) => errorText(
    error instanceof CanvasPatchAdmissionRevoked ? "GRANT_ADMISSION_EXPIRED_OR_INVALID"
      : error instanceof CanvasPatchRequestConflict ? "REQUEST_ID_CONFLICT"
      : error instanceof CanvasPatchCommitUnknown ? "COMMIT_OUTCOME_UNKNOWN: retry same request_id"
      : error instanceof CanvasPermissionDenied ? "BOARD_ACCESS_DENIED"
      : error instanceof CanvasConflict ? "VERSION_CONFLICT"
      : error instanceof CanvasInvalid ? "INVALID_ENTITY"
      : error instanceof PersistedWriteRejectedError ? "WRITE_REJECTED"
      : "CANVAS_OPERATION_FAILED",
  );
  // Values reached this handler as JSON over HTTP; Zod 3 lacks z.json().
  const canvasEntity = z.record(z.string(), z.unknown()).transform((value): CanvasPayload => value as CanvasPayload);
  const canvasId = z.string().regex(canvasEntityIdPattern);

  if (canRead()) mcpServer.registerTool("list_canvas_entities", {
    description: "List up to 500 Dim0 board nodes and links stored in Jazz.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ board_id: boardId }).strict(),
  }, async ({ board_id }) => {
    if (!admitted("board:read")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      const entities = await listCanvasEntities(db, grant.boardId, actorId);
      return output({ board_id, entities });
    } catch (error) { return canvasFailure(error); }
  });

  if (canRead()) mcpServer.registerTool("get_canvas_entity", {
    description: "Read one Dim0 node or link by its UUID from the authorized board.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ board_id: boardId, entity_id: canvasId }).strict(),
  }, async ({ board_id, entity_id }) => {
    if (!admitted("board:read")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      return output(await getCanvasEntity(db, board_id, actorId, entity_id));
    } catch (error) { return canvasFailure(error); }
  });

  if (canWrite()) mcpServer.registerTool("create_canvas_entity", {
    description: "Create a Dim0 note/document/applet/folder or link. JSON must include UUID id and graphUid equal to the OAuth-granted board.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId, kind: z.enum(["node", "link"]), payload: canvasEntity,
    }).strict(),
  }, async ({ board_id, kind, payload }) => withWriteLease(async()=>{
    if (!admitted("board:write")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      const entity = await createCanvasEntity(db, { boardId: board_id, actorId, kind, payload });
      return output({ id: entity.id, board_id, version: entity.version });
    } catch (error) { return canvasFailure(error); }
  },undefined,{tool:"create_canvas_entity"}));

  if (canWrite()) mcpServer.registerTool("update_canvas_entity", {
    description: "Replace a Dim0 node/link payload with a version check; always read the current entity first.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId, entity_id: canvasId,
      expected_version: z.number().int().positive(), payload: canvasEntity,
    }).strict(),
  }, async ({ board_id, entity_id, expected_version, payload }) => withWriteLease(async()=>{
    if (!admitted("board:write")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      const entity = await updateCanvasEntity(db, {
        boardId: board_id, actorId, id: entity_id,
        expectedVersion: expected_version, payload,
      });
      return output({ id: entity.id, board_id, version: entity.version });
    } catch (error) { return canvasFailure(error); }
  },undefined,{tool:"update_canvas_entity"}));

  if (canWrite()) mcpServer.registerTool("patch_canvas_entity", {
    description:"Patch one canvas note label.markdown with version CAS and a stable request_id; authoritative Jazz transaction writes entity, receipt and audit event once.",
    annotations:{readOnlyHint:false,destructiveHint:false},
    inputSchema:z.object({
      board_id:boardId,entity_id:canvasId,
      expected_version:z.number().int().positive(),
      request_id:z.string().trim().min(1).max(128),
      field_patch:z.object({label_markdown:z.string().max(2000)}).strict()
    }).strict(),
  },async ({board_id,entity_id,expected_version,request_id,field_patch})=> withWriteLease(async()=>{
    if(!admitted("board:write"))return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if(!canWrite())return errorText("INSUFFICIENT_SCOPE: board:write required");
    if(board_id!==grant.boardId)return errorText("BOARD_ACCESS_DENIED");
    try {
      const updated=await patchCanvasLabelMarkdown(db,{
        boardId:board_id,actorId,id:entity_id,
        expectedVersion:expected_version,requestId:request_id,patch:field_patch,
      },{beforeWriteSubmit});
      return output(updated);
    } catch(error){return canvasFailure(error);}
  },request_id,{
    tool:"patch_canvas_entity",
    // An out-of-grant board is rejected by the callback with the existing
    // BOARD_ACCESS_DENIED contract. It cannot mint another board's SQL identity.
    ...(board_id===grant.boardId && Number.isSafeInteger(expected_version) && /^[A-Za-z0-9_-]{1,128}$/.test(request_id) ? {identity:canvasPatchOperationIdentity({
      boardId:board_id,actorId,id:entity_id,expectedVersion:expected_version,
      requestId:request_id,patch:field_patch,
    })} : {}),
  }));

  // This first TYPED dataset mutation is not a new production entitlement
  // for an old board:write grant. Local/disposable QA only until explicit
  // versioned consent and full relational policy are separately approved.
  if(typedRecordQaEnabled() && canWrite())mcpServer.registerTool(
    "patch_typed_record",{
      description:"QA only: CAS patch one writable typed text field; computed cells derive server-side. Operation receipt is independent of canvas.",
      annotations:{readOnlyHint:false,destructiveHint:false},
      inputSchema:z.object({
        board_id:boardId,dataset_id:boardId,record_id:boardId,
        schema_version:z.number().int().positive(),
        expected_version:z.number().int().positive(),
        request_id:z.string().trim().min(1).max(128),
        set:z.record(boardId,z.union([
          z.string().max(2000),z.number().finite(),z.boolean(),z.null()
        ]))
      }).strict()
    },async({
      board_id,dataset_id,record_id,schema_version,expected_version,request_id,set
    })=>{
      const command={boardId:board_id,datasetId:dataset_id,recordId:record_id,
        schemaVersion:schema_version,expectedVersion:expected_version,
        requestId:request_id,set,actorId};
      let identity:ReturnType<typeof typedRecordOperationIdentity>|undefined;
      if(board_id===grant.boardId){
        try{identity=typedRecordOperationIdentity(command);}
        catch(error){if(!(error instanceof TypedRecordFieldInvalid))throw error;}
      }
      return withWriteLease(async()=>{
        if(!admitted("board:write"))return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
        if(board_id!==grant.boardId)return errorText("BOARD_ACCESS_DENIED");
        try{
          return output(await patchTypedRecord(db,command,{beforeWriteSubmit}));
        }catch(error){
          return errorText(error instanceof CanvasPatchAdmissionRevoked
            ? "GRANT_ADMISSION_EXPIRED_OR_INVALID"
            : error instanceof TypedRecordPermissionDenied ? "BOARD_ACCESS_DENIED"
            : error instanceof TypedRecordGuardDenied ? "SERVICE_GUARD_DENIED"
            : error instanceof TypedRecordFieldInvalid ? "INVALID_FIELD"
            : error instanceof TypedRecordSchemaConflict ? "SCHEMA_VERSION_CONFLICT"
            : error instanceof TypedRecordVersionConflict ? "VERSION_CONFLICT"
            : error instanceof TypedRecordRequestConflict ? "REQUEST_ID_CONFLICT"
            : error instanceof PersistedWriteRejectedError ? "WRITE_REJECTED"
            : error instanceof TypedRecordCommitUnknown
              ? "COMMIT_OUTCOME_UNKNOWN: retry same request_id"
              : "TYPED_RECORD_OPERATION_FAILED");
        }
      },request_id,{tool:"patch_typed_record",...(identity?{identity}:{})});
    });

  if (canWrite()) mcpServer.registerTool("delete_canvas_entity", {
    description: "Delete a node/link by UUID with a current version check. Destructive action.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: z.object({
      board_id: boardId, entity_id: canvasId,
      expected_version: z.number().int().positive(),
    }).strict(),
  }, async ({ board_id, entity_id, expected_version }) => withWriteLease(async()=>{
    if (!admitted("board:write")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      return output(await deleteCanvasEntity(db, {
        boardId: board_id, actorId, id: entity_id, expectedVersion: expected_version,
      }));
    } catch (error) { return canvasFailure(error); }
  },undefined,{tool:"delete_canvas_entity"}));

  // Applet runtime data uses a separate Jazz state revision so a counter
  // click never mutates its canvas geometry/source version.
  if (canRead()) mcpServer.registerTool("get_applet_state", {
    description: "Read the shared runtime state of a Dim0 persist applet on the OAuth-approved board.",
    annotations: { readOnlyHint: true },
    inputSchema: z.object({ board_id: boardId, note_id: canvasId }).strict(),
  }, async ({ board_id, note_id }) => {
    if (!admitted("board:read")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try { return output(await getSharedAppletState(db, board_id, actorId, note_id)); }
    catch (error) { return canvasFailure(error); }
  });

  if (canWrite()) mcpServer.registerTool("update_applet_state", {
    description: "Set a shared Dim0 applet state JSON object. Read get_applet_state first and pass its exact version; conflict returns VERSION_CONFLICT.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId, note_id: canvasId,
      expected_version: z.number().int().nonnegative(),
      value: z.record(z.string(), z.unknown()),
    }).strict(),
  }, async ({ board_id, note_id, expected_version, value }) => withWriteLease(async()=>{
    if (!admitted("board:write")) return errorText("GRANT_ADMISSION_EXPIRED_OR_INVALID");
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      return output(await saveSharedAppletState(db, {
        boardId: board_id, noteId: note_id,
        actorId, expectedVersion: expected_version, value,
      }));
    } catch (error) { return canvasFailure(error); }
  },undefined,{tool:"update_applet_state"}));

  response.once("close", () => { void mcpServer.close().catch(() => {}); });
  try {
    await mcpServer.connect(transport as Transport);
    await transport.handleRequest(request, response);
  } catch {
    if (!response.headersSent) response.writeHead(500);
    if (!response.writableEnded) response.end();
  }
}

/** A passkey cookie is NEVER a credential for the private MCP. */
export function handlePrivateMcp(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  jazzAccountFor: (subject: string) => Promise<string>,
): boolean {
  const url = new URL(req.url ?? "/", privateAuthConfig().origin);
  if (url.pathname !== "/patchboard-private-mcp") return false;

  void (async () => {
    if (req.headers.origin && req.headers.origin !== privateAuthConfig().origin) {
      res.writeHead(403, { "cache-control": "no-store" });
      res.end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    // The guard sees only headers/method. The original Node request body is
    // left untouched for the official MCP Streamable HTTP transport.
    const verificationRequest = new Request(resource(), {
      method: req.method ?? "POST",
      headers,
    });
    let subject: string | undefined;
    let grant: VerifiedBoardGrant | null = null;
    let grantedScopes: Set<string> = new Set();
    const debugAuth = process.env.PATCHBOARD_MCP_AUTH_DEBUG === "1";
    let claimsReached = false;
    const verification = await requireMcpAuth(auth, (_request, claims) => {
      claimsReached = true;
      if (typeof claims.sub !== "string" || !claims.sub) {
        return new Response(null, { status: 401 });
      }
      const verified = requireConsentBoundBoardGrant(claims.patchboard_grant_id, claims.sub,
        claims.azp ?? claims.client_id, claims.scope);
      if (verified && !claims.patchboard_grant_id && debugAuth) {
        console.info("PRIVATE_MCP_CONSENT_RECOVERY_PASS");
      }
      if (!verified) {
        if (debugAuth) console.warn("PRIVATE_MCP_GRANT_REJECT", JSON.stringify({
          hasSubject: typeof claims.sub === "string",
          hasGrantClaim: typeof claims.patchboard_grant_id === "string",
          hasAzp: typeof claims.azp === "string",
          hasClientId: typeof claims.client_id === "string",
        }));
        return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
      }
      subject = claims.sub;
      grant = verified;
      grantedScopes = new Set(typeof claims.scope === "string" ? claims.scope.split(/\s+/).filter(Boolean) : []);
      return new Response(null, { status: 204 });
    }, { resource: resource(), challengeScopes: scopes })(verificationRequest);

    if (verification.status !== 204 || !subject || !grant) {
      if (debugAuth) console.warn("PRIVATE_MCP_AUTH_REJECT", JSON.stringify({
        status: verification.status,
        bearerPresent: typeof req.headers.authorization === "string" &&
          req.headers.authorization.startsWith("Bearer "),
        claimsReached,
      }));
      for (const [name, value] of verification.headers) res.setHeader(name, value);
      res.setHeader("Cache-Control", "no-store");
      res.writeHead(verification.status);
      res.end(Buffer.from(await verification.arrayBuffer()));
      return;
    }
    if (req.method !== "POST" && req.method !== "GET" && req.method !== "DELETE") {
      res.writeHead(405, { allow: "POST, GET, DELETE" });
      res.end();
      return;
    }
    const row = privateAuthDatabase().prepare("SELECT name FROM user WHERE id = ?").get(subject) as
      | { name: string } | undefined;
    if (!row) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end();
      return;
    }
    // Durable server-only SQL admission serializes against the SAME grant row
    // as revokeBoardGrant. A POST token already admitted before revocation
    // may finish only if its Jazz command still passes current membership.
    // Cached descriptors and new requests after the revoke commit deny.
    const admission = admitVerifiedMcpGrant(
      privateAuthDatabase(), grant, grantedScopes
    );
    if (!admission) {
      res.writeHead(401, { "cache-control": "no-store" });
      res.end();
      return;
    }
    // Only a verified subject becomes the Jazz actor; never a caller-supplied id.
    const actorId = await jazzAccountFor(subject);
    await executePrivateMcp(req, res, db, actorId, row.name, grantedScopes, grant, admission);
  })().catch(() => {
    if (!res.headersSent) res.writeHead(503, { "cache-control": "no-store" });
    if (!res.writableEnded) res.end();
  });
  return true;
}
