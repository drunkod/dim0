import type { Db, JsonValue } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";

/** Transport-safe, unmodified Dim0 canvas records (notes, documents and links). */
export type CanvasEntityKind = "node" | "link";
export type CanvasPayload = Record<string, JsonValue>;
export type CanvasEntity = {
  id: string;
  boardId: string;
  kind: CanvasEntityKind;
  payload: CanvasPayload;
  version: number;
  updatedBy: string;
};

export class CanvasPermissionDenied extends Error {
  constructor() { super("Board membership or editor permission required"); this.name = "CanvasPermissionDenied"; }
}

export class CanvasConflict extends Error {
  constructor() { super("Entity already exists or expected version does not match"); this.name = "CanvasConflict"; }
}

export class CanvasInvalid extends Error {
  constructor(message: string) { super(message); this.name = "CanvasInvalid"; }
}

/** Reject mismatched graph IDs and malformed payloads before touching Jazz. */
export function validateCanvasPayload(
  boardId: string, kind: CanvasEntityKind, payload: unknown,
): asserts payload is CanvasPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new CanvasInvalid("Canvas payload must be a JSON object");
  }
  const obj = payload as Record<string, unknown>;
  if (typeof obj.id !== "string" || !/^[a-f0-9-]{36}$/i.test(obj.id)) {
    throw new CanvasInvalid("Canvas entity must have a UUID");
  }
  if (obj.graphUid !== boardId) {
    throw new CanvasInvalid("Cannot write an entity to another board");
  }
  if ((kind === "link" && obj.type !== "link") ||
      (kind === "node" && obj.type !== "note" && obj.type !== "document")) {
    throw new CanvasInvalid("Canvas entity kind/type mismatch");
  }
  if (kind === "link" && (typeof obj.source !== "string" || typeof obj.target !== "string")) {
    throw new CanvasInvalid("Link must have source and target IDs");
  }
  const serialized = JSON.stringify(obj);
  if (!serialized || serialized.length > 128_000 ||
      JSON.parse(serialized) === null) {
    throw new CanvasInvalid("Canvas payload must be JSON smaller than 128 kB");
  }
}

/** Performs the permission check within the same Jazz transaction as a mutation. */
async function checkAccess(
  reader: Pick<Db, "one">, boardId: string, actorId: string, write: boolean,
) {
  const board = await reader.one(app.boards.where({ id: boardId }));
  if (!board) throw new CanvasPermissionDenied();
  if (board.ownerId === actorId) return;
  const member = await reader.one(app.boardMembers.where({ boardId, userId: actorId }));
  if (!member || (write && member.role !== "editor" && member.role !== "admin")) {
    throw new CanvasPermissionDenied();
  }
}

function projection(row: {
  id: string; boardId: string; kind: CanvasEntityKind; payload: unknown;
  version: number; updatedBy: string;
}): CanvasEntity {
  return { ...row, payload: row.payload as CanvasPayload };
}

/** Derive a Dim0 edit role from Jazz membership, never from a client claim. */
export async function canvasBoardRole(
  db: Db, boardId: string, actorId: string,
): Promise<"owner" | "member" | "viewer"> {
  const board = await db.one(app.boards.where({ id: boardId }));
  if (!board) throw new CanvasPermissionDenied();
  if (board.ownerId === actorId) return "owner";
  const member = await db.one(app.boardMembers.where({ boardId, userId: actorId }));
  if (!member) throw new CanvasPermissionDenied();
  return member.role === "editor" || member.role === "admin" ? "member" : "viewer";
}

/** Read a bounded Jazz-backed board entity snapshot with verified membership. */
export async function listCanvasEntities(
  db: Db, boardId: string, actorId: string,
): Promise<CanvasEntity[]> {
  await checkAccess(db, boardId, actorId, false);
  const rows = await db.all(app.canvasEntities.where({ boardId }).limit(501));
  if (rows.length > 500) throw new CanvasInvalid("Canvas exceeds snapshot limit; use pagination");
  return rows.map(projection);
}

/** Read one entity without exposing another board's IDs. */
export async function getCanvasEntity(
  db: Db, boardId: string, actorId: string, id: string,
): Promise<CanvasEntity | null> {
  await checkAccess(db, boardId, actorId, false);
  const row = await db.one(app.canvasEntities.where({ id }));
  return row?.boardId === boardId ? projection(row) : null;
}

/** Atomically create a complete node/link with its original Dim0 ID. */
export async function createCanvasEntity(
  db: Db,
  input: { boardId: string; actorId: string; kind: CanvasEntityKind; payload: CanvasPayload },
): Promise<CanvasEntity> {
  validateCanvasPayload(input.boardId, input.kind, input.payload);
  const payload = input.payload;
  const result = await db.serializableTransaction(async (tx) => {
    await checkAccess(tx, input.boardId, input.actorId, true);
    if (await tx.one(app.canvasEntities.where({ id: payload.id as string }))) throw new CanvasConflict();
    tx.insert(app.canvasEntities, {
      boardId: input.boardId, kind: input.kind, payload,
      version: 1, updatedBy: input.actorId,
    }, { id: payload.id as string });
    return { id: payload.id as string, boardId: input.boardId, kind: input.kind,
      payload, version: 1, updatedBy: input.actorId };
  });
  await result.wait({ timeoutMs: 10_000 });
  return result.value;
}

/** Compare-and-swap update, preserving immutable identity, scope and entity kind. */
export async function updateCanvasEntity(
  db: Db,
  input: { boardId: string; actorId: string; id: string; expectedVersion: number; payload: CanvasPayload },
): Promise<CanvasEntity> {
  const result = await db.serializableTransaction(async (tx) => {
    await checkAccess(tx, input.boardId, input.actorId, true);
    const entity = await tx.one(app.canvasEntities.where({ id: input.id }));
    if (!entity || entity.boardId !== input.boardId) throw new CanvasPermissionDenied();
    if (entity.version !== input.expectedVersion) throw new CanvasConflict();
    validateCanvasPayload(input.boardId, entity.kind, input.payload);
    if (input.payload.id !== input.id) throw new CanvasInvalid("Cannot change entity ID");
    const version = entity.version + 1;
    tx.update(app.canvasEntities, input.id, {
      payload: input.payload, version, updatedBy: input.actorId,
    });
    return { id: input.id, boardId: input.boardId, kind: entity.kind,
      payload: input.payload, version, updatedBy: input.actorId };
  });
  await result.wait({ timeoutMs: 10_000 });
  return result.value;
}

/** Remove only an existing in-scope node/link under the current write grant. */
export async function deleteCanvasEntity(
  db: Db,
  input: { boardId: string; actorId: string; id: string; expectedVersion: number },
): Promise<{ id: string; deleted: true }> {
  const result = await db.serializableTransaction(async (tx) => {
    await checkAccess(tx, input.boardId, input.actorId, true);
    const entity = await tx.one(app.canvasEntities.where({ id: input.id }));
    if (!entity || entity.boardId !== input.boardId) throw new CanvasPermissionDenied();
    if (entity.version !== input.expectedVersion) throw new CanvasConflict();
    tx.delete(app.canvasEntities, input.id);
    return { id: input.id, deleted: true as const };
  });
  await result.wait({ timeoutMs: 10_000 });
  return result.value;
}
