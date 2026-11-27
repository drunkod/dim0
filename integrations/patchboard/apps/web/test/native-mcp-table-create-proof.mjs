/** Real OAuth PKCE, MCP SDK and native Data/Settings for one scoped QA catalog operation. */
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {access} from "node:fs/promises";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {chromium,expect} from "@playwright/test";

const patchboard=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const webui=resolve(patchboard,"../../webui");
const root=await mkdtemp(join(tmpdir(),"patchboard-private-ci-mcp-catalog-"));
const evidence=process.env.DIM0_NATIVE_MCP_CATALOG_EVIDENCE ? resolve(process.env.DIM0_NATIVE_MCP_CATALOG_EVIDENCE) : await mkdtemp(join(tmpdir(),"dim0-mcp-catalog-evidence-"));
await mkdir(evidence,{recursive:true,mode:0o700});
const freePort=()=>new Promise((yes,no)=>{
  const s=createServer().once("error",no);
  s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>yes(port));});
});
const uiPort=await freePort();let backendPort=await freePort();while(uiPort===backendPort)backendPort=await freePort();
const origin="http://localhost:"+uiPort;
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(k)));
Object.assign(env,{CI:"1",PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_DEV:"1",PATCHBOARD_PRIVATE_ORIGIN:origin,
  PATCHBOARD_PRIVATE_PORT:String(backendPort),PATCHBOARD_OAUTH_CI_RESTART:"1",PATCHBOARD_QA_TYPED_RECORD:"1",PATCHBOARD_ACC051_INFLIGHT_QA:"1",
  PATCHBOARD_PRIVATE_DIM0_ONLY:"1",VITE_DIM0_JAZZ_CANVAS:"1",VITE_DIM0_QA_NATIVE_SAVED_VIEW:"1",APP_PORT:String(uiPort)});
