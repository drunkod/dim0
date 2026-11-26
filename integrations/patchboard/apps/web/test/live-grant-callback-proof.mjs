/** Real OAuth/SDK callback ordering proof. No production test hooks.
 * Pause the original HTTP body after its headers and first byte. Admission
 * is persisted before the transport can parse/dispatch the complete JSON.
 */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

export async function proveLiveGrantCallback({
  origin, mcpURL, boardId, baseEntity, token, clientId, actorId, writer,
}) {
  const root = process.env.PATCHBOARD_PRIVATE_ROOT;
  const port = Number(process.env.PATCHBOARD_PRIVATE_PORT);
  assert.equal(process.env.PATCHBOARD_OAUTH_CI_RESTART, "1");
  assert.equal(process.env.PATCHBOARD_PRIVATE_DEV, "1");
  assert.equal(origin, "http://localhost:" + port);
  assert.ok(Number.isInteger(port) && port > 1024 && ![8791, 8792, 8793, 8794].includes(port));
  assert.ok(root?.startsWith(join(tmpdir(), "patchboard-private-ci-")));
  const fixtureRoot = realpathSync(root);
  assert.ok(fixtureRoot.startsWith(join(realpathSync(tmpdir()), "patchboard-private-ci-")));
  const dbPath = join(fixtureRoot, "auth", "better-auth.sqlite");
  assert.equal(realpathSync(dbPath), dbPath);
  const db = new DatabaseSync(dbPath);
  const clients = [];
  const trace = [];
  const entityId = randomUUID();
  let created = false;
  const check = (result) => {
    assert.equal(result.isError, undefined);
    return JSON.parse(result.content[0].text);
  };
  const read = client => client.callTool({
    name: "get_canvas_entity", arguments: { board_id: boardId, entity_id: entityId },
  }).then(check);
  const payload = { ...baseEntity, id: entityId, label: { markdown: "Live grant ordering fixture" } };
  const args = { board_id: boardId, entity_id: entityId, expected_version: 1,
    payload: { ...payload, label: { markdown: "Active authorized update" } } };

  try {
    db.exec("PRAGMA busy_timeout=5000");
    const rows = db.prepare("SELECT id FROM patchboard_oauth_grant WHERE client_id=? AND board_id=? AND revoked_at_ms IS NULL")
      .all(clientId, boardId);
    assert.equal(rows.length, 1);
    const grantId = rows[0].id;
    const grant = () => db.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?").get(grantId);
    const receipts = () => db.prepare("SELECT id,grant_id,grant_version,admitted_at_ms,expires_at_ms,admitted_scope FROM patchboard_mcp_admission WHERE grant_id=?").all(grantId);
    const getReceipt = id => db.prepare("SELECT id,grant_id,grant_version,admitted_at_ms,expires_at_ms,admitted_scope FROM patchboard_mcp_admission WHERE id=?").get(id);
    // Only the next selected tool call is paused. Initialization and other
    // calls use the original SDK fetch unchanged.
    let pause;
    const client = new Client({ name: "live-grant-ordering-proof", version: "1.0" });
    clients.push(client);
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpURL), {
      requestInit: { headers: { Authorization: "Bearer " + token } },
      fetch: (url, init) => {
        if (!pause || typeof init?.body !== "string") return fetch(url, init);
        const body = init.body;
        const message = JSON.parse(body);
        if (message.method !== "tools/call" || message.params?.name !== "update_canvas_entity")
          return fetch(url, init);
        const gate = pause;
        pause = undefined;
        const bytes = new TextEncoder().encode(body);
        const splitBody = new ReadableStream({
          start(controller) { controller.enqueue(bytes.slice(0, 1)); },
          async pull(controller) {
            await gate.released;
            controller.enqueue(bytes.slice(1));
            controller.close();
          },
        });
        // No second HTTP request or mutation.
        return fetch(url, { ...init, body: splitBody, duplex: "half" }).then(response => {
          gate.httpStatus = response.status;
          return response;
        });
      },
    }));
    check(await client.callTool({ name: "create_canvas_entity", arguments: {
      board_id: boardId, kind: "node", payload,
    } }));
    created = true;
    assert.equal(check(await client.callTool({ name: "update_canvas_entity", arguments: args })).version, 2);
    const baseline = await read(writer);
    assert.equal(baseline.id, entityId);
    assert.equal(baseline.version, 2);
    assert.equal(baseline.updatedBy, actorId);
    assert.equal(baseline.payload.label.markdown, "Active authorized update");
    trace.push({ case: "active", version: baseline.version, authorized: true, writerMatchesActor: true });

    async function pausedUpdate(kind, changeGrant) {
      const known = new Set(receipts().map(row => row.id));
      let release;
      const released = new Promise(done => { release = done; });
      const gate = { released };
      pause = gate;
      // Capture rejection immediately, so a transport error cannot become an
      // unhandled promise while we await the persisted admission signal.
      const result = client.callTool({ name: "update_canvas_entity", arguments: {
        ...args, expected_version: 2,
        payload: { ...payload, label: { markdown: "Must not commit " + kind } },
      } }).then(value => ({ value }), error => ({ error }));
      try {
        let receipt;
        const deadline = Date.now() + 12000;
        while (Date.now() < deadline) {
          const fresh = receipts().filter(row => !known.has(row.id));
          assert.ok(fresh.length <= 1, "Exactly one new admission for the paused request");
          if (fresh.length === 1) { receipt = fresh[0]; break; }
          await new Promise(done => setTimeout(done, 20));
        }
        assert.ok(receipt, "Server must persist admission before receiving complete JSON");
        assert.equal(receipt.grant_version, grant().grant_version);
        assert.ok(receipt.expires_at_ms > Date.now());
        assert.equal(receipt.expires_at_ms - receipt.admitted_at_ms, 60000);
        assert.equal(grant().revoked_at_ms, null);
        assert.deepEqual(await read(writer), baseline, "Independent client works while A is paused");
        await changeGrant(receipt);
        const after = grant();
        assert.equal(after.grant_version, receipt.grant_version + 1);
        assert.deepEqual(getReceipt(receipt.id), receipt, "Admission still present and unmodified");
        const remainingMs = receipt.expires_at_ms - Date.now();
        assert.ok(remainingMs > 0, "Revocation/version change must precede admission expiry");
        assert.equal(after.revoked_at_ms !== null, kind === "revoke");
        release();
        const resolved = await result;
        if (resolved.error) throw resolved.error;
        assert.equal(gate.httpStatus, 200, "A resumed callback is an MCP tool result, not a fresh HTTP rejection");
        assert.equal(resolved.value.isError, true);
        assert.equal(resolved.value.content[0].text, "GRANT_ADMISSION_EXPIRED_OR_INVALID");
        const remainingAfterResponseMs = receipt.expires_at_ms - Date.now();
        assert.ok(remainingAfterResponseMs > 0, "Callback denial must occur before receipt expiry");
        assert.deepEqual(await read(writer), baseline, "Independent readback must preserve entity/value/version/writer");
        trace.push({ case: kind, receiptPresent: true, receiptUnchanged: true,
          ttlRemainingMs: remainingMs, ttlRemainingAfterResponseMs: remainingAfterResponseMs, admittedVersion: receipt.grant_version,
          liveVersion: after.grant_version, revoked: after.revoked_at_ms !== null,
          tool: "update_canvas_entity", http: gate.httpStatus, mcpIsError: true,
          error: resolved.value.content[0].text, unchanged: true, independentClient: true });
      } finally {
        pause = undefined;
        release();
        await result;
      }
    }
    await pausedUpdate("version-change", () => {
      // Disposable fixture fault: change only the current grant version.
      db.prepare("UPDATE patchboard_oauth_grant SET grant_version=grant_version+1 WHERE id=?").run(grantId);
    });
    assert.deepEqual(await read(client), baseline, "Fresh admission sees new live version");
    await pausedUpdate("revoke", () => {
      // Exercise the existing grant service, not a simulated revoked flag.
      // The separate process sees the same committed private SQLite ledger.
      const script = 'import { revokeBoardGrant } from "./src/private-auth/grants.ts"; revokeBoardGrant(process.argv[1]);';
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script, grantId], {
        cwd: fileURLToPath(new URL("../../server/", import.meta.url)),
        env: process.env, stdio: "pipe", timeout: 10000,
      });
    });
    const fresh = await fetch(mcpURL, {
      method: "POST", headers: { Authorization: "Bearer " + token,
        "content-type": "application/json", Accept: "application/json, text/event-stream" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 901, method: "tools/call",
        params: { name: "get_canvas_entity", arguments: { board_id: boardId, entity_id: entityId } } }),
    });
    assert.equal(fresh.status, 401, "New transport admission must fail separately");
    await fresh.body?.cancel();
    assert.deepEqual(await read(writer), baseline);
    trace.push({ case: "fresh-request-after-revoke", http: 401, independentClient: true });
    for (const stage of trace) console.log("PRIVATE_MCP_LIVE_GRANT_STAGE_PASS", JSON.stringify(stage));
    console.log("PRIVATE_MCP_LIVE_GRANT_ORDERING_PASS", JSON.stringify({ stages: trace.length, unchanged: true, independentClientUsable: true }));
  } finally {
    try {
      for (const client of clients) await client.close();
      if (created) {
        const current = await read(writer);
        check(await writer.callTool({ name: "delete_canvas_entity", arguments: {
          board_id: boardId, entity_id: entityId, expected_version: current.version,
        } }));
      }
    } finally { db.close(); }
  }
}
