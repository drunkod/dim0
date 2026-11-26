import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { openSync, closeSync, readFileSync, realpathSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { proveLiveGrantCallback } from "./live-grant-callback-proof.mjs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { discoverOAuthServerInfo } from "@modelcontextprotocol/sdk/client/auth.js";

const origin = process.env.PATCHBOARD_PRIVATE_ORIGIN ?? "http://localhost:8793";
const mcpURL = origin + "/patchboard-private-mcp";

// Auth discovery starts with ONLY the MCP resource URL. RFC 9728 challenge ->
// protected-resource metadata -> RFC 8414 path-aware authorization server
// metadata. Neither the OAuth endpoints nor the issuer are hardcoded here.
// This prevents a green passkey test when a ChatGPT MCP connector cannot
// discover the provider from its user-supplied MCP URL.
async function discoverFromMcpResource(resourceUrl) {
  const challenge = await fetch(resourceUrl, { method: "GET", redirect: "manual" });
  assert.equal(challenge.status, 401, "MCP must challenge unauthenticated clients");
  const header = challenge.headers.get("www-authenticate") ?? "";
  const resourceMetadataMatch = header.match(/resource_metadata="([^"]+)"/);
  assert.ok(resourceMetadataMatch, "401 must advertise RFC 9728 resource metadata");
  const resourceMetadataUrl = new URL(resourceMetadataMatch[1]);
  assert.equal(resourceMetadataUrl.origin, new URL(resourceUrl).origin);
  const resourceResponse = await fetch(resourceMetadataUrl);
  assert.equal(resourceResponse.status, 200, "Protected resource metadata must be public");
  const resource = await resourceResponse.json();
  assert.equal(resource.resource, resourceUrl);
  assert.ok(Array.isArray(resource.authorization_servers) &&
    resource.authorization_servers.length, "Resource must advertise an issuer");
  const issuer = resource.authorization_servers[0];
  const issuerUrl = new URL(issuer);
  assert.equal(issuerUrl.origin, new URL(resourceUrl).origin);
  assert.ok(issuerUrl.pathname !== "/", "Test the RFC 8414 issuer-path rule");
  const metadataUrl = new URL(
    "/.well-known/oauth-authorization-server" + issuerUrl.pathname,
    issuerUrl.origin,
  );
  const metadataResponse = await fetch(metadataUrl);
  assert.equal(metadataResponse.status, 200,
    "RFC 8414 discovery failed at " + metadataUrl.href);
  const provider = await metadataResponse.json();
  assert.equal(provider.issuer, issuer, "OAuth metadata must preserve issuer");
  for (const endpoint of ["registration_endpoint","authorization_endpoint","token_endpoint"]) {
    assert.ok(typeof provider[endpoint] === "string", "Missing " + endpoint);
    assert.equal(new URL(provider[endpoint]).origin, issuerUrl.origin);
    assert.ok(new URL(provider[endpoint]).pathname.startsWith(issuerUrl.pathname + "/"),
      "Provider endpoint must belong to the discovered issuer path");
  }
  assert.ok(provider.code_challenge_methods_supported?.includes("S256"));
  const registrationEndpoint = new URL(provider.registration_endpoint);
  const tokenEndpoint = new URL(provider.token_endpoint);
  const authEndpoint = new URL(provider.authorization_endpoint);
  console.log("PRIVATE_OAUTH_DISCOVERY_FROM_MCP_ONLY_PASS", JSON.stringify({
    resourceMetadata: resourceMetadataUrl.href, issuer, metadataUrl: metadataUrl.href,
    registrationEndpoint: registrationEndpoint.href, tokenEndpoint: tokenEndpoint.href,
    authorizationEndpoint: authEndpoint.href,
  }));
  return provider;
}
const discoveredOAuth = await discoverFromMcpResource(mcpURL);
// Also exercise the official MCP SDK's implementation of resource discovery,
// not just the explicit RFC 9728/8414 chain above.
const sdkDiscovered = await discoverOAuthServerInfo(mcpURL);
assert.equal(sdkDiscovered.authorizationServerUrl, discoveredOAuth.issuer);
assert.equal(sdkDiscovered.authorizationServerMetadata?.issuer, discoveredOAuth.issuer);
assert.equal(sdkDiscovered.resourceMetadata?.resource, mcpURL);
for (const endpoint of ["registration_endpoint","authorization_endpoint","token_endpoint"]) {
  assert.equal(sdkDiscovered.authorizationServerMetadata?.[endpoint], discoveredOAuth[endpoint]);
}
console.log("OFFICIAL_MCP_SDK_AUTO_OAUTH_DISCOVERY_PASS", JSON.stringify({
  issuer: sdkDiscovered.authorizationServerUrl,
  authorizationEndpoint: sdkDiscovered.authorizationServerMetadata.authorization_endpoint,
}));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const browserErrors = [];
const websocketHandshakes = [];
async function watchWebsockets(cdp, actor) {
  const requestUrls = new Map();
  await cdp.send("Network.enable");
  cdp.on("Network.webSocketCreated", event => requestUrls.set(event.requestId, event.url));
  cdp.on("Network.webSocketHandshakeResponseReceived", event => {
    websocketHandshakes.push({ actor, status: event.response.status,
      url: requestUrls.get(event.requestId) ?? "" });
  });
}

const issuedTokens = new Map();
page.on("pageerror", e => browserErrors.push(String(e)));
const cdp = await context.newCDPSession(page);
await cdp.send("WebAuthn.enable");
await watchWebsockets(cdp, "owner");
await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
  protocol: "ctap2", transport: "internal", hasResidentKey: true,
  hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
}});
await context.route("http://127.0.0.1:7432/**", route =>
  route.fulfill({ status: 200, body: "Patchboard OAuth callback received" }));

