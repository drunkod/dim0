/** Native invitation acceptance proof, with disposable Better Auth/Jazz storage. */
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const patchboard = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const webui = resolve(patchboard, "../../webui");
const root = await mkdtemp(join(tmpdir(), "dim0-native-invitation-fixture-"));
const evidence = process.env.PATCHBOARD_NATIVE_INVITATION_EVIDENCE
  ? resolve(process.env.PATCHBOARD_NATIVE_INVITATION_EVIDENCE)
  : await mkdtemp(join(tmpdir(), "dim0-native-invitation-evidence-"));
await mkdir(evidence, { recursive: true, mode: 0o700 });
const freePort = () => new Promise((done, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => done(port));
  });
});
const frontendPort = await freePort();
let backendPort = await freePort();
while (backendPort === frontendPort) backendPort = await freePort();
const origin = "http://localhost:" + frontendPort;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(key)));
Object.assign(env, {
  CI: "1", VITE_DIM0_JAZZ_CANVAS: "1", APP_PORT: String(frontendPort),
  PATCHBOARD_PRIVATE_ROOT: root, PATCHBOARD_PRIVATE_ORIGIN: origin,
  PATCHBOARD_PRIVATE_DEV: "1", PATCHBOARD_PRIVATE_DIM0_ONLY: "1", PATCHBOARD_PRIVATE_PORT: String(backendPort),
});
const jobs = [];
let browser;
function launch(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { output = (output + chunk).slice(-12000); });
  }
  const done = new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolveDone(code));
  });
  const job = { child, done, output: () => output };
  jobs.push(job);
  return job;
}
async function execute(command, args, cwd) {
  const job = launch(command, args, cwd);
  assert.equal(await job.done, 0, command + " failed: " + job.output());
}
async function waitReady(job, url) {
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.equal(job.child.exitCode, null, "QA service exited: " + job.output());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch { /* cold local start */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("QA service did not become ready");
}
async function account() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.setDefaultNavigationTimeout(20000);
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(origin + "/signup");
  await page.getByRole("button", { name: "Create account with passkey", exact: true }).click();
  await expect(page.getByRole("link", { name: "Account settings" })).toBeVisible({ timeout: 30000 });
  const identity = await page.evaluate(async () => (await fetch("/patchboard-private/api/me")).json());
  assert.ok(identity.signedIn && identity.id && identity.accountId);

  return { context, page, identity };
}
try {
  await execute("pnpm", ["auth:migrate:private"], patchboard);
  const backend = launch("pnpm", ["--filter", "@patchboard/server", "exec", "tsx", "src/private-demo.ts"], patchboard);
  await waitReady(backend, "http://127.0.0.1:" + backendPort + "/health");
  const vite = join(webui, "node_modules/.bin/vite");
  const buildDir = join(root, "native-build");
  await execute(vite, ["build", "--outDir", buildDir], webui);
  const frontend = launch(vite, ["preview", "--outDir", buildDir, "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], webui);
  await waitReady(frontend, origin + "/signup");
  browser = await chromium.launch({ headless: true, ...(process.env.DIM0_QA_CHROMIUM_EXECUTABLE ? { executablePath: process.env.DIM0_QA_CHROMIUM_EXECUTABLE } : {}) });
  const owner = await account(), invitee = await account(), other = await account();
  assert.equal(new Set([owner.identity.accountId, invitee.identity.accountId, other.identity.accountId]).size, 3);
  const events = [];
  const stages = [];
  for (const [actor, { page }] of Object.entries({ owner, invitee, other })) {
    page.on("request", request => {
      if (new URL(request.url()).pathname === "/patchboard-private/api/join" && request.method() === "POST")
        events.push({ actor, event: "join-request" });
    });
    page.on("response", response => {
      const path = new URL(response.url()).pathname;
      if (["/patchboard-private/api/join", "/patchboard-private/api/invites/preview"].includes(path))
        events.push({ actor, event: path.endsWith("/join") ? "join-response" : "preview-response", status: response.status() });
    });
  }
  // Record roles and counts only; never store bearer links or authorization headers.
  const api = (page, path, data) => page.evaluate(async ({path, data}) => {
    const response = await fetch("/patchboard-private/api/" + path, data === undefined ? {} : {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data),
    });
    return {status: response.status, body: await response.json()};
  }, {path, data});
  const createBoard = async title => {
    const result = await api(owner.page, "boards", {title});
    assert.equal(result.status, 201);
    return result.body.board_id;
  };
  const makeInvite = async (board_id, role) => {
    const result = await api(owner.page, "invite", {board_id, role, reusable: false});
    assert.equal(result.status, 201);
    assert.equal(result.body.reusable, false);
    // The old single-use issuer returns a legacy Patchboard query URL.
    // Exercise its same secret through the native, fragment-only landing.
    const token = new URL(result.body.invite_url).searchParams.get("invite");
    assert.ok(token && token.length === 43);
    return origin + "/jazz-invite/" + board_id + "#invite=" + encodeURIComponent(token);
  };
  const boardId = await createBoard("Invitation proof board");
  const unrelatedBoard = await createBoard("Unrelated invitation board");
  const invitation = await makeInvite(boardId, "viewer");
  const unrelated = await makeInvite(unrelatedBoard, "editor");
  const members = async (id = boardId) => {
    const result = await api(owner.page, "members?board_id=" + id);
    assert.equal(result.status, 200);
    return result.body.members;
  };
  const countJoins = () => events.filter(e => e.event === "join-request").length;
  const check = async (stage, expectedCount, expectedJoins, id = boardId) => {
    const rows = await members(id);
    assert.equal(rows.length, expectedCount, stage);
    assert.equal(countJoins(), expectedJoins, stage);
    stages.push({stage, board: id === boardId ? "invited" : "unrelated", roles: rows.map(r => r.role).sort(), joins: countJoins()});
    console.log("INVITATION_STAGE_PASS", stage, "members", expectedCount, "joins", expectedJoins);
  };
  const openShare = async label => {
    await owner.page.goto(origin + "/boards/" + boardId);
    await owner.page.getByRole("button", {name: "Share this board", exact: true}).click();
    const dialog = owner.page.getByRole("dialog");
    await expect(dialog.getByText("People with access")).toBeVisible();
    await expect(dialog.locator("li")).toHaveCount(label === "before" ? 1 : 2);
    await owner.page.screenshot({path: join(evidence, "owner-" + label + ".png")});
    await dialog.getByRole("button", {name:"Close", exact:true}).click();
  };
  const signOut = async ({page}) => {
    await page.goto(origin + "/boards");
    await page.getByRole("button", {name:"Sign out", exact:true}).click();
    await expect(page).toHaveURL(url => url.pathname === "/signin");
  };
  const prepare = async (page, link) => {
    await page.goto(link);
    await expect(page.getByRole("button",{name:"Sign in",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Sign in",exact:true}).click();
    await expect(page).toHaveURL(url => url.pathname === "/signin");
  };
  await check("owner-only", 1, 0);
  await openShare("before");
  await signOut(invitee);
  await prepare(invitee.page, invitation);
  await invitee.page.getByRole("button", {name:"Sign in with passkey",exact:true}).click();
  await expect(invitee.page.getByRole("button",{name:"Review invitation",exact:true})).toBeVisible({timeout:30000});
  const signed = await api(invitee.page, "me");
  assert.equal(signed.body.accountId, invitee.identity.accountId);
  await check("signed-in-review-pending", 1, 0);
  await invitee.page.screenshot({path:join(evidence,"invitee-review-pending.png")});
  await invitee.page.getByRole("button",{name:"Review invitation",exact:true}).click();
  await expect(invitee.page.getByText("You'll have view-only access to this board.",{exact:true})).toBeVisible();
  await check("role-preview", 1, 0);
  await invitee.page.screenshot({path:join(evidence,"invitee-role-preview.png")});
  await invitee.page.goto(origin+"/boards");
  await expect(invitee.page.getByRole("button",{name:"Review invitation",exact:true})).toBeVisible();
  await invitee.page.reload();
  await expect(invitee.page.getByRole("button",{name:"Review invitation",exact:true})).toBeVisible();
  await check("leave-and-reload",1,0);
  await invitee.page.getByRole("button",{name:"Cancel invitation",exact:true}).click();
  await expect(invitee.page.getByRole("button",{name:"Review invitation",exact:true})).toHaveCount(0);
  await invitee.page.reload();
  await expect(invitee.page.getByRole("button",{name:"Create board",exact:true})).toBeVisible();
  await expect(invitee.page.getByRole("button",{name:"Review invitation",exact:true})).toHaveCount(0);
  await check("dismissed-and-reloaded",1,0);
  await invitee.page.goto(invitation,{waitUntil:"domcontentloaded"});
  console.log("INVITATION_REOPENED");
  await expect(invitee.page.getByRole("button",{name:"Accept invitation",exact:true})).toBeVisible({timeout:15000});
  // Capture the real server response before the browser replaces this document.
  // Forward the one request unchanged; no fixture response or second mutation.
  let joinConfirmation;
  await invitee.page.route("**/patchboard-private/api/join",async route=>{
    const response=await route.fetch({timeout:15000});
    const body=await response.json();
    joinConfirmation={status:response.status(),boardId:body.board_id};
    await route.fulfill({response});
  });
  await invitee.page.getByRole("button",{name:"Accept invitation",exact:true}).click();
  await expect.poll(()=>joinConfirmation,{timeout:20000}).toEqual({status:200,boardId});
  await invitee.page.unroute("**/patchboard-private/api/join");
  await expect(invitee.page).toHaveURL(url => url.pathname === "/boards/"+boardId);
  await check("explicitly-accepted",2,1);
  assert.equal((await members()).find(m => m.id === invitee.identity.accountId)?.role,"viewer");
  await openShare("after");
  await other.page.goto(invitation);
  await expect(other.page.getByText("This invitation isn't usable",{exact:true})).toBeVisible();
  await check("consumed-single-use-preview-denied",2,1);
  await other.page.screenshot({path:join(evidence,"consumed-link-denied.png")});
  // Verify the server also refuses a direct claim by this independent account.
  const invalid = await api(other.page,"join",{board_id:boardId,token:new URLSearchParams(new URL(invitation).hash.slice(1)).get("invite")});
  assert.equal(invalid.status,404);
  await check("consumed-single-use-direct-claim-denied",2,2);

  // Real signed provider redirect, not a fabricated sig parameter.
  await signOut(invitee);
  await prepare(invitee.page, unrelated);
  const resource = origin + "/patchboard-private-mcp";
  const metadata = await (await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth")).json();
  assert.ok(metadata.registration_endpoint && metadata.authorization_endpoint);
  const callback = "http://127.0.0.1:7432/callback";
  const registration = await fetch(metadata.registration_endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    client_name:"Invitation QA client",application_type:"native",redirect_uris:[callback],
    token_endpoint_auth_method:"none",grant_types:["authorization_code"],response_types:["code"],scope:"board:read",
  })});
  assert.equal(registration.status,201);
  const {client_id} = await registration.json();
  const state = randomUUID();
  const challenge = createHash("sha256").update(randomBytes(32).toString("base64url")).digest("base64url");
  const auth = new URL(metadata.authorization_endpoint);
  for (const [k,v] of Object.entries({client_id,response_type:"code",redirect_uri:callback,
    code_challenge:challenge,code_challenge_method:"S256",state,scope:"board:read",resource})) auth.searchParams.set(k,v);
  await invitee.page.goto(auth.href);
  await expect(invitee.page).toHaveURL(url => url.pathname === "/signin" && url.searchParams.get("client_id") === client_id && url.searchParams.has("sig"));
  await invitee.page.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await expect(invitee.page.getByRole("heading",{name:"Authorize a Dim0 connection",exact:true})).toBeVisible({timeout:30000});
  assert.equal(new URL(invitee.page.url()).searchParams.get("client_id"),client_id);
  assert.equal(await invitee.page.evaluate(id => JSON.parse(sessionStorage.getItem("dim0:jazz:pendingInvite") || "null")?.boardId === id, unrelatedBoard),true);
  await check("signed-oauth-continuation-before-invitation",1,2,unrelatedBoard);
  await invitee.page.screenshot({path:join(evidence,"oauth-consent.png")});
  // Do not issue an access token; return the signed denial to a local callback.
  await invitee.context.route(callback+"**",route=>route.fulfill({status:200,body:"QA callback"}));
  await invitee.page.getByRole("button",{name:"Deny",exact:true}).click();
  await expect(invitee.page).toHaveURL(url=>url.origin==="http://127.0.0.1:7432" && url.searchParams.get("state")===state);
  await invitee.page.goto(unrelated);
  await expect(invitee.page.getByRole("button",{name:"Accept invitation",exact:true})).toBeVisible();
  await check("oauth-denied-invitation-still-usable",1,2,unrelatedBoard);
  await writeFile(join(evidence,"result.json"),JSON.stringify({browser:browser.version(),stages,events,threeIndependentSubjects:true},null,2)+"\n");
  console.log("NATIVE_INVITATION_PROOF_PASS", JSON.stringify(stages));
} finally {
  await browser?.close().catch(()=>{});
  for (const job of jobs.reverse()) {
    if (job.child.exitCode === null && job.child.signalCode === null) {
      try { process.kill(-job.child.pid, "SIGTERM"); } catch { /* already exited */ }
      await Promise.race([job.done, new Promise(done => setTimeout(done, 3000))]);
      if (job.child.exitCode === null && job.child.signalCode === null) {
        try { process.kill(-job.child.pid, "SIGKILL"); } catch { /* already exited */ }
        await job.done;
      }
    }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
