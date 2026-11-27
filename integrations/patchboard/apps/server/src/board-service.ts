import { createHash, randomUUID } from "node:crypto";
import { Effect } from "effect";
import { PersistedWriteRejectedError, type Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import { noteFields } from "@patchboard/jazz-schema/note-defaults";

/**
 * The existing Node/Jazz backend's own Db writes directly to its single store.
 * It is intentionally not a public HTTP or MCP endpoint.
 */
export async function createNoteFromBackend(
  db: Db,
  input: { boardId: string; text: string; zIndex: number },
) {
  const text = input.text.trim();
  if (!text) throw new Error("Note text is required");
  const board = await db.one(app.boards.where({ id: input.boardId }));
  if (!board) throw new Error("Demo board does not exist");
  const result = db.insert(app.shapes, noteFields(input.boardId, text, input.zIndex));
  await result.wait({ tier: "global", timeoutMs: 10_000 });
  return result.value;
}

export const readBoard = Effect.fn("Board.readSnapshot")(function* (db: Db, boardId: string) {
  return yield* Effect.tryPromise(async () => {
    const board = await db.one(app.boards.where({ id: boardId }));
    if (!board) throw new Error("Missing board");
    const rows = await db.all(
      app.shapes.where({ boardId, kind: "note" }).orderBy("zIndex", "asc").limit(51),
    );
    return {
      board_id: board.id,
      title: board.title,
      notes: rows.slice(0, 50).map(({ id, text, x, y, authorId, authorName }) => ({
        id, text, x, y,
        author_id: authorId ?? null,
        author_name: authorId ? (authorName ?? "Patchboard member") : "Guest / unverified",
      })),
      truncated: rows.length > 50,
    };
  });
});

/** Preserve v1 fixture receipts and isolate authenticated callers in a separate namespace. */
const requestReceiptId = (boardId: string, requestId: string, actorId?: string) => {
  const hash = createHash("sha256");
  if (actorId === undefined) hash.update("patchboard:mcp:create_note:v1\0");
  else hash.update("patchboard:mcp:create_note:v2\0").update(actorId).update("\0");
  const bytes = hash
    .update(boardId)
    .update("\0")
    .update(requestId)
    .digest();
  // Set version/variant bits to create a valid, deterministic UUID.
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.subarray(0, 16).toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
};

export class RequestIdConflict extends Error {
  constructor() {
    super("This request_id was already used with different text");
    this.name = "RequestIdConflict";
  }
}

export class PrivatePermissionDenied extends Error {
  constructor() {
    super("Private board membership or editor permission required");
    this.name = "PrivatePermissionDenied";
  }
}

/** Only a verified Jazz account may inspect a private board. */
export async function requirePrivateBoardAccess(
  db: Db,
  boardId: string,
  actorId: string,
  write = false,
): Promise<void> {
  const board = await db.one(app.boards.where({ id: boardId }));
  if (!board) throw new DemoBoardMissing();
  if (board.ownerId === actorId) return;
  const member = await db.one(app.boardMembers.where({ boardId, userId: actorId }));
  if (!member || (write && member.role !== "editor" && member.role !== "admin")) {
    throw new PrivatePermissionDenied();
  }
}

/**
 * Private note mutations run ONLY on the server after Better Auth has supplied
 * the caller's verified Jazz account. The note's stored boardId is authoritative:
 * never trust a board ID submitted with a shape ID.
 *
 * Read membership and write in the same serializable transaction so a revoked
 * editor cannot race or reuse an old browser session to mutate a note.
 */
export async function changePrivateNote(
  db: Db,
  input: {
    noteId: string;
    actorId: string;
    fields: { text: string } | { x: number; y: number };
  },
): Promise<{ board_id: string; note_id: string }> {
  const result = await db.serializableTransaction(async (tx) => {
    const note = await tx.one(app.shapes.where({ id: input.noteId }));
    if (!note || note.kind !== "note") throw new DemoBoardMissing();
    const board = await tx.one(app.boards.where({ id: note.boardId }));
    if (!board) throw new DemoBoardMissing();
    if (board.ownerId !== input.actorId) {
      const membership = await tx.one(app.boardMembers.where({
        boardId: note.boardId, userId: input.actorId,
      }));
      if (!membership || (membership.role !== "editor" && membership.role !== "admin")) {
        throw new PrivatePermissionDenied();
      }
    }
    // Do not accept authorId, authorName, boardId, or other protected fields.
    tx.update(app.shapes, note.id, input.fields);
    return { board_id: note.boardId, note_id: note.id };
  });
  await result.wait({ timeoutMs: 10_000 });
  return result.value;
}

export class DemoBoardMissing extends Error {
  constructor() {
    super("Configured demo board is unavailable");
    this.name = "DemoBoardMissing";
  }
}

const retryableConflicts = new Set(["serialization_conflict", "transaction_conflict"]);
const isTransactionConflict = (error: unknown) =>
  (error instanceof PersistedWriteRejectedError ||
    (error instanceof Error && error.name === "PersistedWriteRejectedError")) &&
  retryableConflicts.has((error as PersistedWriteRejectedError).code);

/**
 * Backend-authoritative, atomic insert of a Jazz shape and an idempotency receipt.
 * The SDK uses this named Effect operation; browser commands keep their own Jazz session.
 */
export const createMcpNote = Effect.fn("Board.createMcpNote")(function* (
  db: Db,
  input: { boardId: string; text: string; requestId: string; actorId?: string; authorName?: string },
  beforeWriteSubmit?: () => void,
) {
  return yield* Effect.promise(async () => {
    const text = input.text.trim();
    const requestId = input.requestId.trim();
    if (!text || text.length > 2000 || !requestId || requestId.length > 128) {
      throw new Error("Invalid note request");
    }
    const { boardId } = input;
    const textHash = createHash("sha256").update(text).digest("hex");
    const receiptId = requestReceiptId(boardId, requestId, input.actorId);

    const checkWriter = async (reader: Pick<Db, "one">) => {
      if (!input.actorId) return; // v1 disposable guest tool; no private authority.
      const board = await reader.one(app.boards.where({ id: boardId }));
      if (!board) throw new DemoBoardMissing();
      if (board.ownerId === input.actorId) return;
      const member = await reader.one(app.boardMembers.where({
        boardId, userId: input.actorId,
      }));
      if (!member || member.role !== "editor") throw new PrivatePermissionDenied();
    };

    // Authenticated replay must check current membership IN THE SAME SERIALIZABLE
    // TRANSACTION as the receipt read; a revoked user cannot replay an old ID.
    const lookup = async (reader: Pick<Db, "one">) => {
      await checkWriter(reader);
      const receipt = await reader.one(app.mcpRequests.where({ id: receiptId }));
      if (!receipt) return null;
      if (
        receipt.boardId !== boardId ||
        receipt.requestId !== requestId ||
        receipt.textHash !== textHash
      )
        throw new RequestIdConflict();
      const note = await reader.one(app.shapes.where({ id: receipt.noteId }));
      if (!note || note.boardId !== boardId) throw new Error("Saved note is unavailable");
      return { board_id: boardId, note_id: receipt.noteId };
    };
    const replay = async () => {
      if (!input.actorId) return lookup(db);
      beforeWriteSubmit?.();
      const result = await db.serializableTransaction(async (tx) => lookup(tx));
      await result.wait({ timeoutMs: 10_000 });
      return result.value;
    };

    // Serializable Jazz transactions make a note and its receipt visible together.
    // Retry only optimistic concurrency conflicts, never arbitrary backend failures.
    for (let attempt = 0; attempt < 6; attempt++) {
      const found = await replay();
      if (found) return found;
      try {
        beforeWriteSubmit?.();
        const write = await db.serializableTransaction(async (tx) => {
          await checkWriter(tx);
          const existing = await tx.one(app.mcpRequests.where({ id: receiptId }));
          if (existing) {
            if (
              existing.textHash !== textHash ||
              existing.boardId !== boardId ||
              existing.requestId !== requestId
            )
              throw new RequestIdConflict();
            return existing.noteId;
          }
          if (!(await tx.one(app.boards.where({ id: boardId })))) throw new DemoBoardMissing();
          const top = await tx.all(
            app.shapes.where({ boardId }).orderBy("zIndex", "desc").limit(1),
          );
          const zIndex = (top[0]?.zIndex ?? -1) + 1;
          const noteId = randomUUID();
          const authorName = (input.authorName ?? "Patchboard member").trim().slice(0, 80);
          tx.insert(app.shapes, {
            ...noteFields(boardId, text, zIndex),
            ...(input.actorId ? { authorId: input.actorId, authorName } : {}),
          }, { id: noteId });
          tx.insert(app.mcpRequests, { boardId, requestId, textHash, noteId }, { id: receiptId });
          return noteId;
        });
        // No MCP success is returned until Jazz accepted the transaction globally.
        await write.wait({ timeoutMs: 10_000 });
        return { board_id: boardId, note_id: write.value };
      } catch (error) {
        // Only a definitively rejected transaction can be reconciled/retried.
        // A wait timeout may still commit; do not mask it with a later
        // permission failure or retry and falsely settle its drain lease.
        if (!isTransactionConflict(error)) throw error;
        const found = await replay();
        if (found) return found;
        if (attempt === 5) throw error;
      }
    }
    throw new Error("Request could not be committed");
  });
});
