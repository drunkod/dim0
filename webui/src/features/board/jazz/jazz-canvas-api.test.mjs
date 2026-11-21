import test from "node:test";
import assert from "node:assert/strict";
import {
  splitJazzCanvasEntities, loadJazzCanvas, createJazzCanvasEntity,
  updateJazzCanvasEntity, JazzCanvasApiError,
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
    assert.equal(calls.length, 3);
    assert.ok(calls.every(({ options }) => options.credentials === "include" && options.cache === "no-store"));
    assert.match(calls[0].url, /canvas\?board_id=/);
    assert.equal(JSON.parse(calls[2].options.body).expected_version, 4);
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
