/** Real OAuth PKCE, MCP SDK and native Data/Settings for one scoped QA catalog operation. */
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {readFile,stat} from "node:fs/promises";
import {execFileSync,spawnSync} from "node:child_process";
import {createServer as createHttpsServer} from "node:https";
import {request as httpRequest} from "node:http";
import {getCACertificates,setDefaultCACertificates} from "node:tls";
import {Client} from "@modelcontextprotocol/sdk/client/index.js";
import {StreamableHTTPClientTransport,StreamableHTTPError} from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
const root=await mkdtemp(join(tmpdir(),"dim0-plugin-https-qa-"));
const evidence=process.env.DIM0_HTTPS_CATALOG_EVIDENCE ? resolve(process.env.DIM0_HTTPS_CATALOG_EVIDENCE) : await mkdtemp(join(tmpdir(),"dim0-https-catalog-evidence-"));
await mkdir(evidence,{recursive:true,mode:0o700});
const freePort=()=>new Promise((yes,no)=>{
  const s=createServer().once("error",no);
  s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>yes(port));});
});
const uiPort=await freePort();let backendPort=await freePort();while(uiPort===backendPort)backendPort=await freePort();
let tlsPort=await freePort();while([uiPort,backendPort].includes(tlsPort))tlsPort=await freePort();
const hostname="dim0-catalog.localhost",origin="https://"+hostname+":"+tlsPort;
const host=new URL(origin).host,cert=join(root,"fixture-cert.pem"),key=join(root,"fixture-key.pem");
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+hostname,
  "-addext","subjectAltName=DNS:"+hostname,"-keyout",key,"-out",cert],{stdio:"ignore"});
