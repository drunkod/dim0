import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";
const { chromium, expect } = createRequire(new URL("../../web/package.json", import.meta.url))("@playwright/test");

const root = resolve(new URL("../../..", import.meta.url).pathname);
const serverRequire = createRequire(new URL("../package.json", import.meta.url));
const { Client } = serverRequire("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = serverRequire(
  "@modelcontextprotocol/sdk/client/streamableHttp.js",
);

async function freePort() {
  const listener = createServer();
  await new Promise((resolveListen) => listener.listen(0, "127.0.0.1", resolveListen));
  const selected = listener.address().port;
  await new Promise((resolveClose) => listener.close(resolveClose));
  return selected;
}

const port = await freePort();
const dataRoot = await mkdtemp(join(tmpdir(), "patchboard-demo-proof-"));
let child;
let browser;
let first;
let second;

async function captureJazzUpgrade(url) {
  const target = new URL(url);
  return new Promise((resolveUpgrade, rejectUpgrade) => {
    const socket = createConnection(Number(target.port), target.hostname);
    socket.setTimeout(5_000, () => {
      socket.destroy();
      rejectUpgrade(new Error("Timed out waiting for prefixed Jazz WebSocket upgrade"));
    });
    socket.once("error", rejectUpgrade);
    socket.once("connect", () => {
      socket.write(
        "GET /patchboard/jazz HTTP/1.1\r\n" +
        "Host: " + target.host + "\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        "Sec-WebSocket-Version: 13\r\n" +
        "Sec-WebSocket-Key: SGVsbG9XZWJTb2NrZXQ=\r\n\r\n",
      );
    });
    socket.once("data", (chunk) => {
      const response = chunk.toString();
      socket.destroy();
      resolveUpgrade(response.split("\r\n", 1)[0]);
    });
  });
}

function startDemo() {
  return new Promise((resolveStart, rejectStart) => {
    const output = [];
    child = spawn("pnpm", ["demo:start"], {
      cwd: root,
      env: {
        ...process.env,
        PATCHBOARD_DEMO_ROOT: dataRoot,
        PATCHBOARD_DEMO_PORT: String(port),
      },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
    });
    const onData = (chunk) => {
      const text = chunk.toString();
      output.push(text);
      const match = text.match(/Patchboard demo: (http:\/\/[^ ]+\/patchboard\/\?board=([0-9a-f-]+))/);
      if (match) {
        child.stdout.off("data", onData);
        resolveStart({ url: match[1], boardId: match[2], output: output.join("") });
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", (chunk) => output.push(chunk.toString()));
    child.once("error", rejectStart);
    child.once("exit", (code) => {
      if (code !== null && code !== 0) rejectStart(new Error("demo:start exited " + code + "\n" + output.join("")));
    });
  });
}

async function stopDemo() {
  if (!child || child.exitCode !== null) return;
  process.kill(-child.pid, "SIGTERM");
  await new Promise((resolveStop) => child.once("exit", resolveStop));
  child = undefined;
}

try {
  const firstRun = await startDemo();
  const health = await fetch(firstRun.url.replace(/\/patchboard\/.*$/, "/health"));
  assert.equal(health.status, 200);
  const boardUrl = firstRun.url;
  browser = await chromium.launch({ headless: true });
  first = await browser.newContext();
  second = await browser.newContext();
  const pageA = await first.newPage();
  const pageB = await second.newPage();
  await Promise.all([pageA.goto(boardUrl), pageB.goto(boardUrl)]);
  await Promise.all([
    expect(pageA.getByRole("heading", { name: "Shared board" })).toBeVisible({ timeout: 20_000 }),
    expect(pageB.getByRole("heading", { name: "Shared board" })).toBeVisible({ timeout: 20_000 }),
  ]);
  const client = new Client({ name: "patchboard-demo-proof", version: "1" });
  await client.connect(
    new StreamableHTTPClientTransport(
      new URL(firstRun.url.replace(/\/patchboard\/.*$/, "/patchboard-mcp")),
    ),
  );
  const tools = await client.listTools();
  assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), ["create_note", "read_board"]);
  const before = await client.callTool({ name: "read_board", arguments: {} });
  assert.equal(before.isError, undefined);
  const marker = "demo-start-proof-" + Date.now();
  const requestId = "demo-start-request-" + Date.now();
  const createdResult = await client.callTool({
    name: "create_note",
    arguments: { text: marker, request_id: requestId },
  });
  assert.equal(createdResult.isError, undefined, JSON.stringify(createdResult));
  const created = JSON.parse(createdResult.content[0].text);
  assert.equal(created.board_id, firstRun.boardId);
  await Promise.all([
    expect(pageA.locator(".note").filter({ hasText: marker })).toBeVisible({ timeout: 20_000 }),
    expect(pageB.locator(".note").filter({ hasText: marker })).toBeVisible({ timeout: 20_000 }),
  ]);
  await client.close();
  await Promise.all([pageA.goto("about:blank"), pageB.goto("about:blank")]);
  await stopDemo();

  const secondRun = await startDemo();
  assert.equal(secondRun.boardId, firstRun.boardId);
  await Promise.all([pageA.goto(secondRun.url), pageB.goto(secondRun.url)]);
  await Promise.all([
    expect(pageA.locator(".note").filter({ hasText: marker })).toBeVisible({ timeout: 20_000 }),
    expect(pageB.locator(".note").filter({ hasText: marker })).toBeVisible({ timeout: 20_000 }),
  ]);
  const retry = new Client({ name: "patchboard-demo-retry", version: "1" });
  await retry.connect(
    new StreamableHTTPClientTransport(
      new URL(secondRun.url.replace(/\/patchboard\/.*$/, "/patchboard-mcp")),
    ),
  );
  const replayResult = await retry.callTool({
    name: "create_note",
    arguments: { text: marker, request_id: requestId },
  });
  assert.equal(replayResult.isError, undefined, JSON.stringify(replayResult));
  const replay = JSON.parse(replayResult.content[0].text);
  assert.equal(replay.board_id, firstRun.boardId);
  assert.equal(replay.note_id, created.note_id);
  const after = await retry.callTool({ name: "read_board", arguments: {} });
  const board = JSON.parse(after.content[0].text);
  assert.equal(board.board_id, firstRun.boardId);
  const restored = board.notes.filter((note) => note.id === created.note_id);
  assert.equal(restored.length, 1);
  assert.deepEqual({ text: restored[0].text, x: restored[0].x, y: restored[0].y }, { text: marker, x: 40, y: 45 });
  console.log("DEMO_START_ACCEPTANCE_PASS", JSON.stringify({
    boardId: firstRun.boardId,
    noteId: created.note_id,
    browserProfiles: 2,
    restarted: true,
  }));
  await retry.close();
} finally {
  await stopDemo();
  await first?.close();
  await second?.close();
  await browser?.close();
  await rm(dataRoot, { recursive: true, force: true });
}
