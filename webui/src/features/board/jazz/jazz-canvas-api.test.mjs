import test from "node:test";
import assert from "node:assert/strict";
import {
  splitJazzCanvasEntities, loadJazzCanvas, createJazzCanvasEntity,
  updateJazzCanvasEntity, deleteJazzCanvasEntity, JazzCanvasApiError, subscribeJazzCanvas,
} from "./jazz-canvas-api.ts";

const boardId = "5a1bcf50-5978-4229-a79d-3dc475cb5c4e";
const nodeId = "e91393c2-51f4-420f-9655-4d0be45de46b";
const linkId = "e7fa5d1a-dc4a-45cb-9b2e-14f29bf61d33";

test("Jazz -> Dim0 projection preserves applet JSX and links without field loss", () => {
  const applet = {
    id: nodeId, graphUid: boardId, type: "note", version: 1,
    properties: { programmingLanguage: { type: "text", text: "tsx" } },
    content: { markdown: "<Widget state={{ count: 1 }} />" },
    style: { type: "applet" },
  };
  const link = {
    id: linkId, type: "link", graphUid: boardId,
    source: nodeId, target: nodeId, properties: { edgeControlPoint: {} }, style: {},
  };
  assert.deepEqual(splitJazzCanvasEntities({
    board_id: boardId,
    entities: [
      { id: nodeId, boardId, payload: applet, kind: "node", version: 1, updatedBy: nodeId },
      { id: linkId, boardId, payload: link, kind: "link", version: 1, updatedBy: nodeId },
    ],
  }), { notes: [applet], links: [link] });
  assert.throws(() => splitJazzCanvasEntities({
    board_id: boardId,
    entities: [{ id: nodeId, boardId, payload: { ...applet, graphUid: "wrong" },
      kind: "node", version: 1, updatedBy: nodeId }],
  }), /scope mismatch/);
  for (const malformed of [
    { boardId: "other", payload: applet },
    { boardId, payload: { ...applet, graphUid: "other" } },
    { boardId, payload: { ...applet, id: linkId } },
  ]) {
    assert.throws(() => splitJazzCanvasEntities({
      board_id: boardId,
      entities: [{ id: nodeId, ...malformed, kind: "node", version: 1, updatedBy: nodeId }],
    }), /scope mismatch/);
  }
  assert.throws(() => splitJazzCanvasEntities({
    board_id: boardId,
    entities: [{ id: nodeId, boardId, payload: { ...applet, type: "unknown" },
      kind: "node", version: 1, updatedBy: nodeId }],
  }), /Invalid Jazz node/);
});

test("snapshot projection retains complete node and link payload objects", () => {
  const note = {
    id: nodeId, graphUid: boardId, type: "document", version: 3,
    content: { markdown: "# Original", metadata: { source: "import" } },
    properties: { custom: { nested: [1, 2, 3] } }, _storedColors: ["blue"],
  };
  const link = {
    id: linkId, graphUid: boardId, type: "link", source: nodeId, target: nodeId,
    properties: { label: "related", edgeControlPoint: { x: 17, y: 29 } },
    style: { stroke: "purple", custom: true },
  };
  const projected = splitJazzCanvasEntities({ board_id: boardId, entities: [
    { id: nodeId, boardId, payload: note, kind: "node", version: 3, updatedBy: nodeId },
    { id: linkId, boardId, payload: link, kind: "link", version: 2, updatedBy: nodeId },
  ] });
  assert.deepEqual(projected.notes, [note]);
  assert.deepEqual(projected.links, [link]);
});

test("Jazz client uses same-origin credentials, no-store reads and versioned writes", async () => {
  const previousFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify({ board_id: boardId, entities: [] }), {
      headers: { "content-type": "application/json" },
    });
  };
  try {
    await loadJazzCanvas(boardId);
    await createJazzCanvasEntity(boardId, "node", {
      id: nodeId, type: "note", graphUid: boardId,
    });
    await updateJazzCanvasEntity(boardId, nodeId, 4, {
      id: nodeId, type: "note", graphUid: boardId,
    });
    await deleteJazzCanvasEntity(boardId, linkId, 7);
    assert.equal(calls.length, 4);
    assert.ok(calls.every(({ options }) => options.credentials === "include" && options.cache === "no-store"));
    assert.match(calls[0].url, /canvas\?board_id=/);
    assert.equal(calls[0].options.method, "GET");
    assert.equal(calls[1].options.method, "POST");
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      board_id: boardId, kind: "node", payload: { id: nodeId, type: "note", graphUid: boardId },
    });
    assert.equal(calls[2].options.method, "POST");
    assert.equal(JSON.parse(calls[2].options.body).expected_version, 4);
    assert.deepEqual(JSON.parse(calls[3].options.body), {
      board_id: boardId, entity_id: linkId, expected_version: 7,
    });
    assert.equal(calls[3].options.method, "POST");
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("version conflict is surfaced with its HTTP status and operation", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("conflict", { status: 409 });
  try {
    await assert.rejects(
      () => updateJazzCanvasEntity(boardId, nodeId, 2, { id: nodeId, type: "note", graphUid: boardId }),
      (error) => error instanceof JazzCanvasApiError && error.status === 409 && error.operation === "update",
    );
    await assert.rejects(
      () => deleteJazzCanvasEntity(boardId, nodeId, 2),
      (error) => error instanceof JazzCanvasApiError && error.status === 409 && error.operation === "delete",
    );
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Jazz HTTP error is not falsely reported as successful", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("denied", { status: 403 });
  try {
    await assert.rejects(() => loadJazzCanvas(boardId), JazzCanvasApiError);
  } finally {
    globalThis.fetch = previousFetch;
  }
});

test("Jazz SSE subscribes with session cookies, validates board scope and closes", () => {
  const previous = globalThis.EventSource;
  let source;
  class FakeEventSource {
    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.handlers = new Map();
      this.closed = false;
      source = this;
    }
    addEventListener(event, callback) { this.handlers.set(event, callback); }
    emit(event, payload) { this.handlers.get(event)?.({ data: JSON.stringify(payload) }); }
    close() { this.closed = true; }
  }
  globalThis.EventSource = FakeEventSource;
  const snapshots = [];
  const failures = [];
  try {
    const unsubscribe = subscribeJazzCanvas(
      boardId, (snapshot) => snapshots.push(snapshot), (error) => failures.push(error.message),
    );
    assert.equal(source.options.withCredentials, true);
    assert.match(source.url, /canvas\/stream\?board_id=/);
    const expected = { board_id: boardId, role: "viewer", entities: [] };
    source.emit("snapshot", expected);
    assert.deepEqual(snapshots, [expected]);
    source.emit("snapshot", { ...expected, board_id: "other" });
    assert.equal(failures.length, 1);
    assert.match(failures[0], /board mismatch/);
    source.handlers.get("error")();
    assert.equal(failures.length, 2);
    assert.match(failures[1], /disconnected/);
    unsubscribe();
    assert.equal(source.closed, true);
  } finally {
    if (previous === undefined) delete globalThis.EventSource;
    else globalThis.EventSource = previous;
  }
});
