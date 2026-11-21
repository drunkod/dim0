import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
import {
  changePrivateNote, createMcpNote, PrivatePermissionDenied, RequestIdConflict,
} from "../src/board-service.ts";

process.env.JAZZ_APP_DIR = new URL("../../../packages/jazz-schema", import.meta.url).pathname;

test("private Jazz receipts stay actor-scoped and revoked editors cannot replay", async () => {
  const path = await mkdtemp(join(tmpdir(), "patchboard-private-authz-"));
  const open = () => createJazz({
    app, permissions: privatePermissions, store: sqlite({ path }),
    authenticate: () => null, // No device account accepted in private mode.
  }).ready();
  const server = await open();
  const ownerId = randomUUID(), editorId = randomUUID(), viewerId = randomUUID(), outsiderId = randomUUID();
  let boardId, firstId, secondId;
  try {
    const board = server.db.insert(app.boards, { ownerId, title: "Verified authors" });
    await board.wait({ tier: "global" });
    boardId = board.value.id;
    const member = server.db.insert(app.boardMembers, { boardId, userId: editorId, role: "editor" });
    await member.wait({ tier: "global" });
    const viewer = server.db.insert(app.boardMembers, { boardId, userId: viewerId, role: "viewer" });
    await viewer.wait({ tier: "global" });
    const key = "actor-scoped-idempotent-operation";
    const editorInput = { boardId, actorId: editorId, authorName: "Friend B", requestId: key, text: "Private collaboration" };
    const first = await Effect.runPromise(createMcpNote(server.db, editorInput));
    firstId = first.note_id;
    assert.equal((await server.db.one(app.shapes.where({ id: firstId })))?.authorId, editorId);
    assert.equal((await server.db.one(app.shapes.where({ id: firstId })))?.authorName, "Friend B");
    const retry = await Effect.runPromise(createMcpNote(server.db, editorInput));
    assert.equal(retry.note_id, firstId);

    const second = await Effect.runPromise(createMcpNote(server.db, {
      ...editorInput, actorId: ownerId, authorName: "Owner A",
    }));
    secondId = second.note_id;
    assert.notEqual(firstId, secondId);
    assert.equal((await server.db.one(app.shapes.where({ id: secondId })))?.authorId, ownerId);
    await assert.rejects(
      () => Effect.runPromise(createMcpNote(server.db, { ...editorInput, text: "Tampered" })),
      RequestIdConflict,
    );
    for (const deniedActor of [viewerId, outsiderId]) {
      await assert.rejects(
        () => Effect.runPromise(createMcpNote(server.db, { ...editorInput, actorId: deniedActor })),
        PrivatePermissionDenied,
      );
    }
    await server.db.delete(app.boardMembers, member.value.id).wait({ tier: "global" });
    await assert.rejects(
      () => Effect.runPromise(createMcpNote(server.db, editorInput)),
      PrivatePermissionDenied,
      "Revoked editor must not replay a once-authorized receipt",
    );
  } finally {
    await server.close();
  }

  const reopened = await open();
  try {
    const first = await reopened.db.one(app.shapes.where({ id: firstId }));
    const second = await reopened.db.one(app.shapes.where({ id: secondId }));
    assert.equal(first?.boardId, boardId);
    assert.equal(first?.authorId, editorId);
    assert.equal(first?.authorName, "Friend B");
    assert.equal(second?.boardId, boardId);
    assert.equal(second?.authorId, ownerId);
    assert.equal(second?.authorName, "Owner A");
    console.log("PRIVATE_ACTOR_REPLAY_REVOKED_RESTART_PASS", JSON.stringify({
      boardId, editorNoteId: firstId, ownerNoteId: secondId,
    }));
  } finally {
    await reopened.close();
    await rm(path, { recursive: true, force: true });
  }
});

test("private owner/editor note mutation remains authorized and durable", async () => {
  const path = await mkdtemp(join(tmpdir(), "patchboard-private-mutations-"));
  const open = () => createJazz({ app, permissions: privatePermissions,
    store: sqlite({ path }), authenticate: () => null }).ready();
  let server = await open();
  const ownerId = randomUUID(), editorId = randomUUID();
  const viewerId = randomUUID(), strangerId = randomUUID();
  let boardId, noteId;
  try {
    const board = server.db.insert(app.boards, { ownerId, title: "Private edit" });
    await board.wait({ tier: "global" });
    boardId = board.value.id;
    const editor = server.db.insert(app.boardMembers, {
      boardId, userId: editorId, role: "editor",
    });
    const viewer = server.db.insert(app.boardMembers, {
      boardId, userId: viewerId, role: "viewer",
    });
    await Promise.all([editor.wait({ tier: "global" }), viewer.wait({ tier: "global" })]);
    noteId = (await Effect.runPromise(createMcpNote(server.db, {
      boardId, actorId: ownerId, authorName: "Original author",
      requestId: randomUUID(), text: "Original note",
    }))).note_id;
    await changePrivateNote(server.db, {
      noteId, actorId: editorId, fields: { text: "Edited by editor" },
    });
    await changePrivateNote(server.db, {
      noteId, actorId: editorId, fields: { x: 70, y: 110 },
    });
    await changePrivateNote(server.db, {
      noteId, actorId: ownerId, fields: { x: 80, y: 120 },
    });
    const result = await server.db.one(app.shapes.where({ id: noteId }));
    assert.equal(result?.text, "Edited by editor");
    assert.deepEqual([result?.x, result?.y], [80, 120]);
    assert.equal(result?.authorId, ownerId);
    assert.equal(result?.authorName, "Original author");
    for (const actorId of [viewerId, strangerId]) {
      await assert.rejects(() => changePrivateNote(server.db, {
        noteId, actorId, fields: { text: "Forbidden edit" },
      }), PrivatePermissionDenied);
      await assert.rejects(() => changePrivateNote(server.db, {
        noteId, actorId, fields: { x: 0, y: 0 },
      }), PrivatePermissionDenied);
    }
    const otherBoard = server.db.insert(app.boards, {
      ownerId: strangerId, title: "Other private board",
    });
    await otherBoard.wait({ tier: "global" });
    const otherNote = await Effect.runPromise(createMcpNote(server.db, {
      boardId: otherBoard.value.id, actorId: strangerId, authorName: "Stranger",
      requestId: randomUUID(), text: "Cross-board original",
    }));
    await assert.rejects(() => changePrivateNote(server.db, {
      noteId: otherNote.note_id, actorId: editorId, fields: { text: "Cross-board forgery" },
    }), PrivatePermissionDenied);
    assert.equal((await server.db.one(app.shapes.where({ id: otherNote.note_id })))?.text,
      "Cross-board original");
    await server.db.delete(app.boardMembers, editor.value.id).wait({ tier: "global" });
    await assert.rejects(() => changePrivateNote(server.db, {
      noteId, actorId: editorId, fields: { x: 1, y: 1 },
    }), PrivatePermissionDenied);
  } finally {
    await server.close();
  }
  server = await open();
  try {
    const note = await server.db.one(app.shapes.where({ id: noteId }));
    assert.equal(note?.boardId, boardId);
    assert.equal(note?.text, "Edited by editor");
    assert.deepEqual([note?.x, note?.y], [80, 120]);
    assert.equal(note?.authorId, ownerId);
    console.log("PRIVATE_NOTE_EDIT_MOVE_AUTHZ_RESTART_PASS", noteId);
  } finally {
    await server.close();
    await rm(path, { recursive: true, force: true });
  }
});
