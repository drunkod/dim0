import assert from "node:assert/strict";
import test from "node:test";
import { handlePrivateCanvasStream } from "../src/private-canvas-stream.ts";

function request(method, url) {
  return { method, url, headers: {} };
}

function response() {
  let finish;
  const completed = new Promise((resolve) => { finish = resolve; });
  return {
    completed,
    headersSent: false,
    writableEnded: false,
    writeHead(status, headers = {}) {
      this.headersSent = true;
      this.status = status;
      this.headers = headers;
      return this;
    },
    end() {
      this.writableEnded = true;
      finish();
      return this;
    },
  };
}

const path = "/patchboard-private/api/canvas/stream";
const unusedDb = {};
const unusedAccountResolver = async () => { throw new Error("must not resolve account"); };

test("private canvas stream rejects non-GET requests", async () => {
  const res = response();
  assert.equal(handlePrivateCanvasStream(request("POST", path), res, unusedDb, unusedAccountResolver), true);
  await res.completed;
  assert.equal(res.status, 405);
  assert.equal(res.headers.Allow, "GET");
});

test("private canvas stream rejects malformed board IDs before auth", async () => {
  const res = response();
  assert.equal(handlePrivateCanvasStream(
    request("GET", `${path}?board_id=not-a-uuid`), res, unusedDb, unusedAccountResolver,
  ), true);
  await res.completed;
  assert.equal(res.status, 400);
});

test("private canvas stream rejects requests without an authorized session", async () => {
  const res = response();
  assert.equal(handlePrivateCanvasStream(
    request("GET", `${path}?board_id=00000000-0000-4000-8000-000000000001`),
    res,
    unusedDb,
    unusedAccountResolver,
  ), true);
  await res.completed;
  assert.equal(res.status, 401);
});
