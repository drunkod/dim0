import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const requireWeb = createRequire(new URL("../../web/package.json", import.meta.url));
const requireServer = createRequire(new URL("../package.json", import.meta.url));
const { chromium, expect } = requireWeb("@playwright/test");
const { Client } = requireServer("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = requireServer(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);

const origin = process.env.PATCHBOARD_PUBLIC_ORIGIN?.replace(/\/$/, "");
const root = process.env.PATCHBOARD_DEMO_ROOT;
if (!origin?.startsWith("https://") || !root) {
  throw new Error(
    "Set PATCHBOARD_PUBLIC_ORIGIN=https://... and PATCHBOARD_DEMO_ROOT=/absolute/demo/path",
  );
}
const boardId = (await readFile(join(resolve(root), "board-id"), "utf8")).trim();
assert.match(boardId, /^[a-f\d-]{36}$/i);
const boardUrl = origin + "/patchboard/?board=" + boardId;
const mcpUrl = origin + "/patchboard-mcp";
const outDir = resolve(process.env.PATCHBOARD_EVIDENCE_DIR ?? join(root, "public-evidence"));
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
const client = new Client({ name: "patchboard-public-acceptance", version: "1" });
const handshakes = [],
  errors = [],
  failed = [];
let success = false;
try {
  const pages = await Promise.all(contexts.map((c) => c.newPage()));
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    await contexts[index].tracing.start({ screenshots: true, snapshots: true });
    page.on("pageerror", (e) => errors.push({ index, error: String(e) }));
    page.on("requestfailed", (r) =>
      failed.push({ index, url: r.url(), reason: r.failure()?.errorText }),
    );
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Network.enable");
    const wsUrls = new Map();
    cdp.on("Network.webSocketCreated", (e) => wsUrls.set(e.requestId, e.url));
    cdp.on("Network.webSocketHandshakeResponseReceived", (e) => {
      handshakes.push({ index, url: wsUrls.get(e.requestId), status: e.response.status });
    });
  }
  await Promise.all(pages.map((p) => p.goto(boardUrl, { waitUntil: "domcontentloaded" })));
  await Promise.all(
    pages.map((p) =>
      expect(p.getByRole("heading", { name: "Patchboard demo" })).toBeVisible({ timeout: 20000 }),
    ),
  );
  await Promise.all(
    pages.map((p) =>
      expect(p.getByText("Jazz shared · connected")).toBeVisible({ timeout: 20000 }),
    ),
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(mcpUrl)));
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((t) => t.name).sort(), ["create_note", "read_board"]);
  const before = await client.callTool({ name: "read_board", arguments: {} });
  assert.equal(before.isError, undefined);
  assert.equal(JSON.parse(before.content[0].text).board_id, boardId);

  const marker = "Public Funnel acceptance " + randomUUID().slice(0, 8);
  const requestId = "public-funnel-proof-" + randomUUID();
  const createdResponse = await client.callTool({
    name: "create_note",
    arguments: { text: marker, request_id: requestId },
  });
  assert.equal(createdResponse.isError, undefined, JSON.stringify(createdResponse));
  const created = JSON.parse(createdResponse.content[0].text);
  assert.equal(created.board_id, boardId);
  await Promise.all(
    pages.map((p) =>
      expect(p.locator(".note").filter({ hasText: marker })).toBeVisible({ timeout: 20000 }),
    ),
  );
  const replay = await client.callTool({
    name: "create_note",
    arguments: { text: marker, request_id: requestId },
  });
  assert.equal(replay.isError, undefined);
  assert.equal(JSON.parse(replay.content[0].text).note_id, created.note_id);
  const readback = await client.callTool({ name: "read_board", arguments: {} });
  assert.ok(
    JSON.parse(readback.content[0].text).notes.some(
      (note) => note.id === created.note_id && note.text === marker,
    ),
  );
  assert.ok(
    [0, 1].every((index) =>
      handshakes.some(
        (h) => h.index === index && h.status === 101 && h.url?.includes("/patchboard/jazz/"),
      ),
    ),
    "A browser did not receive the required Jazz WebSocket 101 upgrade",
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(failed, []);
  await Promise.all(
    pages.map((p, i) => p.screenshot({ path: join(outDir, "profile-" + i + ".png") })),
  );
  const evidence = {
    result: "PASS",
    timestamp: new Date().toISOString(),
    boardUrl,
    mcpUrl,
    boardId,
    noteId: created.note_id,
    marker,
    profiles: 2,
    websocketHandshakes: handshakes,
    javascriptErrors: errors,
    failedRequests: failed,
    duplicateNotes: false,
  };
  await writeFile(join(outDir, "public-proof.json"), JSON.stringify(evidence, null, 2) + "\n");
  console.log("PUBLIC_FUNNEL_ACCEPTANCE_PASS", JSON.stringify(evidence));
  success = true;
} finally {
  await client.close().catch(() => {});
  for (let i = 0; i < contexts.length; i++) {
    await contexts[i].tracing
      .stop({ path: join(outDir, "profile-" + i + "-trace.zip") })
      .catch(() => {});
    await contexts[i].close();
  }
  await browser.close();
}
if (!success) process.exitCode = 1;
