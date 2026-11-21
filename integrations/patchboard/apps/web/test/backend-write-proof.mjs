import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { app } from "@patchboard/jazz-schema";
import { startBoardServer } from "../../server/src/http-server.ts";
import { createNoteFromBackend } from "../../server/src/board-service.ts";

const sdkRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const { Client } = sdkRequire("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = sdkRequire(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);

async function freePort() {
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  return port;
}

async function waitForHealth(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      /* process may still be starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("Preview did not become healthy: " + url);
}

const webDir = fileURLToPath(new URL("../", import.meta.url));
const dataPath = await mkdtemp(join(tmpdir(), "patchboard-live-backend-proof-"));
const port = await freePort();
const webPort = await freePort();
const address = `http://127.0.0.1:${webPort}`;
const boardId = randomUUID();
let running;
let preview;
let browser;
let first;
let second;
try {
  running = await startBoardServer({ port, webPort, dataPath, demoBoardId: boardId });
  preview = spawn(
    process.execPath,
    [
      join(webDir, "node_modules/vite/bin/vite.js"),
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      String(webPort),
      "--strictPort",
    ],
    {
      cwd: webDir,
      env: { ...process.env, PATCHBOARD_JAZZ_PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let previewError = "";
  preview.stderr.on("data", (chunk) => {
    previewError += chunk.toString();
  });
  await waitForHealth(address + "/");

  const boardResult = running.jazz.db.insert(
    app.boards,
    {
      title: "Backend Jazz write proof",
      ownerId: randomUUID(),
    },
    { id: boardId },
  );
  await boardResult.wait({ tier: "global" });
  const url = address + "/?board=" + boardId;
  browser = await chromium.launch({ headless: true });
  first = await browser.newContext();
  second = await browser.newContext();
  const pageA = await first.newPage();
  const pageB = await second.newPage();
  await Promise.all([pageA.goto(url), pageB.goto(url)]);
  await Promise.all([
    expect(pageA.getByRole("heading", { name: "Backend Jazz write proof" })).toBeVisible({
      timeout: 15_000,
    }),
    expect(pageB.getByRole("heading", { name: "Backend Jazz write proof" })).toBeVisible({
      timeout: 15_000,
    }),
  ]);

  // Crucial: write with the owning Node/Jazz backend's Db, NOT a new Jazz client.
  const note = await createNoteFromBackend(running.jazz.db, {
    boardId,
    text: "Back-end insert visible in both profiles",
    zIndex: 0,
  });
  const noteId = note.id;
  await Promise.all([
    expect(pageA.locator(".note").filter({ hasText: note.text })).toBeVisible({ timeout: 15_000 }),
    expect(pageB.locator(".note").filter({ hasText: note.text })).toBeVisible({ timeout: 15_000 }),
  ]);
  console.log("LIVE_SYNC_PASS", JSON.stringify({ boardId, noteId, port, webPort }));

  // Both browsers were subscribed before this real MCP SDK tool call.
  const mcp = new Client({ name: "patchboard-browser-proof", version: "1" });
  let mcpNoteId;
  try {
    await mcp.connect(
      new StreamableHTTPClientTransport(new URL("http://127.0.0.1:" + port + "/patchboard-mcp")),
    );
    const call = await mcp.callTool({
      name: "create_note",
      arguments: { text: "MCP note delivered without refresh", request_id: "browser-proof-1" },
    });
    assert.ok(!call.isError, JSON.stringify(call));
    const created = JSON.parse(call.content[0].text);
    assert.equal(created.board_id, boardId);
    mcpNoteId = created.note_id;
    await Promise.all([
      expect(
        pageA.locator(".note").filter({ hasText: "MCP note delivered without refresh" }),
      ).toBeVisible({ timeout: 15_000 }),
      expect(
        pageB.locator(".note").filter({ hasText: "MCP note delivered without refresh" }),
      ).toBeVisible({ timeout: 15_000 }),
    ]);
    console.log(
      "MCP_LIVE_SYNC_PASS",
      JSON.stringify({ boardId, noteId: mcpNoteId, browserProfiles: 2 }),
    );
  } finally {
    await mcp.close();
  }

  // Release browser sockets, restart the exact Node/Jazz service with the same SQLite path.
  await Promise.all([pageA.goto("about:blank"), pageB.goto("about:blank")]);
  await running.close();
  running = await startBoardServer({ port, webPort, dataPath, demoBoardId: boardId });
  const persisted = await running.jazz.db.one(app.shapes.where({ id: noteId }));
  const mcpPersisted = await running.jazz.db.one(app.shapes.where({ id: mcpNoteId }));
  assert.ok(mcpPersisted, "MCP-created exact note ID must survive restart");
  assert.equal(mcpPersisted.id, mcpNoteId);
  assert.equal(mcpPersisted.boardId, boardId);
  assert.equal(mcpPersisted.text, "MCP note delivered without refresh");
  assert.equal(mcpPersisted.x, 310);
  assert.equal(mcpPersisted.y, 45);
  assert.ok(persisted, "Exact note ID must be present after backend restart");
  assert.equal(persisted.id, noteId);
  assert.equal(persisted.boardId, boardId);
  assert.equal(persisted.text, "Back-end insert visible in both profiles");
  assert.equal(persisted.x, 40);
  assert.equal(persisted.y, 45);
  await Promise.all([pageA.goto(url), pageB.goto(url)]);
  await Promise.all([
    expect(pageA.locator(".note").filter({ hasText: persisted.text })).toBeVisible({
      timeout: 15_000,
    }),
    expect(pageB.locator(".note").filter({ hasText: persisted.text })).toBeVisible({
      timeout: 15_000,
    }),
  ]);
  await Promise.all([
    expect(pageA.locator(".note").filter({ hasText: mcpPersisted.text })).toBeVisible({
      timeout: 15_000,
    }),
    expect(pageB.locator(".note").filter({ hasText: mcpPersisted.text })).toBeVisible({
      timeout: 15_000,
    }),
  ]);
  console.log(
    "MCP_RESTART_EXACT_ID_PASS",
    JSON.stringify({ boardId, noteId: mcpNoteId, browserProfiles: 2 }),
  );
  console.log(
    "RESTART_EXACT_ID_PASS",
    JSON.stringify({
      boardId,
      noteId,
      browserProfiles: 2,
      persisted: true,
      origin: address,
      previewError: previewError.slice(0, 200),
    }),
  );
} finally {
  await first?.close();
  await second?.close();
  await browser?.close();
  if (preview && preview.exitCode === null) preview.kill("SIGTERM");
  await running?.close();
  await rm(dataPath, { recursive: true, force: true });
}
