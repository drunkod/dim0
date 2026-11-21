import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { requireMcpAuth } from "@better-auth/mcp";
import { Effect } from "effect";
import { z } from "zod";
import type { Db } from "jazz-tools";
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
import { privateAuthConfig } from "./private-auth/config.ts";
import { privateAuthDatabase } from "./private-auth/db.ts";
import { requireConsentBoundBoardGrant, type VerifiedBoardGrant } from "./private-auth/grants.ts";

const boardId = z.string().uuid();
const scopes = ["board:read", "board:write"] as const;
const resource = () => privateAuthConfig().origin + "/patchboard-private-mcp";
const errorText = (message: string) => ({
  isError: true as const,
  content: [{ type: "text" as const, text: message }],
});
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
) {
  const canRead = () => grantedScopes.has("board:read");
  const canWrite = () => grantedScopes.has("board:write");
  const mcpServer = new McpServer({ name: "patchboard-private", version: "0.1.0" });
  const transport = new StreamableHTTPServerTransport({});

  if (canRead()) mcpServer.registerTool("list_boards", {
    description: "List the single board approved in this OAuth grant.",
    annotations: { readOnlyHint: true },
    inputSchema: {},
  }, async () => {
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

  if (canWrite()) mcpServer.registerTool("create_note", {
    description: "Create a note in a private board. Requires board:write and current editor/owner permission; a stable request_id makes retries idempotent.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId,
      text: z.string().trim().min(1).max(2000),
      request_id: z.string().trim().min(1).max(128),
    }).strict(),
  }, async ({ board_id, text, request_id }) => {
    if (!canWrite()) return errorText("INSUFFICIENT_SCOPE: board:write required");
    try {
      if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
      return output(await Effect.runPromise(createMcpNote(db, {
        boardId: grant.boardId, text, requestId: request_id,
        actorId, authorName: actorName,
      })));
    } catch (error) {
      return errorText(error instanceof PrivatePermissionDenied
        ? "BOARD_WRITE_DENIED"
        : error instanceof DemoBoardMissing ? "BOARD_UNAVAILABLE"
        : error instanceof RequestIdConflict ? "REQUEST_ID_CONFLICT"
        : "WRITE_FAILED: Check read_board before retrying");
    }
  });

  // Dim0 JSON entities remain in Jazz; every tool is scoped to this OAuth grant.
  const canvasFailure = (error: unknown) => errorText(
    error instanceof CanvasPermissionDenied ? "BOARD_ACCESS_DENIED"
      : error instanceof CanvasConflict ? "VERSION_CONFLICT"
      : error instanceof CanvasInvalid ? "INVALID_ENTITY"
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
  }, async ({ board_id, kind, payload }) => {
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      const entity = await createCanvasEntity(db, { boardId: board_id, actorId, kind, payload });
      return output({ id: entity.id, board_id, version: entity.version });
    } catch (error) { return canvasFailure(error); }
  });

  if (canWrite()) mcpServer.registerTool("update_canvas_entity", {
    description: "Replace a Dim0 node/link payload with a version check; always read the current entity first.",
    annotations: { readOnlyHint: false, destructiveHint: false },
    inputSchema: z.object({
      board_id: boardId, entity_id: canvasId,
      expected_version: z.number().int().positive(), payload: canvasEntity,
    }).strict(),
  }, async ({ board_id, entity_id, expected_version, payload }) => {
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      const entity = await updateCanvasEntity(db, {
        boardId: board_id, actorId, id: entity_id,
        expectedVersion: expected_version, payload,
      });
      return output({ id: entity.id, board_id, version: entity.version });
    } catch (error) { return canvasFailure(error); }
  });

  if (canWrite()) mcpServer.registerTool("delete_canvas_entity", {
    description: "Delete a node/link by UUID with a current version check. Destructive action.",
    annotations: { readOnlyHint: false, destructiveHint: true },
    inputSchema: z.object({
      board_id: boardId, entity_id: canvasId,
      expected_version: z.number().int().positive(),
    }).strict(),
  }, async ({ board_id, entity_id, expected_version }) => {
    if (board_id !== grant.boardId) return errorText("BOARD_ACCESS_DENIED");
    try {
      return output(await deleteCanvasEntity(db, {
        boardId: board_id, actorId, id: entity_id, expectedVersion: expected_version,
      }));
    } catch (error) { return canvasFailure(error); }
  });

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
    // Only a verified subject becomes the Jazz actor; never a caller-supplied id.
    const actorId = await jazzAccountFor(subject);
    await executePrivateMcp(req, res, db, actorId, row.name, grantedScopes, grant);
  })().catch(() => {
    if (!res.headersSent) res.writeHead(503, { "cache-control": "no-store" });
    if (!res.writableEnded) res.end();
  });
  return true;
}