const jobs=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function launch(command,args,cwd,extra={}){
  const child=spawn(command,args,{cwd,env:{...env,...extra},detached:true,stdio:["ignore","pipe","pipe"]});
  child.stdout.resume();child.stderr.resume();
  const done=new Promise((yes,no)=>{child.once("error",no);child.once("exit",yes);});
  const job={child,done};jobs.push(job);return job;
}
async function execute(command,args,cwd,extra={}){assert.equal(await launch(command,args,cwd,extra).done,0,"QA build/migration failed");}
async function stop(job){
  if(!job||job.child.exitCode!==null||job.child.signalCode!==null)return;
  try{process.kill(-job.child.pid,"SIGTERM");}catch{}
  await Promise.race([job.done,sleep(3000)]);
  if(job.child.exitCode===null&&job.child.signalCode===null){try{process.kill(-job.child.pid,"SIGKILL");}catch{}await job.done;}
}
async function ready(job,url){
  for(let i=0;i<160;i++){
    assert.equal(job.child.exitCode,null,"QA service exited");
    try{if((await fetch(url,{signal:AbortSignal.timeout(1000)})).ok)return;}catch{}
    await sleep(250);
  }throw Error("QA service not ready");
}
let backend,frontend,browser,backendMode="1";
const vite=join(webui,"node_modules/.bin/vite");
const options={timeout:30000};
async function startBackend(enabled=backendMode){
  backendMode=enabled;
  backend=launch("pnpm",["--filter","@patchboard/server","exec","tsx","src/private-demo.ts"],patchboard,{PATCHBOARD_QA_TYPED_RECORD:enabled});
  await ready(backend,"http://127.0.0.1:"+backendPort+"/health");
}
async function startFrontend(enabled="1"){
  const buildDir=join(root,"native-"+enabled);
  await execute(vite,["build","--outDir",buildDir],webui,{VITE_DIM0_QA_NATIVE_SAVED_VIEW:enabled});
  frontend=launch(vite,["preview","--outDir",buildDir,"--host","127.0.0.1","--port",String(uiPort),"--strictPort"],webui);
  await ready(frontend,origin+"/signup");
}
const api=(page,path,data)=>page.evaluate(async({path,data})=>{
  const r=await fetch("/patchboard-private/api/"+path,{credentials:"same-origin",cache:"no-store",
    ...(data===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})});
  return {status:r.status,body:await r.json()};
},{path,data});
async function account(){
  const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:"block",permissions:["clipboard-read","clipboard-write"]});
  await context.route("**/*",route=>{
    const u=new URL(route.request().url());
    return u.origin===origin||["data:","blob:"].includes(u.protocol)?route.continue():route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  const cdp=await context.newCDPSession(page);await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto(origin+"/signup");
  await page.getByRole("button",{name:"Create account with passkey",exact:true}).click();
  await expect(page).toHaveURL(origin+"/boards",options);
  const identity=(await api(page,"me")).body;assert.ok(identity.signedIn);
  return {context,page,identity};
}
async function offline(action){
  await stop(backend);
  process.env.JAZZ_APP_DIR=join(patchboard,"packages/jazz-schema");
  const jazz=await createJazz({app,permissions,store:sqlite({path:join(root,"jazz")}),authenticate:()=>null}).ready();
  try{await action(jazz.db);}finally{await jazz.close();}
  await startBackend();
}
const save=(name,data)=>writeFile(join(evidence,name+".json"),JSON.stringify(data,null,2),{mode:0o600});
const grid=page=>page.getByRole("table",{name:"Saved view records"});
const names=["typedDatasets","typedFields","typedViews","typedRecords","typedCatalogReceipts","typedCatalogEvents","typedPatchReceipts","typedPatchEvents"];
const zero=Object.fromEntries(names.map(n=>[n,0]));
const one={...zero,typedDatasets:1,typedFields:1,typedViews:1,typedCatalogReceipts:1,typedCatalogEvents:1};
const counts=s=>Object.fromEntries(names.map(n=>[n,s[n].length]));
async function snapshot(board){
  let rows;
  await offline(async db=>{rows=Object.fromEntries(await Promise.all(names.map(async n=>[n,(await db.all(app[n].where({boardId:board}))).sort((a,b)=>a.id.localeCompare(b.id))])));});
  return rows;
}
const mcpURL=origin+"/patchboard-private-mcp",callback="http://127.0.0.1:7432/callback";
const args=(board,requestId=randomUUID(),name="Rehearsal")=>({operation:"dataset.create.v1",input:{
  board_id:board,request_id:requestId,name,primary_field_name:"Title",default_view_name:"All rows"}});
const clientList=[];
async function authorize(account,board,scope,label){
  const meta=await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth");
  assert.equal(meta.status,200);const metadata=await meta.json();
  for(const key of ["registration_endpoint","authorization_endpoint","token_endpoint"])assert.equal(new URL(metadata[key]).origin,origin);
  const reg=await fetch(metadata.registration_endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
    client_name:label,application_type:"native",redirect_uris:[callback],token_endpoint_auth_method:"none",
    grant_types:["authorization_code"],response_types:["code"],scope
  })});
  assert.equal(reg.status,201);const {client_id}=await reg.json();
  const verifier=randomBytes(32).toString("base64url"),state=randomUUID();
  const auth=new URL(metadata.authorization_endpoint);
  for(const [k,v] of Object.entries({client_id,response_type:"code",redirect_uri:callback,code_challenge:createHash("sha256").update(verifier).digest("base64url"),code_challenge_method:"S256",state,scope,resource:mcpURL}))auth.searchParams.set(k,v);
  const page=account.page;
  await page.route(callback+"**",route=>route.fulfill({status:200,body:"Local callback"}));
  await page.goto(auth.href,{waitUntil:"domcontentloaded"});
  await expect(page).toHaveURL(url=>url.origin===origin&&url.searchParams.get("client_id")===client_id&&["/signin","/patchboard-private/oauth-consent"].includes(url.pathname));
  if(new URL(page.url()).pathname==="/signin")await page.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await expect(page.getByRole("heading",{name:"Authorize a SashAI connection",exact:true})).toBeVisible(options);
  if(scope.includes("table:create"))await expect(page.getByText("table:create",{exact:true})).toBeVisible(options);
  await page.getByLabel("Approved board").selectOption(board);
  await page.getByRole("button",{name:"Authorize selected board"}).click();
  await page.waitForURL(url=>url.origin==="http://127.0.0.1:7432"&&url.searchParams.get("state")===state,{timeout:15000});
  const code=new URL(page.url()).searchParams.get("code");assert.ok(code);
  const token=await fetch(metadata.token_endpoint,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:new URLSearchParams({grant_type:"authorization_code",code,client_id,redirect_uri:callback,code_verifier:verifier,resource:mcpURL})});
  assert.equal(token.status,200);const {access_token}=await token.json();assert.ok(access_token);
  await page.goto(origin+"/settings");
  const grant=(await api(page,"account/connected-apps")).body.grants.find(g=>g.clientId===client_id&&g.boardId===board);
  assert.ok(grant);assert.equal(grant.grantVersion,1);
  const sql=new DatabaseSync(join(root,"auth","better-auth.sqlite"),{readOnly:true});
  try{
    const rows=sql.prepare("SELECT scopes FROM oauthConsent WHERE userId=? AND clientId=? AND referenceId=?").all(account.identity.id,client_id,grant.id);
    assert.equal(rows.length,1);
    assert.deepEqual(JSON.parse(rows[0].scopes).sort(),scope.split(" ").sort());
  }finally{sql.close();}
  return {token:access_token,board,clientId:client_id,grant};
}
async function connect(g){
  const c=new Client({name:"native-mcp-catalog-proof",version:"1"});
  clientList.push(c);
  await c.connect(new StreamableHTTPClientTransport(new URL(mcpURL),{requestInit:{headers:{Authorization:"Bearer "+g.token}}}));
  return c;
}
const listed=async c=>(await c.listTools()).tools.some(t=>t.name==="call-api-write");
const invoke=(c,input)=>c.callTool({name:"call-api-write",arguments:input}).catch(()=>({rejected:true}));
function success(reply){assert.equal(reply.rejected,undefined);assert.equal(reply.isError,undefined);return JSON.parse(reply.content[0].text);}
function denied(reply,code){assert.ok(reply.isError||reply.rejected);if(code){assert.equal(reply.isError,true);assert.equal(reply.content[0].text,code);}}
const views=async(page,board)=>(await api(page,"records/views?board_id="+board));
async function nativeRead(page,board,created){
  await page.goto(origin+"/boards/"+board);
  await page.getByRole("button",{name:"Open board Data"}).click();
  const data=page.getByRole("region",{name:"Board Data"});
  await expect(data.getByRole("heading",{name:"Rehearsal",exact:true})).toBeVisible(options);
  await data.getByRole("button",{name:"Open saved view All rows",exact:true}).click();
  const t=grid(page);await expect(t).toBeVisible(options);
  await expect(t).toHaveAttribute("data-dataset-id",created.datasetId);
  await expect(t).toHaveAttribute("data-view-id",created.defaultViewId);
  await expect(t.getByRole("columnheader",{name:"Title",exact:true})).toHaveAttribute("data-field-id",created.fieldId);
  await expect(data.getByText("0 matching records",{exact:true})).toBeVisible(options);
  const v=await views(page,board);assert.equal(v.status,200);assert.equal(v.body.views.length,1);
  assert.deepEqual({datasetId:v.body.views[0].datasetId,fieldId:v.body.views[0].fields[0].id,defaultViewId:v.body.views[0].viewId},
    {datasetId:created.datasetId,fieldId:created.fieldId,defaultViewId:created.defaultViewId});
  return {datasetId:await t.getAttribute("data-dataset-id"),defaultViewId:await t.getAttribute("data-view-id"),fieldId:await t.getByRole("columnheader").getAttribute("data-field-id")};
}
const probe=id=>{
  const sql=new DatabaseSync(join(root,"auth","better-auth.sqlite"),{readOnly:true});
  try{
    const g=sql.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?").get(id);
    const leases=sql.prepare("SELECT id,tool_name,operation_identity,verified_subject_id,verified_board_id FROM patchboard_mcp_write_lease WHERE grant_id=?").all(id);
    return {version:g.grant_version,revoked:g.revoked_at_ms!==null,leases,pending:!!sql.prepare("SELECT 1 FROM patchboard_grant_disconnect_pending WHERE grant_id=?").get(id)};
  }finally{sql.close();}
};
async function eventually(check,label){
  const end=Date.now()+30000;while(Date.now()<end){if(await check())return;await sleep(25);}
  throw Error("Timed out: "+label);
}
async function fresh(g,operation=args(g.board)){
  const r=await fetch(mcpURL,{method:"POST",headers:{Authorization:"Bearer "+g.token,"content-type":"application/json",Accept:"application/json, text/event-stream"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"call-api-write",arguments:operation}})});
  await r.body?.cancel();return r.status;
}
let stage="startup";
try{
  await execute("pnpm",["auth:migrate:private"],patchboard);
  await startBackend();await startFrontend();browser=await chromium.launch({headless:true});
  const owner=await account(),viewer=await account(),op=owner.page,vp=viewer.page;
  const makeBoard=async title=>{const r=await api(op,"boards",{title});assert.equal(r.status,201);return r.body.board_id;};
  const A=await makeBoard("MCP primary table"),B=await makeBoard("Reservation wins"),C=await makeBoard("Disconnect wins");
  const initial=counts(await snapshot(A));assert.deepEqual(initial,zero);
  const scopes="board:read board:write table:create";
  stage="old grant denied";
  const old=await authorize(owner,A,"board:read board:write","Old grant");
  const oldClient=await connect(old);assert.equal(await listed(oldClient),false);
  denied(await invoke(oldClient,args(A)));assert.deepEqual(counts(await snapshot(A)),zero);
  stage="missing board write";
  const readOnly=await authorize(owner,A,"board:read table:create","Missing board write");
  const readClient=await connect(readOnly);assert.equal(await listed(readClient),false);
  denied(await invoke(readClient,args(A)));assert.deepEqual(counts(await snapshot(A)),zero);
  stage="sibling board";
  const sibling=await authorize(owner,B,scopes,"Scoped B");
  const siblingClient=await connect(sibling);assert.equal(await listed(siblingClient),true);
  denied(await invoke(siblingClient,args(A)),"BOARD_ACCESS_DENIED");
  assert.deepEqual(counts(await snapshot(A)),zero);assert.deepEqual(counts(await snapshot(B)),zero);
  stage="viewer";
  const invite=await api(op,"invite",{board_id:A,role:"viewer"});assert.equal(invite.status,201);
  const joined=await api(vp,"join",{board_id:A,token:new URL(invite.body.invite_url).searchParams.get("invite")});assert.equal(joined.status,200);
  const v=await authorize(viewer,A,scopes,"Viewer");
  const viewerClient=await connect(v);assert.equal(await listed(viewerClient),false);
  denied(await invoke(viewerClient,args(A)));assert.deepEqual(counts(await snapshot(A)),zero);
  console.log("MCP_CATALOG_DENIALS_PASS");
  stage="owner SDK creation, retry, conflict";
  const main=await authorize(owner,A,scopes,"Scoped A Owner");
  const client=await connect(main);
  const desc=(await client.listTools()).tools.find(t=>t.name==="call-api-write");assert.ok(desc);assert.match(desc.description,/dataset.create.v1/);
  const command=args(A,"catalog-rehearsal-"+randomUUID());
  const created=success(await invoke(client,command));assert.equal(created.operation,"dataset.create.v1");assert.equal(created.replayed,false);
  const replay=success(await invoke(client,command));assert.deepEqual(replay,{...created,replayed:true});
  denied(await invoke(client,args(A,command.input.request_id,"Different definition")),"CATALOG_REQUEST_ID_CONFLICT");
  denied(await invoke(client,{operation:"other.create.v1",input:command.input}));
  denied(await invoke(client,{...command,input:{...command.input,actor_id:owner.identity.accountId}}));
  assert.equal(probe(main.grant.id).leases.length,0);
  const before=await snapshot(A);assert.deepEqual(counts(before),one);
  const r=before.typedCatalogReceipts[0],e=before.typedCatalogEvents[0];
  assert.equal(r.id,created.receiptId);assert.equal(e.id,created.eventId);assert.equal(e.receiptId,r.id);
  assert.equal(r.actorId,owner.identity.accountId);
  assert.equal(r.datasetId,created.datasetId);assert.equal(r.fieldId,created.fieldId);assert.equal(r.viewId,created.defaultViewId);
  const native=await nativeRead(op,A,created);
  await op.screenshot({animations:"disabled",path:join(evidence,"owner-mcp-created-grid.png")});
  console.log("MCP_CATALOG_SDK_NATIVE_PASS",JSON.stringify({created,replay,native,counts:counts(before)}));

  stage="native Settings drain";
  const disconnectFirst=await authorize(owner,C,scopes,"Scoped C");
  const disconnectClient=await connect(disconnectFirst);assert.equal(await listed(disconnectClient),true);
  const auditPage=await owner.context.newPage();await auditPage.goto(origin+"/boards/"+A);
  async function race(phase,g,c){
    const rid="qa_inflight_"+phase+"_"+randomUUID().replaceAll("-","");
    const operation=args(g.board,rid,phase==="leased"?"Leased catalog":"MUST NOT CREATE");
    const path=join(root,"acc051-write-pauses",phase+"-"+rid);
    const readyPath=path+".ready",resume=path+".resume";
    const events=[],statuses=[],posts=[];
    const record=(event,data={})=>events.push({step:events.length+1,event,...data});
    const call=invoke(c,operation);
    let identity;
    const settingsRow=()=>op.getByRole("listitem").filter({hasText:"Client "+g.clientId});
    const routePattern="**/patchboard-private/api/account/connected-apps/revoke";
    const handler=async route=>{
      const intent=route.request().postDataJSON();posts.push(intent);
      assert.equal(intent.grant_id,g.grant.id);assert.equal(intent.client_id,g.clientId);assert.equal(intent.expected_version,1);
      if(posts.length>1)assert.deepEqual(posts[0],intent);
      record("settings-post",{attempt:posts.length});
      const response=await route.fetch(),body=await response.json();statuses.push(response.status());
      if(response.status()===200){
        const p=probe(g.grant.id);assert.equal(p.version,2);assert.equal(p.revoked,true);assert.equal(p.leases.length,0);assert.equal(p.pending,false);
        const result=await views(auditPage,g.board);assert.equal(result.status,200);
        assert.equal(result.body.views.length,phase==="leased"?1:0);
        record("server-confirmed-before-ui",{http:200,views:result.body.views.length,leases:0});
      }else{
        assert.equal(response.status(),503);
        assert.deepEqual(body,{error:"WRITE_DRAIN_PENDING",disconnected:false,retry_same_request:true});
        record("pending-response",{http:503,leases:probe(g.grant.id).leases.length});
      }
      await route.fulfill({response,json:body});
    };
    try{
      await eventually(async()=>{try{await access(readyPath);return true;}catch{return false;}},"callback pause");
      const paused=probe(g.grant.id);
      assert.equal(paused.leases.length,phase==="leased"?1:0);
      assert.equal(paused.revoked,false);
      if(phase==="leased"){
        const lease=paused.leases[0];assert.equal(lease.tool_name,"call-api-write");identity=JSON.parse(lease.operation_identity);
        assert.equal(identity.action,"dataset.create.v1");assert.equal(identity.requestId,rid);assert.equal(identity.boardId,g.board);
        assert.equal(identity.actorId,owner.identity.accountId);assert.equal(lease.verified_subject_id,owner.identity.id);
        assert.equal(lease.verified_board_id,g.board);
      }
      record("callback-paused",{phase,leases:paused.leases.length});
      await op.goto(origin+"/settings");await op.route(routePattern,handler);
      await expect(settingsRow().getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled(options);
      op.once("dialog",dialog=>dialog.accept());
      await settingsRow().getByRole("button",{name:"Disconnect",exact:true}).click();
      if(phase==="leased"){
        await eventually(()=>probe(g.grant.id).pending,"pending fence");
        assert.equal(probe(g.grant.id).revoked,false);
        assert.equal(probe(g.grant.id).leases.length,1);
        assert.equal((await views(auditPage,g.board)).body.views.length,0);
        assert.equal(await fresh(g),401);
        record("pending-fence",{views:0,leases:1,freshHttp:401});
        await expect(settingsRow()).toContainText("Disconnect pending",options);
        await expect(settingsRow().getByRole("button",{name:"Retry disconnect",exact:true})).toBeEnabled(options);
        await op.reload();
        const persisted=(await api(op,"account/connected-apps")).body.grants.find(x=>x.id===g.grant.id).pendingDisconnect;
        assert.deepEqual(persisted,{requestId:posts[0].request_id,expectedVersion:1});
        await settingsRow().getByRole("button",{name:"Retry disconnect",exact:true}).click();
        await eventually(()=>posts.length===2,"same intent retry");
        await writeFile(resume,"resume",{mode:0o600});record("resume-reserved-write");
        const result=success(await call);assert.equal(result.receiptId,identity.receiptId);assert.equal(result.eventId,identity.eventId);
        await expect(settingsRow().getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled(options);
        assert.deepEqual(statuses,[503,200]);
        assert.equal(await fresh(g),401);
        record("ui-confirmed",{receiptId:result.receiptId,eventId:result.eventId,freshHttp:401});
        return {phase,board:g.board,statuses,events,identity,result,originalIntentReused:true};
      }
      await expect(settingsRow().getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled(options);
      assert.deepEqual(statuses,[200]);record("ui-confirmed-before-resume");
      await writeFile(resume,"resume",{mode:0o600});
      denied(await call,"GRANT_ADMISSION_EXPIRED_OR_INVALID");
      assert.equal((await views(auditPage,g.board)).body.views.length,0);assert.equal(await fresh(g),401);
      record("resumed-callback-denied",{views:0,mcpError:"GRANT_ADMISSION_EXPIRED_OR_INVALID",freshHttp:401});
      return {phase,board:g.board,statuses,events};
    }finally{
      await writeFile(resume,"resume",{mode:0o600}).catch(()=>{});await call.catch(()=>{});await op.unroute(routePattern,handler);
    }
  }
  const leased=await race("leased",sibling,siblingClient);
  const disconnected=await race("admitted",disconnectFirst,disconnectClient);
  const BRows=await snapshot(B),CRows=await snapshot(C);
  assert.deepEqual(counts(BRows),one);assert.deepEqual(counts(CRows),zero);
  const br=BRows.typedCatalogReceipts[0],be=BRows.typedCatalogEvents[0],identity=leased.identity;
  for(const key of ["boardId","actorId","requestId","fingerprint","datasetId","fieldId","viewId"])assert.equal(br[key],identity[key]);
  assert.equal(br.id,identity.receiptId);assert.equal(be.id,identity.eventId);assert.equal(be.receiptId,br.id);
  const reopened=await snapshot(A);assert.deepEqual(reopened,before);
  const again=success(await invoke(client,command));assert.deepEqual(again,replay);
  const nativeAfterRestart=await nativeRead(op,A,created);assert.deepEqual(nativeAfterRestart,native);
  const independent=success(await oldClient.callTool({name:"read_board",arguments:{board_id:A}}));assert.equal(independent.board_id,A);
  console.log("MCP_CATALOG_NATIVE_DRAIN_PASS",JSON.stringify({leased,disconnected,nativeAfterRestart,counts:counts(reopened)}));

  stage="feature off cached invocation";
  await stop(backend);await startBackend("0");
  const offMetadata=await (await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth")).json();
  assert.ok(!offMetadata.scopes_supported?.includes("table:create"));
  const offListed=await listed(client);assert.equal(offListed,false);
  const offReply=await invoke(client,args(A));denied(offReply);
  // Keep the bounded protocol outcome in the trace, never raw token or URL.
  const offOutcome=offReply.isError?"MCP isError":"SDK rejected";
  console.log("MCP_CATALOG_FEATURE_OFF_PASS",JSON.stringify({toolListed:offListed,outcome:offOutcome}));
  assert.deepEqual(counts(await snapshot(A)),one);
  const ordinary=await oldClient.listTools();assert.ok(ordinary.tools.some(t=>t.name==="read_board"));assert.ok(!ordinary.tools.some(t=>t.name==="call-api-write"));
  await save("mcp-native-catalog-trace",{initial,created,replay,native,nativeAfterRestart,postRestart:counts(reopened),
    oldBoardWriteDenied:true,missingBoardWriteDenied:true,viewerDenied:true,siblingDenied:true,allZeroBeforeOwner:true,
    conflictMcpCode:"CATALOG_REQUEST_ID_CONFLICT",leasesSettled:true,leased,disconnected,
    leaseFirstCounts:counts(BRows),disconnectFirstCounts:counts(CRows),leaseReceiptIdentityMatched:true,
    independentClientUsable:true,featureOffCachedDenied:true,featureOffOutcome:offOutcome,featureOffDiscoveryAbsent:true,featureOffCounts:one});
  console.log("NATIVE_MCP_CATALOG_ACCEPTANCE_PASS");
}catch(error){
  console.error("NATIVE_MCP_CATALOG_FAILURE",stage,error?.name??"Error",String(error?.message??"").split("\n")[0].replace(/https?:\/\/[^\s]+/g,"[URL]").replace(/[A-Za-z0-9_-]{43,}/g,"[REDACTED]"));process.exitCode=1;
}finally{
  for(const client of clientList)await client.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  for(const job of jobs)await stop(job);
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