async function oauthGrant(grantScopes, targetPage = page, selectedBoardId) {
  const response = await fetch(discoveredOAuth.registration_endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "Patchboard OAuth acceptance",
      application_type: "native",
      redirect_uris: ["http://127.0.0.1:7432/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: grantScopes,
    }),
  });
  const registrationBody = await response.text();
  assert.equal(response.status, 201, registrationBody);
  const { client_id } = JSON.parse(registrationBody);
  assert.ok(client_id);

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomUUID();
  const authorize = new URL(discoveredOAuth.authorization_endpoint);
  for (const [key, value] of Object.entries({
    response_type: "code", client_id,
    redirect_uri: "http://127.0.0.1:7432/callback",
    code_challenge: challenge, code_challenge_method: "S256",
    scope: grantScopes, state, resource: mcpURL,
  })) authorize.searchParams.set(key, value);
  // An existing Foldkit navigation may race OAuth's 302 on Linux.
  // A stale dashboard/login URL is NEVER evidence that a new OAuth flow
  // started. Require this newly registered client ID in the signed URL.
  const expectedConsentRedirect = location => location.origin === origin &&
    location.searchParams.get("client_id") === client_id &&
    (location.pathname === "/patchboard-private/" ||
      location.pathname === "/patchboard-private/oauth-consent");
  // Allow any prior sign-out or Foldkit redirect to settle before beginning
  // this unique OAuth client request. Never interpret a stale URL as consent.
  await targetPage.waitForLoadState("domcontentloaded");
  let arrived = false;
  for (let attempt = 0; attempt < 4 && !arrived; attempt++) {
    try {
      await targetPage.goto(authorize.href, { waitUntil: "domcontentloaded" });
    } catch (error) {
      if (!/ERR_ABORTED|interrupted by another navigation/.test(String(error))) throw error;
    }
    try {
      await targetPage.waitForURL(expectedConsentRedirect, { timeout: 4500 });
      arrived = true;
    } catch {
      if (attempt === 3) throw new Error("OAuth redirect not reached for selected client");
    }
  }
  if (new URL(targetPage.url()).pathname === "/patchboard-private/") {
    await expect(targetPage.getByRole("heading", { name: "Sign in to your private board" }))
      .toBeVisible({ timeout: 15000 });
    await targetPage.getByRole("button", { name: "Sign in with passkey" }).click();
  }
  await expect(targetPage.getByRole("heading", { name: "Authorize a Patchboard connection" }))
    .toBeVisible({ timeout: 15000 });
  assert.ok(targetPage.url().includes("/patchboard-private/oauth-consent"));
  assert.ok((await targetPage.textContent("main")).includes(grantScopes.split(" ")[0]));
  assert.ok(selectedBoardId, "OAuth consent must select one board");
  await targetPage.getByLabel("Approved board").selectOption(selectedBoardId);
  await targetPage.getByRole("button", { name: "Authorize selected board" }).click();
  await targetPage.waitForURL(u => u.hostname === "127.0.0.1" && u.port === "7432",
    { timeout: 9000, waitUntil: "commit" });
  const callback = new URL(targetPage.url());
  assert.equal(callback.searchParams.get("state"), state);
  const code = callback.searchParams.get("code");
  assert.ok(code, callback.toString());
  const result = await fetch(discoveredOAuth.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code", code, client_id,
      redirect_uri: "http://127.0.0.1:7432/callback",
      code_verifier: verifier, resource: mcpURL,
    }),
  });
  const raw = await result.text();
  assert.equal(result.status, 200, raw);
  const tokens = JSON.parse(raw);
  assert.ok(tokens.access_token && tokens.token_type.toLowerCase() === "bearer");
  issuedTokens.set(tokens.access_token, {
    refreshToken: tokens.refresh_token, clientId: client_id,
  });
  console.log("OAUTH_CODE_PKCE_CONSENT_PASS", JSON.stringify({
    scope: grantScopes, tokenExpiresIn: tokens.expires_in,
  }));
  return tokens.access_token;
}

/**
 * Explicitly opt-in restart, restricted to the disposable MacBook public
 * staging process. Never restart a user's running 8791/8792 demos.
 */
let ciReplacementGroup;
async function restartPrivateCiFixture(audit) {
  const root = process.env.PATCHBOARD_PRIVATE_ROOT;
  const port = Number(process.env.PATCHBOARD_PRIVATE_PORT);
  assert.ok(root?.startsWith(join(tmpdir(), "patchboard-private-ci-")),
    "Restart is restricted to a disposable private CI directory");
  assert.equal(process.env.PATCHBOARD_PRIVATE_DEV, "1");
  assert.equal(origin, "http://localhost:" + port);
  assert.ok(Number.isInteger(port) && port > 1024 &&
    ![8791, 8792, 8793, 8794].includes(port), "Never restart an existing demo");
  const pid = Number(readFileSync(join(root, "qa-private-server.pid"), "utf8").trim());
  assert.ok(Number.isInteger(pid) && pid > 1 && pid !== process.pid);
  process.kill(pid, "SIGTERM");
  let stopped = false;
  for (let i = 0; i < 100; i++) {
    try {
      await fetch("http://127.0.0.1:" + port + "/health", {
        signal: AbortSignal.timeout(500),
      });
    } catch { stopped = true; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(stopped, "Disposable server did not stop");
  // The HTTP listener closing is not sufficient evidence that Jazz has
  // closed its store. Wait for this identified disposable server process.
  let exited = false;
  for (let i = 0; i < 100; i++) {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code !== "ESRCH") throw error; exited = true; break; }
    await new Promise(done => setTimeout(done, 100));
  }
  assert.ok(exited, "Disposable Jazz process must exit before offline audit");
  if (audit) await audit();

  const outputFile = openSync(join(root, "private-restart.log"), "a", 0o600);
  const child = spawn("pnpm", ["--filter", "@patchboard/server", "exec", "tsx",
    "src/private-demo.ts"], {
    cwd: fileURLToPath(new URL("../../../", import.meta.url)),
    env: process.env, detached: true,
    stdio: ["ignore", outputFile, outputFile],
  });
  ciReplacementGroup = child.pid;
  child.unref();
  closeSync(outputFile);
  let recovered = false;
  for (let i = 0; i < 160; i++) {
    await new Promise(done => setTimeout(done, 150));
    try {
      const response = await fetch("http://127.0.0.1:" + port + "/health", {
        signal: AbortSignal.timeout(700),
      });
      if (response.ok) { recovered = true; break; }
    } catch { /* Waiting for the private Jazz SQLite store. */ }
  }
  assert.ok(recovered, "Disposable server did not recover");
  return true;
}
async function restartPublicStaging(audit) {
  if (process.env.PATCHBOARD_OAUTH_CI_RESTART === "1") {
    return restartPrivateCiFixture(audit);
  }
  const root = "/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging";
  if (process.env.PATCHBOARD_OAUTH_STAGING_RESTART !== "1") return false;
  assert.equal(origin, "https://tests-macbook-air.tail70b8a.ts.net");
  assert.equal(process.env.PATCHBOARD_PRIVATE_ROOT, root);
  assert.equal(process.env.PATCHBOARD_PRIVATE_PORT, "8794");
  const find = ["-nP", "-t", "-iTCP:8794", "-sTCP:LISTEN"];
  const existing = execFileSync("lsof", find, { encoding: "utf8" }).trim().split("\n");
  assert.equal(existing.length, 1, "Staging must have one identified listener");
  const pid = Number(existing[0]);
  const command = execFileSync("ps", ["-p", String(pid), "-o", "command="], {
    encoding: "utf8",
  });
  assert.match(command, /private-demo\.ts/, "Refuse to stop unknown listener");
  process.kill(pid, "SIGTERM");
  let stopped = false;
  for (let i = 0; i < 90; i++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    try { execFileSync("lsof", find, { stdio: "ignore" }); }
    catch { stopped = true; break; }
  }
  assert.ok(stopped, "Staging listener did not release its port");
  const file = openSync(root + "/public-oauth-restart.log", "a");
  const child = spawn("pnpm", [
    "--filter", "@patchboard/server", "exec", "tsx", "src/private-demo.ts",
  ], {
    cwd: "/Users/test/work/patchwork/agent-staff-board-private-public",
    env: {
      ...process.env,
      PATCHBOARD_PRIVATE_ROOT: root,
      PATCHBOARD_PRIVATE_ORIGIN: origin,
      PATCHBOARD_PRIVATE_PORT: "8794",
    },
    detached: true,
    stdio: ["ignore", file, file],
  });
  child.unref();
  closeSync(file);
  let ready = false;
  for (let i = 0; i < 120; i++) {
    await new Promise(resolve => setTimeout(resolve, 150));
    try {
      const reply = await fetch("http://127.0.0.1:8794/health", {
        signal: AbortSignal.timeout(500),
      });
      if (reply.ok) { ready = true; break; }
    } catch { /* Fresh Jazz is still opening the SQLite store. */ }
  }
  assert.ok(ready, "Staging server did not recover after restart");
  return true;
}

