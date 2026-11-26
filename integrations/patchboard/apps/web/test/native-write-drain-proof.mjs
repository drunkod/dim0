/** Native connected-app Settings proof with real OAuth, passkeys and disposable Jazz. */
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFile, access } from "node:fs/promises";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type:"json" };
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
const root = await mkdtemp(join(tmpdir(), "patchboard-private-ci-native-drain-"));
const evidence = process.env.PATCHBOARD_NATIVE_DRAIN_EVIDENCE
  ? resolve(process.env.PATCHBOARD_NATIVE_DRAIN_EVIDENCE)
  : await mkdtemp(join(tmpdir(), "dim0-native-drain-evidence-"));
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
  PATCHBOARD_OAUTH_CI_RESTART: "1", PATCHBOARD_ACC051_INFLIGHT_QA: "1", PATCHBOARD_PRIVATE_TEST_PID_FILE: join(root,"qa-private-server.pid"),
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
  let backend = launch("pnpm", ["--filter", "@patchboard/server", "exec", "tsx", "src/private-demo.ts"], patchboard);
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
  const boardB=await createBoard(owner,"Independent client board");
  const boardC=await createBoard(owner,"Disconnect first board");
  const mcpURL=origin+"/patchboard-private-mcp";
  const callback="http://127.0.0.1:7432/callback";
  for(const item of [owner,other]) await item.context.route(callback+"**",route=>route.fulfill({status:200,body:"Local OAuth callback"}));
  const discovery=await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth");
  assert.equal(discovery.status,200);
  const metadata=await discovery.json();
  for(const endpoint of ["registration_endpoint","authorization_endpoint","token_endpoint"])
    assert.equal(new URL(metadata[endpoint]).origin,origin);
  async function authorize(account,board_id,label) {
    const scope="board:read board:write";
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
  const invite=await api(owner.page,"invite",{board_id:boardA,role:"editor"});
  assert.equal(invite.status,201);
  const joined=await api(other.page,"join",{
    board_id:boardA,token:new URL(invite.body.invite_url).searchParams.get("invite"),
  });
  assert.equal(joined.status,200);
  const a=await authorize(other,boardA,"Native drain A Editor");
  const b=await authorize(owner,boardB,"Native drain B independent");
  const c=await authorize(owner,boardC,"Native drain C owner");
  assert.equal(new Set([a.clientId,b.clientId,c.clientId]).size,3);
  const grants=async page=>(await api(page,"account/connected-apps")).body.grants;
  const lookup=async (account,client)=>{
    const g=(await grants(account.page)).find(g=>g.clientId===client.clientId && g.boardId===client.boardId);
    assert.ok(g);assert.equal(g.grantVersion,1);assert.equal(g.revokedAtMs,null);return g;
  };
  const grantA=await lookup(other,a),grantB=await lookup(owner,b),grantC=await lookup(owner,c);
  assert.ok(!(await grants(other.page)).some(g=>g.id===grantB.id));
  assert.equal((await api(owner.page,"account/connected-apps/revoke",{
    grant_id:grantA.id,client_id:a.clientId,expected_version:1,request_id:randomUUID()
  })).status,403);
  const sqlFile=join(root,"auth","better-auth.sqlite");
  const probe=id=>{
    const db=new DatabaseSync(sqlFile,{readOnly:true});
    try{
      const g=db.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?").get(id);
      return {version:g.grant_version,revoked:g.revoked_at_ms!==null,
        leases:db.prepare("SELECT COUNT(*) n FROM patchboard_mcp_write_lease WHERE grant_id=?").get(id).n,
        pending:!!db.prepare("SELECT 1 FROM patchboard_grant_disconnect_pending WHERE grant_id=?").get(id)};
    }finally{db.close();}
  };
  const eventually=async (check,label,ms=30000)=>{
    const deadline=Date.now()+ms;
    while(Date.now()<deadline){if(await check())return;await new Promise(r=>setTimeout(r,25));}
    throw new Error("Timeout waiting for "+label);
  };
  const make=async g=>{
    const client=new Client({name:"native-drain-proof",version:"1"});
    await client.connect(new StreamableHTTPClientTransport(new URL(mcpURL),{
      requestInit:{headers:{Authorization:"Bearer "+g.token}},
    }));
    return client;
  };
  const call=async (client,name,args)=>{
    const result=await client.callTool({name,arguments:args});
    assert.equal(result.isError,undefined, name+" failed: "+JSON.stringify(result.content));
    return JSON.parse(result.content[0].text);
  };
  const fresh=async g=>{
    const r=await fetch(mcpURL,{method:"POST",headers:{
      Authorization:"Bearer "+g.token,"content-type":"application/json",Accept:"application/json, text/event-stream"
    },body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"read_board",arguments:{board_id:g.boardId}}})});
    await r.body?.cancel();
    return r.status;
  };
  const row=(page,grant)=>page.getByRole("listitem").filter({hasText:"Client "+grant.clientId});
  const readCanvas=async (account,boardId,id)=>{
    const r=await account.context.request.get(origin+"/patchboard-private/api/canvas/entity?"+new URLSearchParams({board_id:boardId,entity_id:id}));
    assert.equal(r.status(),200);
    return r.json();
  };
  const payload=(boardId,id,version,label,style)=>({
    id,graphUid:boardId,type:"note",version,label:{markdown:label},
    content:{markdown:"preserve-content"},
    properties:{nodePosition:{type:"position",position:{x:7,y:8}}},
    ...(style?{style}:{}),
  });
  const seed=async(boardId,id)=>{
    const created=await api(owner.page,"canvas/create",{board_id:boardId,kind:"node",payload:payload(boardId,id,1,"v1")});
    assert.equal(created.status,201);
    for(let version=2;version<=7;version++){
      const r=await api(owner.page,"canvas/update",{board_id:boardId,entity_id:id,expected_version:version-1,payload:payload(boardId,id,version,"v"+version)});
      assert.equal(r.status,200);assert.equal(r.body.version,version);
    }
    return readCanvas(owner,boardId,id);
  };
  const leasedId=randomUUID(),deniedId=randomUUID();
  const initialA=await seed(boardA,leasedId),initialC=await seed(boardC,deniedId);
  assert.equal(initialA.version,7);assert.equal(initialC.version,7);
  // Fixture-only SQL observation of lease insert/delete; no change to grant
  // authority. Each real callback runs sequentially against independent B,
  // so a pair of ledger events is attributable to that specific SDK call.
  {
    const db=new DatabaseSync(sqlFile);
    try{
      db.exec("PRAGMA busy_timeout=5000");
      db.exec(`CREATE TABLE qa_native_drain_lease_events(seq INTEGER PRIMARY KEY, phase TEXT, grant_id TEXT, lease_id TEXT);
        CREATE TRIGGER qa_native_drain_insert AFTER INSERT ON patchboard_mcp_write_lease BEGIN
          INSERT INTO qa_native_drain_lease_events(phase,grant_id,lease_id) VALUES('reserve',NEW.grant_id,NEW.id);
        END;
        CREATE TRIGGER qa_native_drain_delete AFTER DELETE ON patchboard_mcp_write_lease BEGIN
          INSERT INTO qa_native_drain_lease_events(phase,grant_id,lease_id) VALUES('settle',OLD.grant_id,OLD.id);
        END;`);
    }finally{db.close();}
  }
  const leaseEvents=id=>{
    const db=new DatabaseSync(sqlFile,{readOnly:true});
    try{return db.prepare("SELECT phase,lease_id FROM qa_native_drain_lease_events WHERE grant_id=? ORDER BY seq").all(id);}
    finally{db.close();}
  };
  const B=await make(b);
  const appletId=randomUUID(),base={board_id:boardB},style={type:"applet"};
  const coverage=[];
  try{
    for(const [name,args] of [
      ["create_note",{...base,text:"Independent B receipt",request_id:randomUUID()}],
      ["create_canvas_entity",{...base,kind:"node",payload:payload(boardB,appletId,1,"one",style)}],
      ["update_canvas_entity",{...base,entity_id:appletId,expected_version:1,payload:payload(boardB,appletId,2,"two",style)}],
      ["patch_canvas_entity",{...base,entity_id:appletId,expected_version:2,request_id:randomUUID(),field_patch:{label_markdown:"three"}}],
      ["update_applet_state",{...base,note_id:appletId,expected_version:0,value:{count:1}}],
      ["delete_canvas_entity",{...base,entity_id:appletId,expected_version:3}],
    ]){
      const previous=leaseEvents(grantB.id).length;
      await call(B,name,args);
      const observed=leaseEvents(grantB.id).slice(previous);
      assert.equal(observed.length,2);
      assert.deepEqual(observed.map(r=>r.phase),["reserve","settle"]);
      assert.equal(observed[0].lease_id,observed[1].lease_id);
      assert.equal(probe(grantB.id).leases,0);
      coverage.push({tool:name,reserved:true,settled:true,success:true});
    }
    const traces=[];
    async function order(phase,account,g,grant,id,initial){
      const client=await make(g);
      const requestId="qa_inflight_"+phase+"_"+randomUUID().replaceAll("-","");
      const markerDir=join(root,"acc051-write-pauses");
      const ready=join(markerDir,phase+"-"+requestId+".ready");
      const resume=join(markerDir,phase+"-"+requestId+".resume");
      const input={board_id:g.boardId,entity_id:id,expected_version:7,request_id:requestId,field_patch:{label_markdown:phase==="leased"?"committed-before-disconnect":"MUST-NOT-COMMIT"}};
      const events=[],posts=[],statuses=[];
      const record=(event,details={})=>events.push({step:events.length+1,event,...details});
      let failedRefresh=false,injectRefresh=false;
      const revokePattern="**/patchboard-private/api/account/connected-apps/revoke";
      const listPattern="**/patchboard-private/api/account/connected-apps";
      const routeRevoke=async route=>{
        const intent=route.request().postDataJSON();posts.push(intent);
        assert.equal(intent.grant_id,grant.id);assert.equal(intent.client_id,g.clientId);
        assert.equal(intent.expected_version,1);
        if(posts.length>1)assert.deepEqual(intent,posts[0]);
        record("settings-post-started",{attempt:posts.length});
        const response=await route.fetch();
        const body=await response.json();statuses.push(response.status());
        if(response.status()===200){
          assert.equal(body.grant_id,grant.id);assert.equal(body.version,2);
          const state=probe(grant.id);
          assert.deepEqual(state,{version:2,revoked:true,leases:0,pending:false});
          // Read actual persisted entity before allowing Settings to receive 200.
          const observed=await readCanvas(owner,g.boardId,id);
          assert.equal(observed.version,phase==="leased"?8:7);
          assert.equal(observed.updatedBy,phase==="leased"?account.identity.accountId:initial.updatedBy);
          record("server-confirmed-before-ui",{http:200,noteVersion:observed.version,writer:observed.updatedBy,leases:0});
          if(phase==="leased")injectRefresh=true;
        }else{
          assert.equal(response.status(),503);
          assert.deepEqual(body,{error:"WRITE_DRAIN_PENDING",disconnected:false,retry_same_request:true});
          assert.equal(probe(grant.id).leases,1);
          assert.equal(probe(grant.id).revoked,false);
          record("server-pending",{http:503,disconnected:false});
        }
        await route.fulfill({response,json:body});
      };
      const routeList=route=>{
        if(injectRefresh){injectRefresh=false;failedRefresh=true;return route.fulfill({status:503,json:{error:"GRANTS_UNAVAILABLE"}});}
        return route.continue();
      };
      const operation=client.callTool({name:"patch_canvas_entity",arguments:input})
        .then(result=>({result}),error=>({error:String(error)}));
      try{
        await eventually(async()=>{try{await access(ready);return true;}catch{return false;}},"server pause "+phase);
        assert.equal(probe(grant.id).leases,phase==="leased"?1:0);
        assert.equal(probe(grant.id).revoked,false);
        record("callback-paused",{phase,leases:probe(grant.id).leases});
        await account.page.goto(origin+"/settings");
        await expect(row(account.page,g).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
        await account.page.route(revokePattern,routeRevoke);
        await account.page.route(listPattern,routeList);
        account.page.once("dialog",dialog=>dialog.accept());
        await row(account.page,g).getByRole("button",{name:"Disconnect",exact:true}).click();
        if(phase==="leased"){
          await eventually(()=>probe(grant.id).pending,"durable pending");
          assert.deepEqual(probe(grant.id),{version:1,revoked:false,leases:1,pending:true});
          assert.equal(statuses.length,0);
          assert.equal((await readCanvas(owner,g.boardId,id)).version,7);
          assert.equal(await fresh(g),401,"pending denies fresh requests");
          assert.equal((await call(B,"read_board",base)).board_id,boardB);
          record("pending-fence-observed",{noteVersion:7,leases:1,freshHttp:401,independentB:true});
          await expect(account.page.getByRole("status")).toContainText("waiting for an earlier write",{timeout:16000});
          await expect(row(account.page,g)).toContainText("Disconnect pending");
          await expect(row(account.page,g).getByRole("button",{name:"Retry disconnect",exact:true})).toBeEnabled();
          await account.page.screenshot({path:join(evidence,"lease-first-pending.png"),fullPage:true});
          await account.page.reload();
          const pending=(await grants(account.page)).find(x=>x.id===grant.id).pendingDisconnect;
          assert.deepEqual(pending,{requestId:posts[0].request_id,expectedVersion:posts[0].expected_version});
          await expect(row(account.page,g).getByRole("button",{name:"Retry disconnect",exact:true})).toBeEnabled();
          record("reload-recovered-original-intent");
          await row(account.page,g).getByRole("button",{name:"Retry disconnect",exact:true}).click();
          await eventually(()=>posts.length===2,"retry POST");
          assert.deepEqual(posts[0],posts[1]);
          record("resume-reserved-write");
          await writeFile(resume,"release",{mode:0o600});
          const {result,error}=await operation;
          assert.equal(error,undefined);assert.equal(result.isError,undefined);
          const committed=JSON.parse(result.content[0].text);
          assert.equal(committed.version,8);assert.equal(committed.previousVersion,7);
          assert.equal(committed.updatedBy,account.identity.accountId);
          assert.equal(committed.payload.label.markdown,input.field_patch.label_markdown);
          await expect(account.page.getByRole("status")).toContainText("grant revoked. Grant list temporarily unavailable",{timeout:16000});
          assert.equal(failedRefresh,true);
          record("ui-confirmed-despite-refresh-failure",{receiptId:committed.receiptId,eventId:committed.eventId});
          await account.page.screenshot({path:join(evidence,"lease-first-confirmed-refresh-failed.png"),fullPage:true});
          await account.page.getByRole("button",{name:"Refresh connected apps"}).click();
          await expect(row(account.page,g).getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled();
          assert.deepEqual(statuses,[503,200]);
        }else{
          await expect(row(account.page,g).getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled();
          assert.deepEqual(statuses,[200]);
          assert.deepEqual(await readCanvas(owner,g.boardId,id),initial);
          record("ui-confirmed-before-release");
          await account.page.screenshot({path:join(evidence,"disconnect-first-confirmed.png"),fullPage:true});
          await writeFile(resume,"release",{mode:0o600});
          const {result,error}=await operation;
          assert.equal(error,undefined);
          assert.equal(result.isError,true);
          assert.equal(result.content[0].text,"GRANT_ADMISSION_EXPIRED_OR_INVALID");
          assert.deepEqual(await readCanvas(owner,g.boardId,id),initial);
          record("resumed-callback-denied",{mcpIsError:true,error:result.content[0].text,noteVersion:7,writer:initial.updatedBy});
        }
        assert.equal(await fresh(g),401);
        record("fresh-request-denied",{http:401});
        const report={phase,entityId:id,boardId:g.boardId,requestId,grantId:grant.id,statuses,
          originalIntentReused:phase==="leased"?posts.length===2&&JSON.stringify(posts[0])===JSON.stringify(posts[1]):null,events};
        traces.push(report);
        return report;
      }finally{
        await writeFile(resume,"release",{mode:0o600}).catch(()=>{});
        await operation.catch(()=>{});
        await account.page.unroute(revokePattern,routeRevoke);
        await account.page.unroute(listPattern,routeList);
        await client.close();
      }
    }
    const leased=await order("leased",other,a,grantA,leasedId,initialA);
    const denied=await order("admitted",owner,c,grantC,deniedId,initialC);
    assert.equal((await call(B,"read_board",base)).board_id,boardB);
    // A separate browser write remains available after disconnecting two clients.
    const browserWrite=await api(owner.page,"canvas/create",{board_id:boardA,kind:"node",payload:payload(boardA,randomUUID(),1,"owner still writes")});
    assert.equal(browserWrite.status,201);
    for(const account of [owner,other]){
      const me=await api(account.page,"me");
      assert.equal(me.body.id,account.identity.id);assert.equal(me.body.accountId,account.identity.accountId);assert.equal(me.body.signedIn,true);
    }
    const finalB=(await grants(owner.page)).find(g=>g.id===grantB.id);
    assert.equal(finalB.revokedAtMs,null);assert.equal(finalB.grantVersion,1);
    await B.close();
    // Wait for exact identified process to exit before using the same Jazz
    // store offline; no concurrent Jazz writers.
    const pid=Number((await readFile(join(root,"qa-private-server.pid"),"utf8")).trim());
    assert.ok(Number.isInteger(pid)&&pid>1&&pid!==process.pid);
    process.kill(pid,"SIGTERM");
    await eventually(()=>{
      try{process.kill(pid,0);return false;}catch(error){if(error.code!=="ESRCH")throw error;return true;}
    },"old Jazz server exit");
    await backend.done;
    process.env.JAZZ_APP_DIR=join(patchboard,"packages","jazz-schema");
    const offline=await createJazz({app,permissions:privatePermissions,store:sqlite({path:join(root,"jazz")}),authenticate:()=>null}).ready();
    let audit;
    try{
      const db=offline.db;
      const receiptA=await db.all(app.canvasPatchReceipts.where({boardId:boardA}));
      const eventA=await db.all(app.canvasPatchEvents.where({boardId:boardA}));
      const receiptC=await db.all(app.canvasPatchReceipts.where({boardId:boardC}));
      const eventC=await db.all(app.canvasPatchEvents.where({boardId:boardC}));
      assert.equal(receiptA.length,1);assert.equal(eventA.length,1);
      assert.equal(receiptC.length,0);assert.equal(eventC.length,0);
      const written=await db.one(app.canvasEntities.where({id:leasedId}));
      const untouched=await db.one(app.canvasEntities.where({id:deniedId}));
      assert.equal(written.version,8);assert.equal(written.updatedBy,other.identity.accountId);
      assert.equal(untouched.version,7);assert.equal(untouched.updatedBy,initialC.updatedBy);
      assert.deepEqual(untouched.payload,initialC.payload);
      assert.equal(receiptA[0].id,eventA[0].receiptId);
      assert.equal(receiptA[0].eventId,eventA[0].id);
      assert.equal(receiptA[0].requestId,leased.requestId);
      assert.equal(receiptA[0].entityId,leasedId);assert.equal(eventA[0].entityId,leasedId);
      assert.equal(receiptA[0].actorId,other.identity.accountId);
      audit={leaseFirst:{version:8,writer:written.updatedBy,receiptId:receiptA[0].id,eventId:eventA[0].id,receipts:1,events:1},
        disconnectFirst:{version:7,writer:untouched.updatedBy,receipts:0,events:0}};
    }finally{await offline.close();}
    backend=launch("pnpm",["--filter","@patchboard/server","exec","tsx","src/private-demo.ts"],patchboard);
    await waitReady(backend,"http://127.0.0.1:"+backendPort+"/health");
    await Promise.all([owner.page.reload(),other.page.reload()]);
    await expect(row(other.page,a).getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled();
    await expect(row(owner.page,c).getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled();
    await expect(row(owner.page,b).getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled();
    const persisted=await readCanvas(owner,boardA,leasedId);
    assert.equal(persisted.version,8);assert.equal(persisted.updatedBy,other.identity.accountId);
    assert.equal(persisted.payload.label.markdown,"committed-before-disconnect");
    assert.deepEqual(await readCanvas(owner,boardC,deniedId),initialC);
    const restartedB=await make(b);
    try{assert.equal((await call(restartedB,"read_board",base)).board_id,boardB);}
    finally{await restartedB.close();}
    assert.equal(await fresh(a),401);assert.equal(await fresh(c),401);
    assert.deepEqual(probe(grantA.id),{version:2,revoked:true,leases:0,pending:false});
    assert.deepEqual(probe(grantC.id),{version:2,revoked:true,leases:0,pending:false});
    assert.deepEqual(probe(grantB.id),{version:1,revoked:false,leases:0,pending:false});
    await owner.page.screenshot({path:join(evidence,"owner-after-restart.png"),fullPage:true});
    const summary={browser:browser.version(),realOAuthClients:3,independentAccounts:2,coverage,traces,audit,
      ownerReadback:{id:persisted.id,version:persisted.version,updatedBy:persisted.updatedBy,label:persisted.payload.label.markdown},
      independentBUsableAfterRestart:true,ownerBrowserWriteRetained:true,independentSessionsPreserved:true};
    await writeFile(join(evidence,"result.json"),JSON.stringify(summary,null,2)+"\n",{mode:0o600});
    console.log("NATIVE_WRITE_DRAIN_PROOF_PASS",JSON.stringify({callbacks:coverage.length,leaseFirst:8,disconnectFirst:7,leaseFirstHttp:leased.statuses,disconnectFirstHttp:denied.statuses,receipts:1,events:1,ownerPostRestart:true}));
  }finally{await B.close().catch(()=>{});}
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
