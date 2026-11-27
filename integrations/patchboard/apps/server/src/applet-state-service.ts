import type { Db, JsonValue } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import {
  checkAccess, jazzCanvasStorageId, CanvasConflict,
  CanvasInvalid, CanvasPermissionDenied,
} from "./canvas-entity-service.ts";

export type SharedAppletState = {
  board_id: string; note_id: string;
  version: number; value: Record<string, JsonValue> | null;
};

/** Ensure runtime state always belongs to a real, currently shared applet. */
async function assertApplet(
  tx: Pick<Db, "one">, boardId: string, noteId: string,
): Promise<void> {
  const entity = await tx.one(app.canvasEntities.where({ id: jazzCanvasStorageId(noteId) }));
  if (!entity || entity.boardId !== boardId || entity.kind !== "node") {
    throw new CanvasPermissionDenied();
  }
  const payload = entity.payload as Record<string, unknown>;
  const style = payload.style as Record<string, unknown> | null | undefined;
  if (style?.type !== "applet" || payload.id !== noteId) {
    throw new CanvasInvalid("Runtime state is only available for applet nodes");
  }
}

/** Cap persisted data and reject non-object payloads before the transaction. */
export function validateSharedAppletValue(
  state: unknown,
): asserts state is Record<string, JsonValue> {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new CanvasInvalid("Applet state must be a JSON object");
  }
  let json: string;
  try { json = JSON.stringify(state); }
  catch { throw new CanvasInvalid("Applet state must be valid JSON"); }
  if (!json || Buffer.byteLength(json, "utf8") > 16_384) {
    throw new CanvasInvalid("Applet state exceeds 16 KiB");
  }
  try { JSON.parse(json); }
  catch { throw new CanvasInvalid("Applet state must be valid JSON"); }
}

/** Read the canonical state, not the calling device's IndexedDB. */
export async function getSharedAppletState(
  db: Db, boardId: string, actorId: string, noteId: string,
): Promise<SharedAppletState> {
  await checkAccess(db, boardId, actorId, false);
  await assertApplet(db, boardId, noteId);
  const row = await db.one(app.appletStates.where({ id: jazzCanvasStorageId(noteId) }));
  return {
    board_id: boardId, note_id: noteId,
    version: row?.boardId === boardId ? row.version : 0,
    value: row?.boardId === boardId
      ? row.value as Record<string, JsonValue> : null,
  };
}

/** Serializable version-checked mutation: stale writers always get HTTP 409. */
export async function saveSharedAppletState(
  db: Db, input: {
    boardId: string; actorId: string; noteId: string;
    expectedVersion: number; value: unknown;
  },
): Promise<SharedAppletState> {
  validateSharedAppletValue(input.value);
  if (!Number.isSafeInteger(input.expectedVersion) || input.expectedVersion < 0) {
    throw new CanvasInvalid("Expected applet state version must be a nonnegative integer");
  }
  const id = jazzCanvasStorageId(input.noteId);
  const result = await db.serializableTransaction(async (tx) => {
    await checkAccess(tx, input.boardId, input.actorId, true);
    await assertApplet(tx, input.boardId, input.noteId);
    const existing = await tx.one(app.appletStates.where({ id }));
    if ((existing?.version ?? 0) !== input.expectedVersion) throw new CanvasConflict();
    if (existing && existing.boardId !== input.boardId) throw new CanvasPermissionDenied();
    const version = input.expectedVersion + 1;
    if (existing) {
      tx.update(app.appletStates, id, {
        value: input.value as Record<string, JsonValue>,
        version, updatedBy: input.actorId,
      });
    } else {
      tx.insert(app.appletStates, {
        boardId: input.boardId, noteId: input.noteId,
        value: input.value as Record<string, JsonValue>,
        version, updatedBy: input.actorId,
      }, { id });
    }
    return {
      board_id: input.boardId, note_id: input.noteId,
      version, value: input.value as Record<string, JsonValue>,
    };
  });
  await result.wait({ timeoutMs: 10_000 });
  return result.value;
}