function clientWithToken(token) {
  const client = new Client({ name: "patchboard-oauth-proof", version: "1.0" });
  return { client, connect: () => client.connect(new StreamableHTTPClientTransport(
    new URL(mcpURL), { requestInit: { headers: { Authorization: "Bearer " + token } } },
  )) };
}

try {
  await page.goto(origin + "/patchboard-private/");
  await expect(page.getByRole("heading", { name: "Sign in to your private board" }))
    .toBeVisible({ timeout: 18000 });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible({ timeout: 22000 });
  const boardTitle = "OAuth acceptance " + randomUUID().slice(0,8);
  const createdBoard = await page.evaluate(async (title) => {
    const response = await fetch("/patchboard-private/api/boards", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" }, body: JSON.stringify({ title }),
    });
    return { status: response.status, body: await response.json() };
  }, boardTitle);
  assert.equal(createdBoard.status, 201, JSON.stringify(createdBoard));
  const boardId = createdBoard.body.board_id;
  assert.match(boardId, /^[a-f0-9-]{36}$/i);
  await page.goto(origin + "/patchboard-private/?board=" + boardId);
  await expect(page.getByRole("heading", { name: boardTitle })).toBeVisible({ timeout: 15000 });
  const secondBoardTitle = "Other owned board " + randomUUID().slice(0,8);
  const secondBoard = await page.evaluate(async title => {
    const response = await fetch("/patchboard-private/api/boards", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }), credentials: "same-origin",
    });
    return { status: response.status, body: await response.json() };
  }, secondBoardTitle);
  assert.equal(secondBoard.status, 201);
  const secondBoardId = secondBoard.body.board_id;
  assert.notEqual(boardId, secondBoardId);

  const rejectedCookie = await context.request.post(mcpURL, {
    data: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    headers: { "content-type": "application/json" },
  });
  assert.equal(rejectedCookie.status(), 401, "Passkey cookie must not authorize MCP");
  assert.match(rejectedCookie.headers()["www-authenticate"] ?? "", /resource_metadata/);
  const malformed = await fetch(mcpURL, { method: "POST",
    headers: { Authorization: "Bearer malformed" }, body: "{}" });
  assert.equal(malformed.status, 401, "Unverified token must be denied");
  console.log("MCP_COOKIE_AND_INVALID_BEARER_DENIED");

  const readToken = await oauthGrant("board:read", page, boardId);
  const { client: reader, connect: connectReader } = clientWithToken(readToken);
  try {
    await connectReader();
    const available = (await reader.listTools()).tools.map(t => t.name).sort();
    assert.deepEqual(available, ["get_applet_state", "get_canvas_entity", "list_boards", "list_canvas_entities", "read_board"], "read-only grant must hide write tools");
    const list = await reader.callTool({ name: "list_boards", arguments: {} });
    assert.equal(list.isError, undefined, JSON.stringify(list));
    const listed = JSON.parse(list.content[0].text);
    assert.deepEqual(listed.boards.map(b => b.board_id), [boardId],
      "Consent for board A must never enumerate another board owned by same user");
    const forbiddenRead = await reader.callTool({
      name: "read_board", arguments: { board_id: secondBoardId },
    });
    assert.equal(forbiddenRead.isError, true);
    assert.match(forbiddenRead.content[0].text, /BOARD_ACCESS_DENIED/);
    const read = await reader.callTool({ name: "read_board", arguments: { board_id: boardId } });
    assert.equal(read.isError, undefined, JSON.stringify(read));
    const deny = await reader.callTool({ name: "create_note", arguments: {
      board_id: boardId, text: "disallowed", request_id: "read-only",
    } }).catch(e => ({ rejected: String(e) }));
    assert.ok(deny.rejected || deny.isError, "Write tool unavailable on read grant");
    console.log("MCP_READ_SCOPE_TOOL_DISCOVERY_PASS");
  } finally {
    await reader.close();
  }

  await page.goto(origin + "/patchboard-private/?board=" + boardId);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page.getByRole("heading", { name: "Sign in to your private board" }))
    .toBeVisible({ timeout: 15000 });
  const writeToken = await oauthGrant("board:read board:write offline_access", page, boardId);
  const { client: writer, connect: connectWriter } = clientWithToken(writeToken);
  try {
    await connectWriter();
    assert.deepEqual((await writer.listTools()).tools.map(t => t.name).sort(),
      ["create_canvas_entity", "create_note", "delete_canvas_entity", "get_applet_state", "get_canvas_entity", "list_boards", "list_canvas_entities", "patch_canvas_entity", "read_board", "update_applet_state", "update_canvas_entity"]);
    // New Dim0 entity API: an actual OAuth MCP client can mutate full
    // applet/note JSON through Jazz, with CAS and board scope enforced.
    const canvasId = randomUUID();
    const appletSource = "<Widget state={{ count: 0 }} />";
    const baseEntity = {
      id: canvasId, graphUid: boardId, type: "note", version: 1,
      label: { markdown: "MCP applet" },
      content: { markdown: appletSource },
      properties: { nodePosition: { type: "position", position: { x: 10, y: 20 } } },
      style: { type: "applet" },
    };
    const canvasCreate = await writer.callTool({
      name: "create_canvas_entity",
      arguments: { board_id: boardId, kind: "node", payload: baseEntity },
    });
    assert.equal(canvasCreate.isError, undefined, JSON.stringify(canvasCreate));
    assert.equal(JSON.parse(canvasCreate.content[0].text).version, 1);
    const canvasRead = await writer.callTool({
      name: "get_canvas_entity",
      arguments: { board_id: boardId, entity_id: canvasId },
    });
    assert.equal(JSON.parse(canvasRead.content[0].text).payload.content.markdown, appletSource);
    const canvasUpdate = await writer.callTool({
      name: "update_canvas_entity",
      arguments: { board_id: boardId, entity_id: canvasId, expected_version: 1,
        payload: { ...baseEntity, content: { markdown: "<Widget state={{ count: 1 }} />" } } },
    });
    assert.equal(JSON.parse(canvasUpdate.content[0].text).version, 2);
    const staleUpdate = await writer.callTool({
      name: "update_canvas_entity",
      arguments: { board_id: boardId, entity_id: canvasId, expected_version: 1,
        payload: baseEntity },
    });
    assert.equal(staleUpdate.isError, true);
    assert.match(staleUpdate.content[0].text, /VERSION_CONFLICT/);
    const crossBoard = await writer.callTool({
      name: "list_canvas_entities", arguments: { board_id: secondBoardId },
    });
    assert.equal(crossBoard.isError, true);
    assert.match(crossBoard.content[0].text, /BOARD_ACCESS_DENIED/);
    // The ChatGPT applet runtime uses the same Jazz CAS service as Dim0 React.
    const initialApplet = await writer.callTool({
      name: "get_applet_state", arguments: { board_id: boardId, note_id: canvasId },
    });
    assert.equal(initialApplet.isError, undefined, JSON.stringify(initialApplet));
    assert.deepEqual(JSON.parse(initialApplet.content[0].text).value, null);
    const appletWrite = await writer.callTool({
      name: "update_applet_state", arguments: {
        board_id: boardId, note_id: canvasId, expected_version: 0, value: { count: 1 },
      },
    });
    assert.equal(appletWrite.isError, undefined, JSON.stringify(appletWrite));
    assert.equal(JSON.parse(appletWrite.content[0].text).version, 1);
    const staleApplet = await writer.callTool({
      name: "update_applet_state", arguments: {
        board_id: boardId, note_id: canvasId, expected_version: 0, value: { count: 999 },
      },
    });
    assert.equal(staleApplet.isError, true);
    assert.match(staleApplet.content[0].text, /VERSION_CONFLICT/);
    const rereadApplet = await writer.callTool({
      name: "get_applet_state", arguments: { board_id: boardId, note_id: canvasId },
    });
    assert.deepEqual(JSON.parse(rereadApplet.content[0].text).value, { count: 1 });
    const appletWrongBoard = await writer.callTool({
      name: "get_applet_state", arguments: { board_id: secondBoardId, note_id: canvasId },
    });
    assert.equal(appletWrongBoard.isError, true);
    assert.match(appletWrongBoard.content[0].text, /BOARD_ACCESS_DENIED/);
    console.log("DIM0_JAZZ_OAUTH_MCP_APPLET_STATE_PASS", canvasId);

    // Fault injection is confined to the private-ci harness's fresh loopback
    // database. A server-minted receipt disappears AFTER transport admission
    // but BEFORE tool dispatch. Every callback must independently deny.
    if (process.env.PATCHBOARD_OAUTH_CI_RESTART === "1") {
      const root = process.env.PATCHBOARD_PRIVATE_ROOT;
      const port = Number(process.env.PATCHBOARD_PRIVATE_PORT);
      assert.equal(process.env.PATCHBOARD_PRIVATE_DEV, "1");
      assert.equal(origin, "http://localhost:" + port);
      assert.ok(Number.isInteger(port) && port > 1024 && ![8791, 8792, 8793, 8794].includes(port));
      assert.ok(root?.startsWith(join(tmpdir(), "patchboard-private-ci-")));
      const fixtureRoot = realpathSync(root);
      assert.ok(fixtureRoot.startsWith(join(realpathSync(tmpdir()), "patchboard-private-ci-")));
      const dbPath = join(fixtureRoot, "auth", "better-auth.sqlite");
      assert.equal(realpathSync(dbPath), dbPath);
      const fixture = new DatabaseSync(dbPath);
      const trigger = "qa_prune_callback_admission";
      const snapshot = async () => {
        const paths = [
          "board?board_id=" + boardId,
          "canvas?board_id=" + boardId,
          "applet-state?board_id=" + boardId + "&note_id=" + canvasId,
        ];
        return Promise.all(paths.map(async path => {
          const response = await context.request.get(origin + "/patchboard-private/api/" + path);
          assert.equal(response.status(), 200);
          return response.json();
        }));
      };
      const before = await snapshot();
      const deniedCalls = [
        ["list_boards", {}],
        ["read_board", { board_id: boardId }],
        ["list_canvas_entities", { board_id: boardId }],
        ["get_canvas_entity", { board_id: boardId, entity_id: canvasId }],
        ["get_applet_state", { board_id: boardId, note_id: canvasId }],
        ["create_note", { board_id: boardId, text: "Denied callback fixture", request_id: randomUUID() }],
        ["create_canvas_entity", { board_id: boardId, kind: "node", payload: { ...baseEntity, id: randomUUID() } }],
        ["update_canvas_entity", { board_id: boardId, entity_id: canvasId, expected_version: 2,
          payload: { ...baseEntity, label: { markdown: "Denied callback update" } } }],
        ["patch_canvas_entity", { board_id: boardId, entity_id: canvasId, expected_version: 2,
          request_id: randomUUID(), field_patch: { label_markdown: "Denied patch callback" } }],
        ["delete_canvas_entity", { board_id: boardId, entity_id: canvasId, expected_version: 2 }],
        ["update_applet_state", { board_id: boardId, note_id: canvasId, expected_version: 1,
          value: { count: 999 } }],
      ];
      assert.deepEqual(deniedCalls.map(([name]) => name).sort(),
        (await writer.listTools()).tools.map(tool => tool.name).sort());
      let installed = false;
      try {
        fixture.exec("PRAGMA busy_timeout=5000");
        const grants = fixture.prepare("SELECT id FROM patchboard_oauth_grant WHERE client_id=? AND board_id=? AND revoked_at_ms IS NULL")
          .all(issuedTokens.get(writeToken).clientId, boardId);
        assert.equal(grants.length, 1);
        const grantId = grants[0].id;
        assert.match(grantId, /^[a-f0-9-]{36}$/i);
        // Only this newly created synthetic OAuth client's admission rows.
        fixture.exec("CREATE TRIGGER " + trigger + " AFTER INSERT ON patchboard_mcp_admission " +
          "WHEN NEW.grant_id='" + grantId + "' BEGIN " +
          "DELETE FROM patchboard_mcp_admission WHERE id=NEW.id; END;");
        installed = true;
        for (const [name, args] of deniedCalls) {
          const result = await writer.callTool({ name, arguments: args });
          assert.equal(result.isError, true, name + " must deny a pruned receipt");
          assert.equal(result.content[0].text, "GRANT_ADMISSION_EXPIRED_OR_INVALID", name);
        }
        assert.deepEqual(await snapshot(), before, "Denied callbacks must leave durable data unchanged");
        const { client: independent, connect: connectIndependent } = clientWithToken(readToken);
        try {
          await connectIndependent();
          const allowed = await independent.callTool({ name: "read_board", arguments: { board_id: boardId } });
          assert.equal(allowed.isError, undefined, "Independent read grant must remain usable");
          const refused = await independent.callTool({ name: "create_note", arguments: {
            board_id: boardId, text: "Denied read-only fixture", request_id: randomUUID(),
          } }).catch(error => ({ rejected: String(error) }));
          assert.ok(refused.rejected || refused.isError);
          assert.deepEqual(await snapshot(), before, "Read-only denial must not write a note");
        } finally { await independent.close(); }
      } finally {
        try { if (installed) fixture.exec("DROP TRIGGER " + trigger); }
        finally { fixture.close(); }
      }
      const restored = await writer.callTool({ name: "get_canvas_entity", arguments: {
        board_id: boardId, entity_id: canvasId,
      } });
      assert.equal(restored.isError, undefined);
      assert.deepEqual(await snapshot(), before);
      console.log("PRIVATE_MCP_ALL_CALLBACK_ADMISSION_FENCES_PASS",
        JSON.stringify({ denied: deniedCalls.map(([name]) => name), unchanged: true,
          independentGrantUsable: true, freshAdmissionUsable: true }));
    }

    const canvasDelete = await writer.callTool({
      name: "delete_canvas_entity",
      arguments: { board_id: boardId, entity_id: canvasId, expected_version: 2 },
    });
    assert.equal(canvasDelete.isError, undefined, JSON.stringify(canvasDelete));
    console.log("DIM0_JAZZ_OAUTH_MCP_CANVAS_CRUD_PASS", canvasId);

    await page.goto(origin + "/patchboard-private/?board=" + boardId);
    const marker = "Verified OAuth MCP note " + randomUUID().slice(0,8);
    const requestId = "oauth-" + randomUUID();
    const first = await writer.callTool({ name: "create_note", arguments: {
      board_id: boardId, text: marker, request_id: requestId,
    } });
    assert.equal(first.isError, undefined, JSON.stringify(first));
    const created = JSON.parse(first.content[0].text);
    assert.equal(created.board_id, boardId);
    await expect(page.locator(".note").filter({ hasText: marker }))
      .toBeVisible({ timeout: 18000 });
    const replay = await writer.callTool({ name: "create_note", arguments: {
      board_id: boardId, text: marker, request_id: requestId,
    } });
    assert.equal(JSON.parse(replay.content[0].text).note_id, created.note_id);
    const otherBoard = await writer.callTool({ name: "create_note", arguments: {
      board_id: randomUUID(), text: "forbidden", request_id: randomUUID(),
    } });
    assert.equal(otherBoard.isError, true);
    assert.match(otherBoard.content[0].text, /BOARD_ACCESS_DENIED|BOARD_UNAVAILABLE|BOARD_WRITE_DENIED/);
    const secondDenied = await writer.callTool({
      name: "create_note", arguments: {
        board_id: secondBoardId, text: "MUST NOT WRITE B", request_id: randomUUID(),
      },
    });
    assert.equal(secondDenied.isError, true);
    assert.match(secondDenied.content[0].text, /BOARD_ACCESS_DENIED/);
    const bData = await page.evaluate(async board_id => {
      const reply = await fetch("/patchboard-private/api/board?board_id=" + board_id);
      return reply.json();
    }, secondBoardId);
    assert.deepEqual(bData.notes, [], "Board B must not gain the unauthorized note");
    console.log("PRIVATE_OAUTH_SAME_OWNER_OTHER_BOARD_DENIED_PASS");
    console.log("PRIVATE_OAUTH_MCP_NOTE_LIVE_AND_IDEMPOTENT_PASS", JSON.stringify({
      boardId, noteId: created.note_id, marker,
    }));
  } finally {
    await writer.close();
  }
  // A refreshed token must retain the exact authorization's board reference.
  const { refreshToken, clientId } = issuedTokens.get(writeToken);
  assert.ok(refreshToken, "offline_access must issue a refresh token");
  const refreshedResponse = await fetch(discoveredOAuth.token_endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token", refresh_token: refreshToken,
      client_id: clientId, resource: mcpURL,
    }),
  });
  const refreshedText = await refreshedResponse.text();
  assert.equal(refreshedResponse.status, 200, refreshedText);
  const refreshedToken = JSON.parse(refreshedText).access_token;
  assert.ok(refreshedToken);
  const { client: rotated, connect: connectRotated } = clientWithToken(refreshedToken);
  try {
    await connectRotated();
    const grantList = await rotated.callTool({ name: "list_boards", arguments: {} });
    assert.deepEqual(JSON.parse(grantList.content[0].text).boards.map(b => b.board_id),
      [boardId]);
    const denied = await rotated.callTool({
      name: "create_note", arguments: {
        board_id: secondBoardId, text: "REFRESH MUST NOT WRITE B", request_id: randomUUID(),
      },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0].text, /BOARD_ACCESS_DENIED/);
    console.log("PRIVATE_OAUTH_REFRESH_RETAINS_BOARD_GRANT_PASS");
  } finally { await rotated.close(); }

  // The same user may separately authorize B, but A's token still cannot
  // enumerate or write B. Distinct OAuth grants must never overwrite each other.
  const secondToken = await oauthGrant("board:read board:write", page, secondBoardId);
  const { client: secondMcp, connect: connectSecond } = clientWithToken(secondToken);
  try {
    await connectSecond();
    const boardList = await secondMcp.callTool({ name: "list_boards", arguments: {} });
    assert.deepEqual(JSON.parse(boardList.content[0].text).boards.map(b => b.board_id),
      [secondBoardId]);
    const added = await secondMcp.callTool({
      name: "create_note", arguments: {
        board_id: secondBoardId, text: "Allowed on B", request_id: randomUUID(),
      },
    });
    assert.equal(added.isError, undefined, JSON.stringify(added));
    const { client: originalMcp, connect: reconnectOriginal } = clientWithToken(writeToken);
    try {
      await reconnectOriginal();
      const originalList = await originalMcp.callTool({ name: "list_boards", arguments: {} });
      assert.deepEqual(JSON.parse(originalList.content[0].text).boards.map(b => b.board_id),
        [boardId]);
      const stillDenied = await originalMcp.callTool({
        name: "read_board", arguments: { board_id: secondBoardId },
      });
      assert.equal(stillDenied.isError, true);
    } finally { await originalMcp.close(); }
    console.log("PRIVATE_OAUTH_INDEPENDENT_BOARD_CONSENTS_PASS");
  } finally { await secondMcp.close(); }

  await page.goto(origin + "/patchboard-private/?board=" + boardId);
  await expect(page.getByRole("button", { name: /Sign out/ })).toBeVisible();

  // A viewer can explicitly consent to board:write, but that scope cannot
  // elevate the current Jazz membership role. Exercise the actual MCP route.
  const invited = await page.evaluate(async (board_id) => {
    const response = await fetch("/patchboard-private/api/invite", {
      method: "POST", credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id, role: "viewer" }),
    });
    return { status: response.status, body: await response.json() };
  }, boardId);
  assert.equal(invited.status, 201, JSON.stringify(invited));
  const inviteUrl = new URL(invited.body.invite_url);
  const viewerContext = await browser.newContext();
  const viewerPage = await viewerContext.newPage();
  viewerPage.on("pageerror", e => browserErrors.push("viewer: " + String(e)));
  try {
    const viewerCdp = await viewerContext.newCDPSession(viewerPage);
    await viewerCdp.send("WebAuthn.enable");
    await watchWebsockets(viewerCdp, "viewer");
    await viewerCdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    }});
    await viewerContext.route("http://127.0.0.1:7432/**", route =>
      route.fulfill({ status: 200, body: "Viewer OAuth callback received" }));
    await viewerPage.goto(origin + "/patchboard-private/");
    await viewerPage.getByRole("button", { name: "Create account with passkey" }).click();
    await expect(viewerPage.getByRole("button", { name: /Sign out/ }))
      .toBeVisible({ timeout: 20000 });
    const joined = await viewerPage.evaluate(async ({ board_id, token }) => {
      const response = await fetch("/patchboard-private/api/join", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board_id, token }),
      });
      return { status: response.status, body: await response.json() };
    }, { board_id: boardId, token: inviteUrl.searchParams.get("invite") });
    assert.equal(joined.status, 200, JSON.stringify(joined));
    const memberDirectoryStatus = await viewerPage.evaluate(async id =>
      (await fetch("/patchboard-private/api/members?board_id=" + encodeURIComponent(id),
        { credentials: "include", cache: "no-store" })).status, boardId);
    assert.equal(memberDirectoryStatus, 403,
      "Viewer must never list the owner-only member directory, including during display-name failures");
    console.log("PRIVATE_OAUTH_VIEWER_MEMBER_DIRECTORY_DENIED_PASS");
    const viewerWriteToken = await oauthGrant("board:read board:write", viewerPage, boardId);
    const { client: viewerMcp, connect: connectViewer } = clientWithToken(viewerWriteToken);
    try {
      await connectViewer();
      const viewerRead = await viewerMcp.callTool({
        name: "read_board", arguments: { board_id: boardId },
      });
      assert.equal(viewerRead.isError, undefined, JSON.stringify(viewerRead));
      const viewerWrite = await viewerMcp.callTool({
        name: "create_note", arguments: {
          board_id: boardId, text: "viewer must never write", request_id: randomUUID(),
        },
      });
      assert.equal(viewerWrite.isError, true);
      assert.match(viewerWrite.content[0].text, /BOARD_WRITE_DENIED/);
      console.log("PRIVATE_OAUTH_VIEWER_SCOPE_CANNOT_ESCALATE_ROLE_PASS");

      // Both authenticated profiles are subscribed to the same Jazz board
      // before an independently authenticated MCP call creates a new note.
      const sharedUrl = origin + "/patchboard-private/?board=" + boardId;
      await Promise.all([page.goto(sharedUrl), viewerPage.goto(sharedUrl)]);
      await Promise.all([page, viewerPage].map(async current => {
        await expect(current.getByRole("heading", { name: boardTitle }))
          .toBeVisible({ timeout: 18000 });
        await expect(current.getByText("Jazz shared · connected"))
          .toBeVisible({ timeout: 18000 });
      }));
      const liveMarker = "Two-browser private OAuth live " + randomUUID().slice(0, 8);
      const { client: liveOwnerMcp, connect: connectLiveOwner } = clientWithToken(writeToken);
      try {
        await connectLiveOwner();
        const saved = await liveOwnerMcp.callTool({ name: "create_note", arguments: {
          board_id: boardId, text: liveMarker, request_id: "live-" + randomUUID(),
        }});
        assert.equal(saved.isError, undefined, JSON.stringify(saved));
        const liveNote = JSON.parse(saved.content[0].text);
        assert.equal(liveNote.board_id, boardId);
        await Promise.all([page, viewerPage].map(current =>
          expect(current.locator(".note").filter({ hasText: liveMarker }))
            .toBeVisible({ timeout: 18000 })));
        const viewerAfter = await viewerMcp.callTool({
          name: "read_board", arguments: { board_id: boardId },
        });
        assert.equal(viewerAfter.isError, undefined, JSON.stringify(viewerAfter));
        const afterBoard = JSON.parse(viewerAfter.content[0].text);
        assert.ok(afterBoard.notes.some(note =>
          note.id === liveNote.note_id && note.text === liveMarker));
        const liveWs = websocketHandshakes.filter(item =>
          item.status === 101 && item.url.includes("/patchboard-private/jazz/"));
        assert.ok(liveWs.some(item => item.actor === "owner"),
          "Owner did not have a verified WSS HTTP 101 upgrade");
        assert.ok(liveWs.some(item => item.actor === "viewer"),
          "Viewer did not have a verified WSS HTTP 101 upgrade");
        console.log("PRIVATE_OAUTH_TWO_BROWSER_WSS_LIVE_MCP_PASS", JSON.stringify({
          boardId, noteId: liveNote.note_id, marker: liveMarker,
          handshakes: liveWs.map(({ actor, status }) => ({ actor, status })),
        }));
        // Third independent profile: editor's own passkey, Jazz identity and
        // OAuth client. Owner and editor intentionally reuse the SAME request
        // ID to prove author-scoped idempotency, not cross-user deduplication.
        const ownerMe = await page.evaluate(async () =>
          (await fetch("/patchboard-private/api/me")).json());
        assert.ok(ownerMe.signedIn && ownerMe.accountId && ownerMe.name);
        const editorInvite = await page.evaluate(async board_id => {
          const response = await fetch("/patchboard-private/api/invite", {
            method: "POST", credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ board_id, role: "editor" }),
          });
          return { status: response.status, body: await response.json() };
        }, boardId);
        assert.equal(editorInvite.status, 201, JSON.stringify(editorInvite));
        const editorInviteUrl = new URL(editorInvite.body.invite_url);
        const editorContext = await browser.newContext();
        try {
          const editorPage = await editorContext.newPage();
          editorPage.on("pageerror", e => browserErrors.push("editor: " + String(e)));
          const editorCdp = await editorContext.newCDPSession(editorPage);
          await editorCdp.send("WebAuthn.enable");
          await watchWebsockets(editorCdp, "editor");
          await editorCdp.send("WebAuthn.addVirtualAuthenticator", { options: {
            protocol: "ctap2", transport: "internal", hasResidentKey: true,
            hasUserVerification: true, isUserVerified: true,
            automaticPresenceSimulation: true,
          }});
          await editorContext.route("http://127.0.0.1:7432/**", route =>
            route.fulfill({ status: 200, body: "Editor OAuth callback received" }));
          await editorPage.goto(origin + "/patchboard-private/");
          await editorPage.getByRole("button", { name: "Create account with passkey" }).click();
          await expect(editorPage.getByRole("button", { name: /Sign out/ }))
            .toBeVisible({ timeout: 20000 });
          const joinedEditor = await editorPage.evaluate(async ({ board_id, token }) => {
            const response = await fetch("/patchboard-private/api/join", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ board_id, token }),
            });
            return { status: response.status, body: await response.json() };
          }, { board_id: boardId, token: editorInviteUrl.searchParams.get("invite") });
          assert.equal(joinedEditor.status, 200, JSON.stringify(joinedEditor));
          const editorToken = await oauthGrant("board:read board:write", editorPage, boardId);
          await editorPage.goto(sharedUrl);
          await expect(editorPage.getByText("Jazz shared · connected"))
            .toBeVisible({ timeout: 18000 });
          const editorMe = await editorPage.evaluate(async () =>
            (await fetch("/patchboard-private/api/me")).json());
          assert.ok(editorMe.signedIn && editorMe.accountId && editorMe.name);
          assert.notEqual(ownerMe.accountId, editorMe.accountId);
          const { client: editorMcp, connect: connectEditor } = clientWithToken(editorToken);
          try {
            await connectEditor();
            let canvasQaReport = null;
            let canvasDeniedReplay;
            if (process.env.PATCHBOARD_OAUTH_CI_RESTART === "1") {
              const { proveAcc051LiveCanvasPatch } = await import("./acc051-live-versioned-patch.mjs");
              canvasQaReport = await proveAcc051LiveCanvasPatch({
                boardId, siblingBoardId: secondBoardId, ownerPage: page, editorPage, viewerPage,
                editorMcp, viewerMcp, readOnlyToken: readToken, makeMcp: clientWithToken,
                editorActorId: editorMe.accountId,
              });
            }
            const request_id = "same-operation-" + randomUUID();
            const ownerText = "Owner wrote " + randomUUID().slice(0, 8);
            const editorText = "Editor wrote " + randomUUID().slice(0, 8);
            async function create(client, text) {
              const result = await client.callTool({ name: "create_note", arguments: {
                board_id: boardId, text, request_id,
              }});
              assert.equal(result.isError, undefined, JSON.stringify(result));
              return JSON.parse(result.content[0].text).note_id;
            }
            const ownerId = await create(liveOwnerMcp, ownerText);
            const editorId = await create(editorMcp, editorText);
            assert.notEqual(ownerId, editorId);
            assert.equal(await create(liveOwnerMcp, ownerText), ownerId);
            assert.equal(await create(editorMcp, editorText), editorId);
            const current = await editorMcp.callTool({
              name: "read_board", arguments: { board_id: boardId },
            });
            assert.equal(current.isError, undefined, JSON.stringify(current));
            const notes = JSON.parse(current.content[0].text).notes;
            const authorEvidence = [
              { id: ownerId, text: ownerText, author_id: ownerMe.accountId,
                author_name: ownerMe.name },
              { id: editorId, text: editorText, author_id: editorMe.accountId,
                author_name: editorMe.name },
            ].map(expected => {
              const note = notes.find(row => row.id === expected.id);
              assert.ok(note, "Missing author note");
              for (const [key, value] of Object.entries(expected)) {
                assert.equal(note[key], value, "Wrong persisted note field " + key);
              }
              return { ...expected, x: note.x, y: note.y, board_id: boardId };
            });
            assert.ok(!notes.some(note => note.text === "viewer must never write"),
              "Viewer's forbidden write must never create a note");
            for (const currentPage of [page, editorPage, viewerPage]) {
              for (const expected of authorEvidence) {
                const note = currentPage.locator(".note").filter({ hasText: expected.text });
                await expect(note).toBeVisible({ timeout: 20000 });
                await expect(note.getByText("Author: " + expected.author_name))
                  .toBeVisible({ timeout: 20000 });
              }
            }
            console.log("PRIVATE_OAUTH_TWO_WRITERS_ATTRIBUTED_LIVE_PASS", JSON.stringify({
              boardId, ownerNoteId: ownerId, editorNoteId: editorId,
              ownerAuthorId: ownerMe.accountId, editorAuthorId: editorMe.accountId,
              requestIdReused: true, browserProfiles: 3,
            }));

            // Regression: the private board is read-only over browser Jazz.
            // Owner/editor editing and movement must use server-authorized APIs.
            const originalUiText = "UI mutable note " + randomUUID().slice(0, 8);
            const editedUiText = "UI edited by invited editor " + randomUUID().slice(0, 8);
            await page.getByPlaceholder("Write a note…").fill(originalUiText);
            await page.getByRole("button", { name: "Add note" }).click();
            const editorNote = editorPage.locator(".note").filter({ hasText: originalUiText });
            await expect(editorNote).toBeVisible({ timeout: 20000 });
            await editorNote.getByRole("button", { name: "Edit note" }).click();
            await editorPage.getByRole("textbox", { name: "Note text" }).fill(editedUiText);
            await editorPage.getByRole("button", { name: "Save note" }).click();
            await Promise.all([page, editorPage, viewerPage].map(current =>
              expect(current.locator(".note").filter({ hasText: editedUiText }))
                .toBeVisible({ timeout: 18000 })));
            const beforeMove = await page.evaluate(async id => {
              const response = await fetch("/patchboard-private/api/board?board_id=" + id);
              return (await response.json()).notes.find(n => n.text.startsWith("UI edited by invited editor"));
            }, boardId);
            assert.ok(beforeMove?.id);
            await editorPage.locator(".note").filter({ hasText: editedUiText })
              .getByRole("button", { name: "Move note →" }).click();
            await expect.poll(async () => {
              const result = await page.evaluate(async id =>
                (await (await fetch("/patchboard-private/api/board?board_id=" + id)).json()).notes, boardId);
              return result.find(n => n.id === beforeMove.id)?.x;
            }, { timeout: 15000 }).toBe(beforeMove.x + 30);
            const viewerDenied = await viewerPage.evaluate(async noteId => {
              const result = await fetch("/patchboard-private/api/note/update", {
                method: "POST", credentials: "same-origin",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ note_id: noteId, text: "VIEWER FORGED EDIT" }),
              });
              return result.status;
            }, beforeMove.id);
            assert.equal(viewerDenied, 403);
            const afterMove = await page.evaluate(async id =>
              (await (await fetch("/patchboard-private/api/board?board_id=" + id)).json()).notes, boardId);
            const uiSaved = afterMove.find(n => n.id === beforeMove.id);
            assert.equal(uiSaved?.author_id, ownerMe.accountId);
            assert.equal(uiSaved?.text, editedUiText);
            assert.equal(uiSaved?.y, beforeMove.y);
            for (const current of [page, editorPage, viewerPage]) {
              await expect(current.getByText("Jazz update failed:")).toHaveCount(0);
            }
            console.log("PRIVATE_BROWSER_EDIT_MOVE_AUTHZ_LIVE_PASS", JSON.stringify({
              boardId, noteId: beforeMove.id, editedBy: editorMe.accountId,
              retainedAuthor: ownerMe.accountId, viewerStatus: viewerDenied,
            }));
        if (canvasQaReport) {
          // Real owner role mutation; the editor token remains live. Check
          // both transports before restoring the editor for #12's later proof.
          const setRole = async (role, version) => page.evaluate(async input => {
            const response = await fetch("/patchboard-private/api/members/role", {
              method: "POST", credentials: "same-origin",
              headers: { "content-type": "application/json" }, body: JSON.stringify(input),
            });
            return {status: response.status, body: await response.json()};
          }, {board_id: boardId, user_id: editorMe.accountId, role,
              expected_version: version, request_id: randomUUID()});
          const members = await page.evaluate(async id =>
            (await (await fetch("/patchboard-private/api/members?board_id=" + id)).json()).members, boardId);
          const editor = members.find(m => m.id === editorMe.accountId);
          assert.equal(editor.role, "editor");
          const downgraded = await setRole("viewer", editor.role_version);
          assert.equal(downgraded.status, 200);
          assert.equal(downgraded.body.role_version, editor.role_version + 1);
          const read = await editorMcp.callTool({name:"get_canvas_entity",arguments:{
            board_id:boardId,entity_id:canvasQaReport.entityIds.primary,
          }});
          assert.equal(read.isError, undefined, "Editor grant remains live as viewer");
          const replay = {board_id:boardId,entity_id:canvasQaReport.entityIds.primary,
            expected_version:7,request_id:canvasQaReport.stableRequestId,
            field_patch:canvasQaReport.fieldPatch};
          const denied = await editorMcp.callTool({name:"patch_canvas_entity",arguments:replay});
          assert.equal(denied.isError,true);
          assert.equal(denied.content[0].text,"BOARD_ACCESS_DENIED");
          const browserDenied=await editorPage.evaluate(async body=>{
            const response=await fetch("/patchboard-private/api/canvas/patch",{
              method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
              body:JSON.stringify(body),
            });
            return response.status;
          },replay);
          assert.equal(browserDenied,403);
          const restored=await setRole("editor",downgraded.body.role_version);
          assert.equal(restored.status,200);
          assert.equal(restored.body.role_version,downgraded.body.role_version+1);
          canvasDeniedReplay={
            mcpError:denied.content[0].text,browserStatus:browserDenied,grantStillReadable:true,roleRestoredForSeparateProof:true,
          };
          console.log("ACC051_REPLAY_AFTER_ROLE_DOWNGRADE_DENIED_PASS",JSON.stringify(canvasDeniedReplay));
        }
        const evidenceDir = process.env.PATCHBOARD_OAUTH_EVIDENCE_DIR;
        if (evidenceDir) {
          assert.ok(isAbsolute(evidenceDir), "Evidence path must be absolute");
          await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
          await Promise.all([
            page.screenshot({ path: join(evidenceDir, "owner-live.png") }),
            viewerPage.screenshot({ path: join(evidenceDir, "viewer-live.png") }),
          ]);
          await writeFile(join(evidenceDir, "private-oauth-live.json"), JSON.stringify({
            checkedAt: new Date().toISOString(),
            publicOrigin: origin, boardId, noteId: liveNote.note_id, marker: liveMarker,
            ownerWss101: liveWs.some(item => item.actor === "owner"),
            viewerWss101: liveWs.some(item => item.actor === "viewer"),
            authorEvidence, browserErrors,
          }, null, 2), { mode: 0o600 });
        }
        let canvasAudit;
        if (await restartPublicStaging(canvasQaReport ? async () => {
          const {auditAcc051CanvasPatch}=await import("./acc051-write-audit.mjs");
          canvasAudit=await auditAcc051CanvasPatch(canvasQaReport);
        } : undefined)) {
          await Promise.all([page.reload(), viewerPage.reload(), editorPage.reload()]);
          await Promise.all([page, viewerPage, editorPage].map(async current => {
            await expect(current.getByRole("heading", { name: boardTitle }))
              .toBeVisible({ timeout: 18000 });
            await expect(current.locator(".note").filter({ hasText: liveMarker }))
              .toBeVisible({ timeout: 18000 });
            for (const expected of authorEvidence) {
              const note = current.locator(".note").filter({ hasText: expected.text });
              await expect(note).toBeVisible({ timeout: 18000 });
              await expect(note.getByText("Author: " + expected.author_name))
                .toBeVisible({ timeout: 18000 });
            }
          }));
          const { client: afterRestart, connect: reconnect } = clientWithToken(writeToken);
          try {
            await reconnect();
            const persisted = await afterRestart.callTool({
              name: "read_board", arguments: { board_id: boardId },
            });
            assert.equal(persisted.isError, undefined, JSON.stringify(persisted));
            const recoveredBoard = JSON.parse(persisted.content[0].text);
            assert.equal(recoveredBoard.board_id, boardId);
            const notes = recoveredBoard.notes;
            assert.ok(notes.some(note =>
              note.id === liveNote.note_id && note.text === liveMarker));
            for (const expected of authorEvidence) {
              const found = notes.find(note => note.id === expected.id);
              assert.ok(found, "Note missing after server restart");
              for (const [key, value] of Object.entries(expected)) {
                if (key === "board_id") {
                  assert.equal(recoveredBoard.board_id, value);
                } else {
                  assert.equal(found[key], value,
                    "Changed author/coordinates/ID after restart: " + key);
                }
              }
            }
            const { client: editorRestart, connect: connectEditorRestart } =
              clientWithToken(editorToken);
            try {
              await connectEditorRestart();
              const editorBoard = await editorRestart.callTool({
                name: "read_board", arguments: { board_id: boardId },
              });
              assert.equal(editorBoard.isError, undefined, JSON.stringify(editorBoard));
              assert.ok(JSON.parse(editorBoard.content[0].text).notes.some(note =>
                note.id === editorId && note.author_id === editorMe.accountId));
            } finally { await editorRestart.close(); }
            console.log("PRIVATE_OAUTH_TWO_WRITERS_RESTART_ATTRIBUTION_PASS", JSON.stringify({
              boardId, ownerNoteId: ownerId, editorNoteId: editorId,
              persistedAuthorIds: authorEvidence.map(n => n.author_id),
            }));
            console.log("PRIVATE_PUBLIC_OAUTH_RESTART_EXACT_ID_PASS", JSON.stringify({
              boardId, noteId: liveNote.note_id, browserProfiles: 2,
            }));
            if (evidenceDir) {
              await Promise.all([
                page.screenshot({ path: join(evidenceDir, "owner-after-restart.png") }),
                viewerPage.screenshot({ path: join(evidenceDir, "viewer-after-restart.png") }),
              ]);
              await writeFile(join(evidenceDir, "private-oauth-restart.json"), JSON.stringify({
                checkedAt: new Date().toISOString(), publicOrigin: origin,
                boardId, noteId: liveNote.note_id, browserProfiles: 2,
                recoveredExactId: true, oauthTokenRemainedValid: true,
                browserErrors,
              }, null, 2), { mode: 0o600 });
            }
            if (canvasQaReport) {
              assert.equal(canvasAudit.persistedReceiptCount,2);
              assert.equal(canvasAudit.persistedEventCount,2);
              const ownerAfter=await page.evaluate(async({boardId,entityId})=>{
                const response=await fetch("/patchboard-private/api/canvas/entity?"+
                  new URLSearchParams({board_id:boardId,entity_id:entityId}),{cache:"no-store"});
                return {status:response.status,body:await response.json()};
              },{boardId,entityId:canvasQaReport.entityIds.primary});
              assert.equal(ownerAfter.status,200);
              assert.equal(ownerAfter.body.id,canvasQaReport.entityIds.primary);
              assert.equal(ownerAfter.body.version,8);
              assert.equal(ownerAfter.body.updatedBy,editorMe.accountId);
              assert.equal(ownerAfter.body.payload.label.markdown,canvasQaReport.fieldPatch.label_markdown);
              assert.equal(ownerAfter.body.payload.content.markdown,"preserved-content");
              const ownerSdk=await afterRestart.callTool({name:"get_canvas_entity",arguments:{
                board_id:boardId,entity_id:canvasQaReport.entityIds.primary,
              }});
              assert.equal(ownerSdk.isError,undefined);
              assert.deepEqual(JSON.parse(ownerSdk.content[0].text),ownerAfter.body);
              const summary={entityId:ownerAfter.body.id,version:8,updatedBy:ownerAfter.body.updatedBy,
                label:ownerAfter.body.payload.label.markdown,contentPreserved:true,
                writerMatchesEditor:true,ownerHttpAndMcpMatch:true,receipts:canvasAudit.persistedReceiptCount,
                events:canvasAudit.persistedEventCount,raceWinner:canvasQaReport.raceWinner};
              console.log("ACC051_INDEPENDENT_OWNER_RELOAD_RESTART_PASS",JSON.stringify(summary));
              if(evidenceDir){
                await writeFile(join(evidenceDir,"canvas-owner-restart.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});
                // Persist structured synthetic test evidence before CI's bounded
                // log formatter truncates long receipt and event IDs.
                await writeFile(join(evidenceDir,"canvas-verification.json"),JSON.stringify({
                  live:canvasQaReport.verification,deniedReplay:canvasDeniedReplay,
                  audit:canvasAudit,ownerAfterRestart:summary,
                },null,2)+"\n",{mode:0o600});
              }
            }
            // Reuse the editor's real OAuth grant only AFTER all its normal
            // acceptance and restart assertions. No extra DCR or rate-limit change.
            if (process.env.PATCHBOARD_OAUTH_CI_RESTART === "1") {
              await proveLiveGrantCallback({
                origin, mcpURL, boardId, token: editorToken,
                clientId: issuedTokens.get(editorToken).clientId,
                actorId: editorMe.accountId, writer: afterRestart,
                baseEntity: { graphUid: boardId, type: "note", version: 1,
                  content: { markdown: "Callback ordering fixture" },
                  properties: { nodePosition: { type: "position", position: { x: 10, y: 20 } } } },
              });
            }
          } finally {
            await afterRestart.close();
          }
        }
          } finally { await editorMcp.close(); }
        } finally { await editorContext.close(); }
      } finally {
        await liveOwnerMcp.close();
      }
    } finally {
      await viewerMcp.close();
    }
  } finally {
    await viewerContext.close();
  }
  assert.deepEqual(browserErrors, []);
 } finally {
  await context.close();
  await browser.close();
  if (ciReplacementGroup) {
    try { process.kill(-ciReplacementGroup, "SIGTERM"); } catch { /* exited */ }
    await new Promise(done => setTimeout(done, 1400));
    try { process.kill(-ciReplacementGroup, "SIGKILL"); } catch { /* exited */ }
  }
}
