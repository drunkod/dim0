/**
 * Dim0 <-> Patchboard bridge. This is an authenticated HTTP transport over a
 * Jazz-backed domain service, never a second business-data store.
 *
 * The next integration milestone wires this to CanvasStore hydration, local
 * operation batching and Jazz live subscriptions; it is not mounted yet.
 */
export type JazzCanvasRecord = {
  id: string
  boardId: string
  kind: "node" | "link"
  payload: Record<string, unknown>
  version: number
  updatedBy: string
}

export type JazzCanvasSnapshot = {
  board_id: string
  entities: JazzCanvasRecord[]
}

export class JazzCanvasApiError extends Error {
  readonly status: number
  readonly operation: string

  constructor(status: number, operation: string) {
    super(`Jazz ${operation} failed with HTTP ${status}`)
    this.name = "JazzCanvasApiError"
    this.status = status
    this.operation = operation
  }
}

const API_ROOT = "/patchboard-private/api/canvas"

/** All requests use the same-origin Better Auth session and no-store caching. */
async function jsonRequest<T>(
  operation: string,
  path: string,
  request?: { method: "POST"; data: Record<string, unknown> },
): Promise<T> {
  const response = await fetch(API_ROOT + path, {
    ...(request ? {
      method: request.method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(request.data),
    } : { method: "GET" }),
    credentials: "include",
    cache: "no-store",
  })
  if (!response.ok) throw new JazzCanvasApiError(response.status, operation)
  return response.json() as Promise<T>
}

/** Fetch a bounded Jazz snapshot for the current authenticated board. */
export function loadJazzCanvas(boardId: string): Promise<JazzCanvasSnapshot> {
  return jsonRequest("load", "?board_id=" + encodeURIComponent(boardId))
}

/** Create a Dim0 node or link in Jazz, retaining its original ID and payload. */
export function createJazzCanvasEntity(
  boardId: string,
  kind: JazzCanvasRecord["kind"],
  payload: JazzCanvasRecord["payload"],
): Promise<JazzCanvasRecord> {
  return jsonRequest("create", "/create", {
    method: "POST",
    data: { board_id: boardId, kind, payload },
  })
}

/** CAS update: prevent concurrent agents from silently overwriting human edits. */
export function updateJazzCanvasEntity(
  boardId: string,
  id: string,
  expectedVersion: number,
  payload: JazzCanvasRecord["payload"],
): Promise<JazzCanvasRecord> {
  return jsonRequest("update", "/update", {
    method: "POST",
    data: { board_id: boardId, entity_id: id, expected_version: expectedVersion, payload },
  })
}

/** Delete only if the caller still has the current Jazz entity revision. */
export function deleteJazzCanvasEntity(
  boardId: string,
  id: string,
  expectedVersion: number,
): Promise<{ id: string; deleted: true }> {
  return jsonRequest("delete", "/delete", {
    method: "POST",
    data: { board_id: boardId, entity_id: id, expected_version: expectedVersion },
  })
}

/** Build Dim0's canonical note/link lists without dropping mini-app properties. */
export function splitJazzCanvasEntities(snapshot: JazzCanvasSnapshot): {
  notes: Record<string, unknown>[]
  links: Record<string, unknown>[]
} {
  const notes: Record<string, unknown>[] = []
  const links: Record<string, unknown>[] = []
  for (const entity of snapshot.entities) {
    if (entity.boardId !== snapshot.board_id || entity.payload.graphUid !== snapshot.board_id ||
        entity.payload.id !== entity.id) throw new Error("Jazz canvas scope mismatch")
    if (entity.kind === "link") {
      if (entity.payload.type !== "link") throw new Error("Invalid Jazz link")
      links.push(entity.payload)
    } else {
      if (entity.payload.type !== "note" && entity.payload.type !== "document") {
        throw new Error("Invalid Jazz node")
      }
      notes.push(entity.payload)
    }
  }
  return { notes, links }
}
