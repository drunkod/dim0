#!/usr/bin/env node
// Usage: JAZZ_BASE_URL=http://127.0.0.1:3000 JAZZ_BOARD_ID=<uuid> [JAZZ_COOKIE='...'] node scripts/jazz-canvas-smoke.mjs

const baseUrl = process.env.JAZZ_BASE_URL;
const boardId = process.env.JAZZ_BOARD_ID;
const cookie = process.env.JAZZ_COOKIE;
const timeoutMs = Number(process.env.JAZZ_TIMEOUT_MS ?? 10_000);
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!baseUrl || !boardId || !uuidPattern.test(boardId)) {
  console.error("Set JAZZ_BASE_URL and a UUID-valued JAZZ_BOARD_ID.");
  process.exit(2);
}
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error("JAZZ_TIMEOUT_MS must be a positive number.");
  process.exit(2);
}

const headers = cookie ? { Cookie: cookie } : {};
const endpoint = new URL("/patchboard-private/api/canvas", baseUrl);
endpoint.searchParams.set("board_id", boardId);

async function main() {
  const getController = new AbortController();
  const getTimer = setTimeout(() => getController.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, { headers, signal: getController.signal });
    if (!response.ok) throw new Error(`canvas GET returned HTTP ${response.status}`);
    const snapshot = await response.json();
    if (snapshot.board_id !== boardId || !Array.isArray(snapshot.entities)) {
      throw new Error("canvas GET returned an invalid board snapshot");
    }
    console.log(`canvas GET: ok (${snapshot.entities.length} entities)`);
  } finally {
    clearTimeout(getTimer);
  }

  const streamUrl = new URL("/patchboard-private/api/canvas/stream", baseUrl);
  streamUrl.searchParams.set("board_id", boardId);
  const streamController = new AbortController();
  const streamTimer = setTimeout(() => streamController.abort(), timeoutMs);
  try {
    const response = await fetch(streamUrl, {
      headers: { ...headers, Accept: "text/event-stream" },
      signal: streamController.signal,
    });
    if (!response.ok) throw new Error(`canvas SSE returned HTTP ${response.status}`);
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("canvas SSE response has unexpected content type");
    }
    if (!response.body) throw new Error("canvas SSE response has no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) throw new Error("canvas SSE ended before its first snapshot");
      buffered += decoder.decode(value, { stream: true });
      const events = buffered.split(/\r?\n\r?\n/);
      buffered = events.pop() ?? "";
      for (const event of events) {
        const lines = event.split(/\r?\n/);
        if (!lines.some((line) => line === "event: snapshot")) continue;
        const data = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
        const snapshot = JSON.parse(data);
        if (snapshot.board_id !== boardId || !Array.isArray(snapshot.entities)) {
          throw new Error("canvas SSE returned an invalid board snapshot");
        }
        console.log(`canvas SSE first snapshot: ok (${snapshot.entities.length} entities)`);
        return;
      }
    }
  } finally {
    clearTimeout(streamTimer);
    streamController.abort();
  }
}

main().catch((error) => {
  const detail = error?.name === "AbortError" ? `timed out after ${timeoutMs} ms` : error.message;
  console.error(`Jazz canvas smoke check failed: ${detail}`);
  process.exitCode = 1;
});