// Trust only this fixture certificate in this process and its children.
// Never disable TLS certificate verification for Node.
setDefaultCACertificates([...getCACertificates("default"),await readFile(cert,"utf8")]);
const tls=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
  if(req.headers.host!==host){res.writeHead(421);res.end();return;}
  const upstream=httpRequest({hostname:"127.0.0.1",port:uiPort,path:req.url,method:req.method,headers:req.headers},r=>{
    res.writeHead(r.statusCode,r.headers);r.pipe(res);
  });
  upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  res.once("close",()=>upstream.destroy());req.pipe(upstream);
});
await new Promise((yes,no)=>tls.once("error",no).listen(tlsPort,"127.0.0.1",yes));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(k)));
Object.assign(env,{CI:"1",PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_DEV:"1",PATCHBOARD_PRIVATE_ORIGIN:origin,
  PATCHBOARD_PRIVATE_PORT:String(backendPort),PATCHBOARD_OAUTH_CI_RESTART:"1",PATCHBOARD_QA_TYPED_RECORD:"0",PATCHBOARD_QA_HTTPS_TEXT_TABLE:"0",PATCHBOARD_ACC051_INFLIGHT_QA:"0",
  PATCHBOARD_PRIVATE_DIM0_ONLY:"1",VITE_DIM0_JAZZ_CANVAS:"1",VITE_DIM0_QA_NATIVE_SAVED_VIEW:"0",VITE_DIM0_QA_NATIVE_CATALOG_READONLY:"1",DIM0_JAZZ_PUBLIC_HOST:hostname,APP_PORT:String(uiPort),NODE_EXTRA_CA_CERTS:cert});
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
let backend,frontend,browser,backendMode="0";
const vite=join(webui,"node_modules/.bin/vite");
const options={timeout:30000};
function rawBackend(path,requestHost){
  return new Promise((yes,no)=>{
    const req=httpRequest({hostname:"127.0.0.1",port:backendPort,path,headers:{Host:requestHost}},res=>{
      res.resume();res.on("end",()=>yes({status:res.statusCode,headers:res.headers}));
    });req.on("error",no);req.setTimeout(2000,()=>req.destroy(Error("Timeout")));req.end();
  });
}
async function startBackend(enabled=backendMode){
  backendMode=enabled;
  backend=launch("pnpm",["--filter","@patchboard/server","exec","tsx","src/private-demo.ts"],patchboard,{PATCHBOARD_QA_HTTPS_TEXT_TABLE:enabled});
  for(let i=0;i<160;i++){
    assert.equal(backend.child.exitCode,null,"QA backend exited");
    try{if((await rawBackend("/health",host)).status===200)return;}catch{}
    await sleep(250);
  }throw Error("Backend readiness failed");
}
async function startFrontend(){
  const buildDir=join(root,"native-read-only");
  await execute(vite,["build","--outDir",buildDir],webui,{});
  frontend=launch(vite,["preview","--outDir",buildDir,"--host","127.0.0.1","--port",String(uiPort),"--strictPort"],webui,{PATCHBOARD_QA_HTTPS_TEXT_TABLE:"1"});
  await ready(frontend,origin+"/signup");
  await ready(frontend,origin+"/patchboard-private/api/me");
  assert.deepEqual(await (await fetch(origin+"/patchboard-private/api/me")).json(),{signedIn:false});
  return buildDir;
}
const api=(page,path,data)=>page.evaluate(async({path,data})=>{
  const r=await fetch("/patchboard-private/api/"+path,{credentials:"same-origin",cache:"no-store",
    ...(data===undefined?{}:{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)})});
  return {status:r.status,body:await r.json()};
},{path,data});
async function account(){
  const context=await browser.newContext({viewport:{width:1440,height:900},ignoreHTTPSErrors:true,serviceWorkers:"block",permissions:["clipboard-read","clipboard-write"]});
  await context.route("**/*",route=>{
    const u=new URL(route.request().url());
    return u.origin===origin||["data:","blob:"].includes(u.protocol)?route.continue():route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(30000);
  page.on("pageerror",error=>console.error("LOCAL_BROWSER_ERROR",error.name,String(error.message).slice(0,150)));
  page.on("response",r=>{const u=new URL(r.url());if(u.origin===origin && r.status()>=400)console.log("LOCAL_BROWSER_HTTP",r.status(),u.pathname);});
  const cdp=await context.newCDPSession(page);await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,isUserVerified:true,automaticPresenceSimulation:true}});
  await page.goto(origin+"/signup");
  try{
    await page.getByRole("button",{name:"Create account with passkey",exact:true}).click({timeout:15000});
  }catch(error){
    await page.screenshot({path:join(evidence,"initial-signup-debug.png")});
    console.error("LOCAL_SIGNUP_DEBUG",JSON.stringify({path:new URL(page.url()).pathname,body:(await page.locator("body").innerText()).slice(0,400)}));
    throw error;
  }
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
async function snapshot(board,page){
  if(page)await page.goto("about:blank");
  let rows;
  await offline(async db=>{rows=Object.fromEntries(await Promise.all(names.map(async n=>[n,(await db.all(app[n].where({boardId:board}))).sort((a,b)=>a.id.localeCompare(b.id))])));});
  return rows;
}
const mcpURL=origin+"/patchboard-private-mcp",callback="http://127.0.0.1:7432/callback";
const args=(board,requestId=randomUUID(),name="Plugin rehearsal")=>({operation:"dataset.create.v1",input:{
  board_id:board,request_id:requestId,name,primary_field_name:"Title",default_view_name:"All rows"}});
const clientList=[];
async function authorize(account,board,scope,label,wrongBoard){
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
  await expect(page.getByRole("heading",{name:"Authorize a Dim0 connection",exact:true})).toBeVisible(options);
  if(scope.includes("table:create"))await expect(page.getByText("table:create",{exact:true})).toBeVisible(options);
  const optionsShown=await page.getByLabel("Approved board").locator("option").evaluateAll(elements=>elements.map(e=>e.value).filter(Boolean));
  assert.deepEqual(optionsShown,[board],"only approved board available in sealed profile");
  if(wrongBoard){
    const forged=await page.evaluate(async board_id=>{
      const r=await fetch("/patchboard-auth/oauth2/consent",{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},
        body:JSON.stringify({accept:true,oauth_query:location.search.slice(1),board_id})});return r.status;
    },wrongBoard);
    assert.equal(forged,403);
  }
  if(scope.includes("table:create"))await page.screenshot({path:join(evidence,"sdk-consent.png")});
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
  assert.equal(await data.getByRole("button",{name:"Create table",exact:true}).count(),0);
  assert.equal(await data.getByRole("button",{name:"Add row",exact:true}).count(),0);
  await expect(data.getByRole("heading",{name:"Plugin rehearsal",exact:true})).toBeVisible(options);
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

