import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "../jazz.generated.ts";
import permissions from "../jazz.permissions.json" with { type: "json" };
import { createNoteFromBackend } from "../../../apps/server/src/board-service.ts";

test("the local Jazz backend preserves a fixture account across restart", async () => {
  const path = await mkdtemp(join(tmpdir(), "patchboard-jazz-"));
  const userId = "m1-fixture-owner";
  const request = new Request("http://localhost/fixture");
  const open = () =>
    createJazz({
      app,
      permissions,
      store: sqlite({ path }),
      authenticate: () => ({ userId, expiresAt: Math.floor(Date.now() / 1000) + 3600 }),
    }).ready();

  try {
    const first = await open();
    let accountId;
    try {
      accountId = await first.createAccountFor(userId);
      assert.ok(accountId);
    } finally {
      await first.close();
    }
    const reopened = await open();
    try {
      assert.equal(await reopened.accountFor(request), accountId);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});

test("a backend-created note survives SQLite restart with the same row ID", async () => {
  const path = await mkdtemp(join(tmpdir(), "patchboard-backend-note-"));
  const open = () =>
    createJazz({
      app,
      permissions,
      store: sqlite({ path }),
      authenticate: () => ({
        userId: "m1-fixture-owner",
        expiresAt: Math.floor(Date.now() / 1000) + 3600,
      }),
    }).ready();

  try {
    const first = await open();
    let boardId;
    let noteId;
    try {
      const board = first.db.insert(app.boards, { title: "Backend proof", ownerId: randomUUID() });
      await board.wait({ tier: "global" });
      boardId = board.value.id;
      const note = await createNoteFromBackend(first.db, {
        boardId,
        text: "Backend note persisted",
        zIndex: 0,
      });
      noteId = note.id;
      const inMemory = await first.db.one(app.shapes.where({ id: noteId }));
      assert.equal(inMemory?.text, "Backend note persisted");
    } finally {
      await first.close();
    }
    const reopened = await open();
    try {
      const restored = await reopened.db.one(app.shapes.where({ id: noteId }));
      assert.ok(restored, "the exact note ID must be readable after restart");
      assert.equal(restored.id, noteId);
      assert.equal(restored.boardId, boardId);
      assert.equal(restored.text, "Backend note persisted");
      assert.equal(restored.kind, "note");
      assert.equal(restored.x, 40);
      assert.equal(restored.y, 45);
    } finally {
      await reopened.close();
    }
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
