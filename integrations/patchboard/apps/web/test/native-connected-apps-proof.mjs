/** Native connected-app Settings proof with real OAuth, passkeys and disposable Jazz. */
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const patchboard = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const webui = resolve(patchboard, "../../webui");
const root = await mkdtemp(join(tmpdir(), "dim0-native-connected-apps-fixture-"));
const evidence = process.env.PATCHBOARD_NATIVE_CONNECTED_APPS_EVIDENCE
  ? resolve(process.env.PATCHBOARD_NATIVE_CONNECTED_APPS_EVIDENCE)
  : await mkdtemp(join(tmpdir(), "dim0-native-connected-apps-evidence-"));
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
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(origin + "/settings");
  await expect(page.getByLabel("Preferred locale (BCP 47)")).toHaveValue("en");
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
  browser = await chromium.launch({ headless: true });
  const owner = await account(), other = await account();
  assert.notEqual(owner.identity.id, other.identity.id);
  assert.notEqual(owner.identity.accountId, other.identity.accountId);
  const api = (page, path, data) => page.evaluate(async ({path,data}) => {
    const response=await fetch("/patchboard-private/api/"+path,data===undefined?{cache:"no-store"}:{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data),
    });
    return {status:response.status,body:await response.json()};
  },{path,data});
  const createBoard=async(account,title)=>{
    const result=await api(account.page,"boards",{title});
    assert.equal(result.status,201);
    return result.body.board_id;
  };
  const boardA=await createBoard(owner,"Connection A");
  const boardB=await createBoard(owner,"Connection B");
  const boardC=await createBoard(other,"Independent account");
  const mcpURL=origin+"/patchboard-private-mcp";
  const callback="http://127.0.0.1:7432/callback";
  for(const item of [owner,other]) await item.context.route(callback+"**",route=>route.fulfill({status:200,body:"Local OAuth callback"}));
  const discovery=await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth");
  assert.equal(discovery.status,200);
  const metadata=await discovery.json();
  for(const endpoint of ["registration_endpoint","authorization_endpoint","token_endpoint"])
    assert.equal(new URL(metadata[endpoint]).origin,origin);
  async function authorize(account,board_id,label) {
    const scope="board:read";
    const registration=await fetch(metadata.registration_endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
      client_name:label,application_type:"native",redirect_uris:[callback],
      token_endpoint_auth_method:"none",grant_types:["authorization_code"],response_types:["code"],scope,
    })});
    assert.equal(registration.status,201);
    const {client_id}=await registration.json();
    const verifier=randomBytes(32).toString("base64url");
    const challenge=createHash("sha256").update(verifier).digest("base64url");
    const state=randomUUID();
    const auth=new URL(metadata.authorization_endpoint);
    for(const [k,v] of Object.entries({client_id,response_type:"code",redirect_uri:callback,
      code_challenge:challenge,code_challenge_method:"S256",state,scope,resource:mcpURL})) auth.searchParams.set(k,v);
    const page=account.page;
    await page.goto(auth.href,{waitUntil:"domcontentloaded"});
    await expect(page).toHaveURL(url=>url.origin===origin && url.searchParams.get("client_id")===client_id &&
      ["/signin","/patchboard-private/oauth-consent"].includes(url.pathname));
    if(new URL(page.url()).pathname==="/signin") {
      await page.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
    }
    await expect(page.getByRole("heading",{name:"Authorize a Dim0 connection",exact:true})).toBeVisible({timeout:30000});
    await page.getByLabel("Approved board").selectOption(board_id);
    await page.getByRole("button",{name:"Authorize selected board"}).click();
    await page.waitForURL(url=>url.origin==="http://127.0.0.1:7432" && url.searchParams.get("state")===state,{timeout:15000});
    const code=new URL(page.url()).searchParams.get("code");
    assert.ok(code);
    const response=await fetch(metadata.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({
      grant_type:"authorization_code",code,client_id,redirect_uri:callback,code_verifier:verifier,resource:mcpURL,
    })});
    assert.equal(response.status,200);
    const {access_token}=await response.json();
    assert.ok(access_token);
    await page.goto(origin+"/settings");
    return {clientId:client_id,boardId:board_id,token:access_token};
  }
  const a=await authorize(owner,boardA,"Native settings QA A");
  const b=await authorize(owner,boardB,"Native settings QA B");
  const c=await authorize(other,boardC,"Native settings QA C");
  assert.equal(new Set([a.clientId,b.clientId,c.clientId]).size,3);
  const read=async grant=>{
    const client=new Client({name:"native-settings-proof",version:"1"});
    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(mcpURL),{
        requestInit:{headers:{Authorization:"Bearer "+grant.token}},
      }));
      const result=await client.callTool({name:"read_board",arguments:{board_id:grant.boardId}});
      assert.equal(result.isError,undefined);
      assert.equal(JSON.parse(result.content[0].text).board_id,grant.boardId);
    } finally {await client.close();}
  };
  await Promise.all([read(a),read(b),read(c)]);
  const ownerList=await api(owner.page,"account/connected-apps");
  assert.equal(ownerList.status,200);
  assert.equal(ownerList.body.grants.length,2);
  const grantA=ownerList.body.grants.find(g=>g.clientId===a.clientId);
  const grantB=ownerList.body.grants.find(g=>g.clientId===b.clientId);
  assert.ok(grantA && grantB);
  assert.equal(grantA.boardId,boardA);
  assert.equal(grantB.boardId,boardB);
  assert.equal(grantA.revokedAtMs,null);
  assert.equal(grantB.revokedAtMs,null);
  const foreignList=await api(other.page,"account/connected-apps");
  assert.equal(foreignList.status,200);
  assert.deepEqual(foreignList.body.grants.map(g=>g.clientId),[c.clientId]);
  const forbidden=await api(other.page,"account/connected-apps/revoke",{
    grant_id:grantA.id,client_id:a.clientId,expected_version:grantA.grantVersion,request_id:randomUUID(),
  });
  assert.equal(forbidden.status,403);
  assert.deepEqual((await api(owner.page,"account/connected-apps")).body,ownerList.body);
  const row=(page,grant)=>page.getByRole("listitem").filter({hasText:"Client "+grant.clientId});
  await expect(row(owner.page,a).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
  await expect(row(owner.page,b).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
  await expect(row(other.page,c).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
  await expect(row(other.page,a)).toHaveCount(0);
  await owner.page.screenshot({path:join(evidence,"owner-before.png"),fullPage:true});
  await other.page.screenshot({path:join(evidence,"other-account.png"),fullPage:true});

  let posts=0,failedRefresh=0,confirmations=0,committed,inject=false;
  await owner.page.route("**/patchboard-private/api/account/connected-apps/revoke",async route=>{
    posts++;
    const request=route.request().postDataJSON();
    assert.equal(request.grant_id,grantA.id);
    assert.equal(request.client_id,a.clientId);
    assert.equal(request.expected_version,grantA.grantVersion);
    assert.match(request.request_id,/^[A-Za-z0-9_-]{1,128}$/);
    const response=await route.fetch();
    const body=await response.json();
    committed={status:response.status(),body};
    if(response.status()===200)inject=true;
    await route.fulfill({response,json:body});
  });
  await owner.page.route("**/patchboard-private/api/account/connected-apps",route=>{
    if(inject){
      inject=false;failedRefresh++;
      return route.fulfill({status:503,json:{error:"GRANTS_UNAVAILABLE"}});
    }
    return route.continue();
  });
  owner.page.once("dialog",async dialog=>{
    assert.equal(dialog.type(),"confirm");
    confirmations++;await dialog.accept();
  });
  await row(owner.page,a).getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(owner.page.getByRole("status")).toContainText("Connected app grant revoked. Grant list temporarily unavailable;");
  await expect(owner.page.getByText("Connected apps unavailable; refresh to retry.")).toBeVisible();
  assert.equal(committed.status,200);
  assert.equal(committed.body.grant_id,grantA.id);
  assert.equal(committed.body.version,grantA.grantVersion+1);
  assert.ok(committed.body.revoked_at_ms);
  assert.equal(posts,1);
  assert.equal(failedRefresh,1);
  assert.equal(confirmations,1);
  await owner.page.screenshot({path:join(evidence,"confirmed-refresh-failed.png"),fullPage:true});

  const fresh=await fetch(mcpURL,{method:"POST",headers:{
    Authorization:"Bearer "+a.token,"content-type":"application/json",Accept:"application/json, text/event-stream",
  },body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"read_board",arguments:{board_id:boardA}}})});
  assert.equal(fresh.status,401);
  await fresh.body?.cancel();
  await Promise.all([read(b),read(c)]);
  await owner.page.reload();
  await expect(row(owner.page,a).getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled();
  await expect(row(owner.page,a)).toContainText("Revoked");
  await expect(row(owner.page,b).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
  await expect(row(owner.page,b)).toContainText("Active");
  const durable=(await api(owner.page,"account/connected-apps")).body.grants;
  assert.equal(durable.find(g=>g.id===grantA.id).grantVersion,grantA.grantVersion+1);
  assert.equal(durable.find(g=>g.id===grantA.id).revokedAtMs,committed.body.revoked_at_ms);
  assert.deepEqual(durable.find(g=>g.id===grantB.id),grantB);
  assert.deepEqual((await api(other.page,"account/connected-apps")).body,foreignList.body);
  for(const account of [owner,other]){
    const me=await api(account.page,"me");
    assert.equal(me.status,200);
    assert.equal(me.body.signedIn,true);
    assert.equal(me.body.id,account.identity.id);
    assert.equal(me.body.accountId,account.identity.accountId);
  }
  assert.equal(posts,1);
  await owner.page.screenshot({path:join(evidence,"owner-after-reload.png"),fullPage:true});
  const summary={browser:browser.version(),realOAuthClients:3,independentAccounts:2,initialOwnerGrants:2,
    otherAccountOnlyOwnGrant:true,foreignDisconnectStatus:403,selectedPostStatus:200,
    selectedGrantVersion:committed.body.version,failedRefreshStatus:503,confirmedStatusPreserved:true,
    reloadA:"revoked",reloadB:"active",freshAStatus:401,independentBAndCUsable:true,
    ownerSessionPreserved:true,otherSessionPreserved:true,postCount:posts};
  await writeFile(join(evidence,"result.json"),JSON.stringify(summary,null,2)+"\n");
  console.log("NATIVE_CONNECTED_APPS_PROOF_PASS",JSON.stringify(summary));
} finally {
  await browser?.close();
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