let stage="startup";
try {
  // Enrollment is local, on a fresh HTTPS fixture; no catalog gate yet.
  await execute("pnpm",["auth:migrate:private"],patchboard);
  await startBackend();const buildDir=await startFrontend();
  const pageResponse=await fetch(origin+"/signin");assert.equal(pageResponse.status,200);
  const html=await pageResponse.text();assert.match(html,/<title>Dim0<\/title>/);
  const asset=html.match(/<script type="module"[^>]+src="(\/assets\/[^"]+)"/)?.[1];assert.ok(asset);
  const built=await readFile(join(buildDir,asset));
  assert.deepEqual(Buffer.from(await (await fetch(origin+asset)).arrayBuffer()),built);
  const assetSha256=createHash("sha256").update(built).digest("hex");
  browser=await chromium.launch({headless:true});
  stage="native signup";
  const owner=await account(),page=owner.page;
  stage="create disposable board";
  const createBoard=async title=>{const r=await api(page,"boards",{title});assert.equal(r.status,201);return r.body.board_id;};
  const board=await createBoard("Isolated catalog QA"),sibling=await createBoard("Excluded board");
  assert.equal((await api(page,"canvas?board_id="+board)).body.role,"owner");
  await page.goto(origin+"/boards");
  await stop(backend);
  const proof={format:"dim0-plugin-https-qa/v1",origin,boardId:board,nonce:randomBytes(32).toString("hex"),createdAtMs:Math.round((await stat(root)).birthtimeMs)};
  const proofPath=join(root,".qa-catalog-profile.json");
  await writeFile(proofPath,JSON.stringify(proof),{mode:0o600,flag:"wx"});
  Object.assign(env,{PATCHBOARD_QA_HTTPS_TEXT_TABLE:"1",PATCHBOARD_QA_HTTPS_ORIGIN:origin,PATCHBOARD_QA_HTTPS_BOARD_ID:board,PATCHBOARD_QA_HTTPS_BOOT_NONCE:proof.nonce});
  stage="sealed profile validation";
  const serverDir=join(patchboard,"apps/server");
  const probe=(overrides={})=>spawnSync(process.execPath,["--import","tsx","--input-type=module","-e",`
    import {qaHttpsCatalogProfile,qaHttpsCatalogBoardAllowed} from "./src/qa-https-catalog-profile.ts";
    const p=qaHttpsCatalogProfile();console.log(JSON.stringify({enabled:!!p,board:p?.boardId,allowed:qaHttpsCatalogBoardAllowed(process.env.PATCHBOARD_QA_HTTPS_BOARD_ID)}));
  `],{cwd:serverDir,env:{...env,...overrides},encoding:"utf8",timeout:15000});
  const valid=probe();assert.equal(valid.status,0);assert.deepEqual(JSON.parse(valid.stdout),{enabled:true,board,allowed:true});
  for(const overrides of [{PATCHBOARD_QA_HTTPS_ORIGIN:"https://wrong.invalid"},{PATCHBOARD_QA_HTTPS_BOARD_ID:sibling},
    {PATCHBOARD_QA_HTTPS_BOOT_NONCE:"0".repeat(64)},{PATCHBOARD_QA_TYPED_RECORD:"1"},
    {PATCHBOARD_PRIVATE_ROOT:tmpdir()},{PATCHBOARD_PRIVATE_DIM0_ONLY:"0"},{PATCHBOARD_ACC051_INFLIGHT_QA:"1"}]){
    const denied=probe(overrides);assert.notEqual(denied.status,0);assert.match(denied.stderr,/INVALID_ISOLATED_HTTPS_QA_PROFILE/);
  }
  await writeFile(proofPath,JSON.stringify({...proof,createdAtMs:Date.now()-31*60000}),{mode:0o600});
  assert.notEqual(probe().status,0);
  await writeFile(proofPath,JSON.stringify(proof),{mode:0o600});
  const disabled=probe({PATCHBOARD_QA_HTTPS_TEXT_TABLE:"0"});assert.equal(disabled.status,0);assert.equal(JSON.parse(disabled.stdout).enabled,false);
  await startBackend("1");
  assert.equal((await rawBackend("/health","wrong.invalid")).status,421);
  const challenge=await fetch(mcpURL,{redirect:"manual"});assert.equal(challenge.status,401);
  const authHeader=challenge.headers.get("www-authenticate");assert.match(authHeader,/table:create/);
  const resource=new URL(authHeader.match(/resource_metadata="([^"]+)"/)[1]);assert.equal(resource.origin,origin);
  const metadata=await (await fetch(resource)).json();assert.equal(metadata.resource,mcpURL);
  const issuer=await (await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth")).json();
  assert.equal(issuer.issuer,origin+"/patchboard-auth");
  assert.ok(issuer.scopes_supported.includes("table:create"));assert.ok(issuer.scopes_supported.includes("board:write"));
  const legacy=await fetch(origin+"/patchboard-private/",{redirect:"manual"});assert.equal(legacy.status,302);assert.equal(new URL(legacy.headers.get("location"),origin).pathname,"/signin");
  assert.deepEqual(Buffer.from(await (await fetch(origin+asset)).arrayBuffer()),built);
  stage="native baseline and browser-create denial";
  await page.goto(origin+"/boards/"+board);await page.getByRole("button",{name:"Open board Data"}).click();
  const data=page.getByRole("region",{name:"Board Data"});await expect(data.getByText("No saved views on this board.")).toBeVisible(options);
  assert.equal(await data.getByRole("button",{name:"Create table",exact:true}).count(),0);
  const browserCreate=await api(page,"records/tables/create",{board_id:board,request_id:randomUUID(),name:"MUST NOT CREATE",primary_field_name:"Title",default_view_name:"All rows"});
  assert.equal(browserCreate.status,404);assert.equal((await views(page,sibling)).status,404);
  await page.screenshot({path:join(evidence,"native-empty.png")});
  const initial=counts(await snapshot(board,page));assert.deepEqual(initial,zero);
  console.log("HTTPS_NATIVE_BASELINE_PASS",JSON.stringify({origin,board,asset,assetSha256,browserCreate:404,counts:initial}));
  stage="scoped SDK rehearsal";
  const old=await authorize(owner,board,"board:read board:write","HTTPS old scope");
  const oldClient=await connect(old);assert.equal(await listed(oldClient),false);
  denied(await invoke(oldClient,args(board)));assert.deepEqual(counts(await snapshot(board,page)),zero);
  const consent=await authorize(owner,board,"board:read board:write table:create","HTTPS SDK preflight",sibling);
  const client=await connect(consent);assert.equal(await listed(client),true);
  const input=args(board,"catalog-rehearsal-"+randomUUID());
  const first=success(await invoke(client,input));assert.equal(first.replayed,false);
  const replay=success(await invoke(client,input));assert.deepEqual(replay,{...first,replayed:true});
  const native=await nativeRead(page,board,first);
  await page.screenshot({path:join(evidence,"native-grid.png")});
  const saved=await snapshot(board,page);assert.deepEqual(counts(saved),one);
  const afterRestart=await nativeRead(page,board,first);assert.deepEqual(afterRestart,native);
  stage="native disconnect";
  await page.goto(origin+"/settings");
  const settings=page.getByRole("listitem").filter({hasText:"Client "+consent.clientId});
  await expect(settings.getByRole("button",{name:"Disconnect",exact:true})).toBeEnabled(options);
  page.once("dialog",d=>d.accept());await settings.getByRole("button",{name:"Disconnect",exact:true}).click();
  await expect(settings.getByRole("button",{name:"Disconnected",exact:true})).toBeDisabled(options);
  const freshRequest=args(board,randomUUID(),"Must not create after disconnect");
  await assert.rejects(()=>client.callTool({name:"call-api-write",arguments:freshRequest}),
    error=>error instanceof StreamableHTTPError && error.code===401);
  assert.deepEqual(await snapshot(board,page),saved);
  assert.deepEqual(await nativeRead(page,board,first),native);
  for(const [path,body] of [["records/rows/create",{}],["records/views/create",{}],["records/views/share",{}],["records/patch",{}]]){
    assert.equal((await api(page,path,body)).status,404);
  }
  await page.goto("about:blank");await stop(backend);
  const audited=spawnSync(process.execPath,["--import","tsx","test/audit-https-catalog.mjs"],{cwd:serverDir,env,encoding:"utf8",timeout:20000});
  assert.equal(audited.status,0,audited.stderr);
  const audit=JSON.parse(audited.stdout.split("\n").find(line=>line.startsWith("HTTPS_QA_STOPPED_AUDIT ")).slice("HTTPS_QA_STOPPED_AUDIT ".length));
  assert.deepEqual(audit.counts,{datasets:1,fields:1,views:1,receipts:1,events:1,records:0});
  const grant=audit.grants.find(g=>g.id===consent.grant.id);assert.ok(grant.revoked);assert.equal(grant.version,2);
  assert.deepEqual(grant.scopes.sort(),["board:read","board:write","table:create"]);
  await startBackend("1");
  // Scope advertisement and package are verified against the exact local HTTPS
  // fixture; the .localhost archive is deliberately not installable remotely.
  const repo=resolve(patchboard,"../.."),output=join(evidence,"fixture-package","stage");
  const packagingEnv={...env,DIM0_MCP_URL:mcpURL,DIM0_PLUGIN_OUTPUT_DIR:output,DIM0_QA_CATALOG_DISCOVERY:"1"};
  await execute(process.execPath,["integrations/dim0-mcp-plugin/scripts/build.mjs"],repo,packagingEnv);
  await execute(process.execPath,["scripts/test-dim0-plugin-oauth-discovery.mjs"],repo,packagingEnv);
  const archive=join(output,"../dim0-jazz-mcp-plugin.zip"),archiveSha256=createHash("sha256").update(await readFile(archive)).digest("hex");
  const result={origin,board,asset,assetSha256,archiveSha256,archiveKind:"LOCAL_FIXTURE_ONLY",browserCreateStatus:404,legacyRedirect:302,wrongHost:421,
    initial,forgedConsentStatus:403,oldScopeDenied:true,otherTypedBrowserWritesDenied:true,stoppedStoreAudit:audit,consentedScopes:["board:read","board:write","table:create"],first,replay,native,afterRestart,
    postDisconnectHttp:401,postDisconnectCounts:counts(saved),installedChatGPTPluginTested:false,publicFunnelStarted:false};
  await writeFile(proofPath,JSON.stringify({...proof,createdAtMs:Date.now()-31*60000}),{mode:0o600});
  assert.equal((await rawBackend("/health",host)).status,503);
  await writeFile(proofPath,JSON.stringify(proof),{mode:0o600});
  result.expiredSealStatus=503;
  await save("https-sdk-preflight-trace",result);
  console.log("HTTPS_NATIVE_SDK_PREFLIGHT_PASS",JSON.stringify(result));
}catch(error){console.error("HTTPS_PREFLIGHT_FAILED",stage,error?.name,String(error?.message??"").split("\n")[0].replace(/https?:\/\/[^\s]+/g,"[URL]").replace(/[A-Za-z0-9_-]{43,}/g,"[REDACTED]"));process.exitCode=1;}
finally{
  for(const client of clientList)await client.close().catch(()=>{});
  await browser?.close().catch(()=>{});
  tls.closeAllConnections();await new Promise(r=>tls.close(r));
  for(const job of jobs)await stop(job);
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  await assert.rejects(()=>fetch(origin+"/signin",{signal:AbortSignal.timeout(1000)}));
  console.log("HTTPS_LOCAL_FIXTURE_RETIRED");
}
