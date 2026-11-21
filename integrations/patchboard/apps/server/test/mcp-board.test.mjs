import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { app } from "@patchboard/jazz-schema";
import { startBoardServer } from "../src/http-server.ts";
import { createNoteFromBackend } from "../src/board-service.ts";

test("read_board returns only notes on the configured Jazz board", async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-mcp-"));
  const boardId = randomUUID();
  const client = new Client({ name: "patchboard-smoke", version: "1" });
  let server;
  try {
    server = await startBoardServer({ port: 0, dataPath, demoBoardId: boardId });
    const db = server.jazz.db;
    for (const [id, title] of [
      [boardId, "Demo"],
      [randomUUID(), "Other"],
    ]) {
      await db
        .insert(app.boards, { title, ownerId: randomUUID() }, { id })
        .wait({ tier: "global" });
      await createNoteFromBackend(db, { boardId: id, text: title + " note", zIndex: 0 });
    }
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + server.port + "/patchboard-mcp"),
      ),
    );
    assert.ok((await client.listTools()).tools.some((tool) => tool.name === "read_board"));
    const result = await client.callTool({ name: "read_board", arguments: {} });
    assert.ok(!result.isError);
    const board = JSON.parse(result.content[0].text);
    assert.equal(board.board_id, boardId);
    assert.deepEqual(
      board.notes.map((note) => note.text),
      ["Demo note"],
    );
  } finally {
    await client.close();
    await server?.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test("create_note writes only to the resolved demo board and read_board returns its ID", async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-mcp-write-"));
  const boardId = randomUUID();
  const otherBoardId = randomUUID();
  const client = new Client({ name: "patchboard-write-test", version: "1" });
  let server;
  try {
    server = await startBoardServer({ port: 0, dataPath, demoBoardId: boardId });
    for (const id of [boardId, otherBoardId]) {
      await server.jazz.db
        .insert(
          app.boards,
          { title: id === boardId ? "Selected" : "Other", ownerId: randomUUID() },
          { id },
        )
        .wait({ tier: "global" });
    }
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + server.port + "/patchboard-mcp"),
      ),
    );
    assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
      "create_note",
      "read_board",
    ]);
    const result = await client.callTool({
      name: "create_note",
      arguments: { text: "  Created from SDK  ", request_id: "demo-create-01" },
    });
    assert.equal(result.isError, undefined, JSON.stringify(result));
    const created = JSON.parse(result.content[0].text);
    assert.equal(created.board_id, boardId);
    assert.match(created.note_id, /^[0-9a-f-]{36}$/);
    const next = await client.callTool({ name: "read_board", arguments: {} });
    const board = JSON.parse(next.content[0].text);
    assert.equal(board.board_id, boardId);
    assert.deepEqual(
      board.notes.map((note) => note.id),
      [created.note_id],
    );
    assert.deepEqual(
      board.notes.map((note) => note.text),
      ["Created from SDK"],
    );
    assert.equal((await server.jazz.db.all(app.shapes.where({ boardId: otherBoardId }))).length, 0);
  } finally {
    await client.close();
    await server?.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test("create_note validation rejects oversized, missing and cross-board overrides", async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-mcp-invalid-"));
  const boardId = randomUUID();
  const otherBoardId = randomUUID();
  const client = new Client({ name: "patchboard-validation-test", version: "1" });
  let server;
  try {
    server = await startBoardServer({ port: 0, dataPath, demoBoardId: boardId });
    for (const id of [boardId, otherBoardId]) {
      await server.jazz.db
        .insert(app.boards, { title: "Test", ownerId: randomUUID() }, { id })
        .wait({ tier: "global" });
    }
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + server.port + "/patchboard-mcp"),
      ),
    );

    const invalid = [
      { text: "   ", request_id: "no-text" },
      { text: "x".repeat(2001), request_id: "too-long" },
      { text: "okay", request_id: "" },
      { text: "okay", request_id: "x".repeat(129) },
      { text: "okay", request_id: "missing", board_id: otherBoardId },
      { text: "okay", request_id: "other-user", user_id: randomUUID() },
    ];
    for (const args of invalid) {
      const outcome = await client.callTool({ name: "create_note", arguments: args });
      assert.equal(
        outcome.isError,
        true,
        "invalid payload unexpectedly succeeded: " + JSON.stringify(args),
      );
    }
    assert.equal((await server.jazz.db.all(app.shapes)).length, 0);
  } finally {
    await client.close();
    await server?.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test("create_note refuses a missing configured board with a bounded error", async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-mcp-missing-"));
  const client = new Client({ name: "patchboard-missing-test", version: "1" });
  let server;
  try {
    server = await startBoardServer({ port: 0, dataPath, demoBoardId: randomUUID() });
    await client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + server.port + "/patchboard-mcp"),
      ),
    );
    const outcome = await client.callTool({
      name: "create_note",
      arguments: { text: "Must not appear", request_id: "missing-board" },
    });
    assert.equal(outcome.isError, true);
    assert.match(outcome.content[0].text, /BOARD_UNAVAILABLE|WRITE_FAILED/);
    assert.equal((await server.jazz.db.all(app.shapes)).length, 0);
  } finally {
    await client.close();
    await server?.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test("create_note deduplicates sequential, parallel and post-restart retries", async () => {
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-mcp-retry-"));
  const boardId = randomUUID();
  let server;
  let client = new Client({ name: "patchboard-retry-test", version: "1" });
  const connect = async () =>
    client.connect(
      new StreamableHTTPClientTransport(
        new URL("http://127.0.0.1:" + server.port + "/patchboard-mcp"),
      ),
    );
  const create = async (text, request_id) => {
    const result = await client.callTool({ name: "create_note", arguments: { text, request_id } });
    return result.isError ? result : JSON.parse(result.content[0].text);
  };
  try {
    server = await startBoardServer({ port: 0, dataPath, demoBoardId: boardId });
    await server.jazz.db
      .insert(app.boards, { title: "Retry board", ownerId: randomUUID() }, { id: boardId })
      .wait({ tier: "global" });
    await connect();

    const first = await create("  Original note  ", "retry-key-a");
    assert.equal(first.board_id, boardId, JSON.stringify(first));
    const replay = await create("Original note", "retry-key-a");
    assert.equal(replay.note_id, first.note_id, "same key should return original ID");
    const conflict = await create("Different note", "retry-key-a");
    assert.equal(conflict.isError, true);
    assert.match(conflict.content[0].text, /REQUEST_ID_CONFLICT/);

    // A receipt persists the original request independently from later note edits.
    await server.jazz.db
      .update(app.shapes, first.note_id, { text: "Edited later" })
      .wait({ tier: "global" });
    assert.equal((await create("Original note", "retry-key-a")).note_id, first.note_id);

    const parallel = await Promise.all(
      Array.from({ length: 6 }, () => create("Simultaneous calls", "retry-key-parallel")),
    );
    assert.equal(parallel.filter((item) => item.isError).length, 0, JSON.stringify(parallel));
    assert.equal(new Set(parallel.map((item) => item.note_id)).size, 1, JSON.stringify(parallel));
    const secondId = parallel[0].note_id;
    assert.notEqual(secondId, first.note_id);
    assert.equal((await server.jazz.db.all(app.shapes.where({ boardId }))).length, 2);

    // Simultaneous conflicting payloads must choose one winner, not two notes.
    const racingTexts = ["First racer", "Second racer"];
    const raced = await Promise.all(racingTexts.map((text) => create(text, "retry-key-conflict")));
    assert.equal(raced.filter((item) => !item.isError).length, 1, JSON.stringify(raced));
    assert.equal(raced.filter((item) => item.isError).length, 1, JSON.stringify(raced));
    assert.match(raced.find((item) => item.isError).content[0].text, /REQUEST_ID_CONFLICT/);
    assert.equal((await server.jazz.db.all(app.shapes.where({ boardId }))).length, 3);

    // Restart the actual Node/Jazz listener with the same SQLite directory.
    const port = server.port;
    await client.close();
    await server.close();
    server = await startBoardServer({ port, dataPath, demoBoardId: boardId });
    client = new Client({ name: "patchboard-retry-after-restart", version: "1" });
    await connect();
    const afterRestart = await create("Original note", "retry-key-a");
    assert.equal(afterRestart.note_id, first.note_id);
    const parallelAfterRestart = await create("Simultaneous calls", "retry-key-parallel");
    assert.equal(parallelAfterRestart.note_id, secondId);
    assert.equal((await server.jazz.db.all(app.shapes.where({ boardId }))).length, 3);
    const stored = await server.jazz.db.one(app.shapes.where({ id: first.note_id }));
    assert.equal(stored.text, "Edited later");
    assert.equal(stored.boardId, boardId);
    console.log(
      "MCP_RETRY_RESTART_PASS",
      JSON.stringify({ boardId, noteId: first.note_id, parallelNoteId: secondId }),
    );
  } finally {
    await client.close();
    await server?.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});

test("two Patchboard users can reuse a request ID on the same board independently", async () => {
  const { Effect } = await import("effect");
  const { createMcpNote } = await import("../src/board-service.ts");
  const dataPath = await mkdtemp(join(tmpdir(), "patchboard-actor-retries-"));
  const boardId = randomUUID();
  const owner = randomUUID();
  const editor = randomUUID();
  const server = await startBoardServer({ port: 0, dataPath, demoBoardId: boardId });
  try {
    const db = server.jazz.db;
    await db.insert(app.boards, { title: "Collaboration", ownerId: owner }, { id: boardId }).wait({ tier: "global" });
    // In the private security model, a verified editor must be a member of
    // this board; a mere caller-supplied actorId is not sufficient.
    await db.insert(app.boardMembers, {
      boardId, userId: editor, role: "editor",
    }).wait({ tier: "global" });
    const create = (actorId) => Effect.runPromise(createMcpNote(db, {
      boardId, actorId, text: "Shared text", requestId: "first-note",
    }));
    const first = await create(owner);
    const second = await create(editor);
    assert.notEqual(first.note_id, second.note_id);
    assert.deepEqual(await create(owner), first);
    assert.deepEqual(await create(editor), second);
  } finally {
    await server.close();
    await rm(dataPath, { recursive: true, force: true });
  }
});
