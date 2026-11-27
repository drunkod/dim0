import type { IncomingMessage, ServerResponse } from "node:http";
import type { Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { auth } from "./private-auth/auth.ts";
import { canvasBoardRole, projectCanvasEntity, CanvasPermissionDenied } from "./canvas-entity-service.ts";

const BOARD_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Stream Jazz's *real* live query, scoped to the verified browser identity.
 * No guest accounts or client-supplied actors are ever accepted.
 */
export function handlePrivateCanvasStream(
  req: IncomingMessage,
  res: ServerResponse,
  db: Db,
  jazzAccountFor: (subject: string) => Promise<string>,
  readShutdown?: AbortSignal,
): boolean {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname !== "/patchboard-private/api/canvas/stream") return false;

  void (async () => {
    if (req.method !== "GET") {
      res.writeHead(405, { Allow: "GET", "Cache-Control": "no-store" }).end();
      return;
    }
    const boardId = url.searchParams.get("board_id") ?? "";
    if (!BOARD_ID.test(boardId)) {
      res.writeHead(400, { "Cache-Control": "no-store" }).end();
      return;
    }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    const session = await auth.api.getSession({ headers });
    if (!session) {
      res.writeHead(401, { "Cache-Control": "no-store" }).end();
      return;
    }
    const actorId = await jazzAccountFor(session.user.id);
    let role: "owner" | "member" | "viewer";
    try {
      role = await canvasBoardRole(db, boardId, actorId);
    } catch (error) {
      if (!(error instanceof CanvasPermissionDenied)) throw error;
      res.writeHead(403, { "Cache-Control": "no-store" }).end();
      return;
    }

    if (res.destroyed || res.writableEnded) return;
    if (readShutdown?.aborted) {
      res.writeHead(503, { "Cache-Control": "no-store", Connection: "close" }).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    });
    let closed = false;
    let unsubscribe = () => {};
    let serial = Promise.resolve();
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const close = () => {
      if (closed) return;
      closed = true;
      readShutdown?.removeEventListener("abort", close);
      if (heartbeat) clearInterval(heartbeat);
      unsubscribe();
      if (!res.writableEnded) res.end();
    };
    res.once("close", close);
    readShutdown?.addEventListener("abort", close, { once: true });

    // Check current membership on every update and heartbeat. An existing
    // connection cannot retain access indefinitely after membership revocation.
    const recheck = async (): Promise<boolean> => {
      try {
        // Long-lived SSE connections must not outlive a revoked or expired
        // Better Auth session, even when board membership is unchanged.
        const currentSession = await auth.api.getSession({ headers });
        if (closed) return false;
        if (!currentSession || currentSession.user.id !== session.user.id) {
          close();
          return false;
        }
        role = await canvasBoardRole(db, boardId, actorId);
        return !closed;
      } catch {
        close();
        return false;
      }
    };

    unsubscribe = db.subscribe(app.canvasEntities.where({ boardId }).limit(501), {
      onUpdate: (rows) => {
        serial = serial.then(async () => {
          if (closed || !await recheck() || closed) return;
          if (rows.length > 500 || res.writableLength > 2_000_000) {
            close();
            return;
          }
          const entities = rows.map(projectCanvasEntity);
          res.write(`event: snapshot\ndata: ${JSON.stringify({ board_id: boardId, entities, role })}\n\n`);
        }).catch(close);
      },
      onError: close,
    });
    // The query emits its initial complete result on subscribe.
    heartbeat = setInterval(() => {
      serial = serial.then(async () => {
        if (closed || !await recheck() || closed) return;
        res.write(": keepalive\n\n");
      }).catch(close);
    }, 15_000);
    heartbeat.unref();
    if (closed) unsubscribe();
  })().catch(() => {
    if (!res.headersSent) res.writeHead(503, { "Cache-Control": "no-store" });
    if (!res.writableEnded) res.end();
  });
  return true;
}
