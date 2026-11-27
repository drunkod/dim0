/** Persistent HTTPS Owner catalog rehearsal: normal private origin, non-temp store, no QA flags. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {readFile} from "node:fs/promises";
import {execFileSync} from "node:child_process";
import {createServer as createHttpsServer} from "node:https";
import {request as httpRequest} from "node:http";
import {getCACertificates,setDefaultCACertificates} from "node:tls";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import {mkdtemp,mkdir,rm,writeFile} from "node:fs/promises";
import {homedir,tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {fileURLToPath} from "node:url";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {chromium,expect} from "@playwright/test";

const patchboard=resolve(fileURLToPath(new URL("../../../",import.meta.url)));
const webui=resolve(patchboard,"../../webui");
const root=await mkdtemp(join(homedir(),".dim0-persistent-catalog-rehearsal-"));
const evidence=process.env.DIM0_PERSISTENT_CATALOG_EVIDENCE ? resolve(process.env.DIM0_PERSISTENT_CATALOG_EVIDENCE) : await mkdtemp(join(tmpdir(),"dim0-persistent-catalog-evidence-"));
await mkdir(evidence,{recursive:true,mode:0o700});
const freePort=()=>new Promise((yes,no)=>{
  const s=createServer().once("error",no);
  s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>yes(port));});
});
const uiPort=await freePort();let backendPort=await freePort();while(uiPort===backendPort)backendPort=await freePort();
let tlsPort=await freePort();while([uiPort,backendPort].includes(tlsPort))tlsPort=await freePort();
const hostname="dim0-persistent.localhost",origin="https://"+hostname+":"+tlsPort;
const host=new URL(origin).host,cert=join(root,"fixture-cert.pem"),key=join(root,"fixture-key.pem");
execFileSync("openssl",["req","-x509","-newkey","rsa:2048","-nodes","-days","1","-subj","/CN="+hostname,
  "-addext","subjectAltName=DNS:"+hostname,"-keyout",key,"-out",cert],{stdio:"ignore"});
// Trust only this fixture certificate in this process and its children.
// Never disable TLS certificate verification for Node.
setDefaultCACertificates([...getCACertificates("default"),await readFile(cert,"utf8")]);
const tls=createHttpsServer({key:await readFile(key),cert:await readFile(cert)},(req,res)=>{
  if(req.headers.host!==host){res.writeHead(421);res.end();return;}
  // Never destroy a pooled upstream socket after a normally completed
  // response: it could already be serving another asset or API request.
  const headers={...req.headers,connection:"close","x-forwarded-proto":"https"};
  delete headers["proxy-connection"];
  const upstream=httpRequest({hostname:"127.0.0.1",port:uiPort,path:req.url,method:req.method,headers,agent:false},r=>{
    const reply={...r.headers};
    delete reply.connection;delete reply["keep-alive"];
    res.writeHead(r.statusCode,reply);r.pipe(res);
  });
  upstream.on("error",()=>{if(!res.headersSent)res.writeHead(502);res.end();});
  res.once("close",()=>{if(!res.writableFinished)upstream.destroy();});
  req.pipe(upstream);
});
await new Promise((yes,no)=>tls.once("error",no).listen(tlsPort,"127.0.0.1",yes));
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(k)));
Object.assign(env,{CI:"1",PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_DEV:"0",PATCHBOARD_PRIVATE_ORIGIN:origin,
  PATCHBOARD_PRIVATE_PORT:String(backendPort),PATCHBOARD_OAUTH_CI_RESTART:"0",PATCHBOARD_QA_TYPED_RECORD:"0",PATCHBOARD_QA_HTTPS_TEXT_TABLE:"0",PATCHBOARD_PERSISTENT_TEXT_CATALOG:"0",PATCHBOARD_ACC051_INFLIGHT_QA:"0",
  PATCHBOARD_PRIVATE_DIM0_ONLY:"1",VITE_DIM0_JAZZ_CANVAS:"1",VITE_DIM0_QA_NATIVE_SAVED_VIEW:"0",VITE_DIM0_QA_NATIVE_CATALOG_READONLY:"0",VITE_DIM0_PERSISTENT_TEXT_CATALOG:"1",DIM0_JAZZ_PUBLIC_HOST:hostname,APP_PORT:String(uiPort),NODE_EXTRA_CA_CERTS:cert});
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
  backend=launch("pnpm",["--filter","@patchboard/server","exec","tsx","src/private-demo.ts"],patchboard,{PATCHBOARD_PERSISTENT_TEXT_CATALOG:enabled});
  for(let i=0;i<160;i++){
    assert.equal(backend.child.exitCode,null,"QA backend exited");
    try{if((await rawBackend("/health",host)).status===200)return;}catch{}
    await sleep(250);
  }throw Error("Backend readiness failed");
}
async function startFrontend(){
  const buildDir=join(root,"native-persistent");
  await execute(vite,["build","--outDir",buildDir],webui,{});
  frontend=launch(vite,["preview","--outDir",buildDir,"--host","127.0.0.1","--port",String(uiPort),"--strictPort"],webui,{PATCHBOARD_PERSISTENT_TEXT_CATALOG:"1"});
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
  await page.goto(origin+"/signup",{waitUntil:"load"});
  try{
    // Require stylesheets to be actually available, not merely a fetched
    // HTML/entry chunk; an unstyled page is not valid native UI evidence.
    await expect.poll(()=>page.evaluate(()=>Array.from(document.querySelectorAll('link[rel="stylesheet"]')).every(link=>!!link.sheet)),{timeout:30000}).toBe(true);
    await page.getByRole("button",{name:"Create account with passkey",exact:true}).click({timeout:30000});
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
const one={...zero,typedDatasets:1,typedFields:1,typedViews:1,typedRecords:1,typedCatalogReceipts:1,typedCatalogEvents:1,typedPatchReceipts:1,typedPatchEvents:1};
const counts=s=>Object.fromEntries(names.map(n=>[n,s[n].length]));
async function snapshot(board,page){
  if(page)await page.goto("about:blank");
  let rows;
  await offline(async db=>{rows=Object.fromEntries(await Promise.all(names.map(async n=>[n,(await db.all(app[n].where({boardId:board}))).sort((a,b)=>a.id.localeCompare(b.id))])));});
  return rows;
}

let stage="startup";
try{
  await execute("pnpm",["auth:migrate:private"],patchboard);
  await startBackend("0");await startFrontend();browser=await chromium.launch({headless:true});
  const owner=await account(),other=await account(),op=owner.page,np=other.page;
  assert.notEqual(owner.identity.id,other.identity.id);
  stage="create native board; default off";
  const createdBoard=op.waitForResponse(r=>r.url().endsWith("/api/boards")&&r.request().method()==="POST");
  await op.getByLabel("Create a board",{exact:true}).fill("Persistent catalog rehearsal");
  await op.getByRole("button",{name:"Create board",exact:true}).click();
  const response=await createdBoard;assert.equal(response.status(),201);
  const board=(await response.json()).board_id;
  await op.goto(origin+"/boards/"+board);
  await expect(op.getByRole("button",{name:"Share this board"})).toBeVisible(options);
  const create={board_id:board,request_id:randomUUID(),name:"Persistent table",primary_field_name:"Title",default_view_name:"All rows"};
  assert.equal((await api(op,"records/tables/create",create)).status,404);
  assert.equal((await api(op,"records/views?board_id="+board)).status,404);
  await expect(op.getByRole("button",{name:"Open board Data"})).toHaveCount(0);
  assert.deepEqual(counts(await snapshot(board,op)),zero);

  stage="persistent profile create";
  await stop(backend);await startBackend("1");
  await op.goto(origin+"/boards/"+board);
  await op.getByRole("button",{name:"Open board Data"}).click();
  const data=op.getByRole("region",{name:"Board Data"});
  await expect(data.getByText("No saved views on this board.",{exact:true})).toBeVisible(options);
  const tableResponse=op.waitForResponse(r=>r.url().endsWith("/records/tables/create")&&r.request().method()==="POST");
  await data.getByLabel("Table name",{exact:true}).fill("Persistent table");
  await data.getByRole("button",{name:"Create table",exact:true}).click();
  const table=await tableResponse;assert.equal(table.status(),201);
  const created=await table.json();assert.equal(created.replayed,false);
  const input=table.request().postDataJSON();
  await expect(grid(op)).toHaveAttribute("data-dataset-id",created.datasetId,options);
  await expect(grid(op)).toHaveAttribute("data-view-id",created.defaultViewId);
  await expect(grid(op).getByRole("columnheader",{name:"Title"})).toHaveAttribute("data-field-id",created.fieldId);
  await expect(op.getByRole("button",{name:"Save view",exact:true})).toHaveCount(0);
  const rowResponse=op.waitForResponse(r=>r.url().endsWith("/records/rows/create")&&r.request().method()==="POST");
  await data.getByLabel("New row Title",{exact:true}).fill("Still here after restart");
  await data.getByRole("button",{name:"Add row",exact:true}).click();
  const rowReply=await rowResponse;assert.equal(rowReply.status(),201);
  const row=await rowReply.json();assert.equal(row.updatedBy,owner.identity.accountId);assert.equal(row.replayed,false);
  await expect(grid(op).getByRole("cell",{name:"Still here after restart",exact:true})).toBeVisible(options);
  await expect(grid(op).locator("[data-record-id]")).toHaveAttribute("data-record-id",row.recordId);
  await expect(op.getByText("1 matching records",{exact:true})).toBeVisible();
  await op.screenshot({path:join(evidence,"before-restart.png")});
  const ref={board_id:board,dataset_id:created.datasetId,view_id:created.defaultViewId};
  const rowInput=rowReply.request().postDataJSON();

  stage="nonmember and scope boundaries";
  const denied={
    table:(await api(np,"records/tables/create",{...input,request_id:randomUUID()})).status,
    row:(await api(np,"records/rows/create",{...rowInput,request_id:randomUUID()})).status,
    list:(await api(np,"records/views?board_id="+board)).status,
    query:(await api(np,"records/views/owner-query",{...ref,page_size:1})).status
  };
  assert.deepEqual(denied,{table:403,row:403,list:403,query:403});
  const unsupported={
    share:(await api(op,"records/views/share",ref)).status,
    createView:(await api(op,"records/views/create",{})).status,
    patch:(await api(op,"records/patch",{})).status,
    unrestricted:(await api(op,"records/dataset?board_id="+board+"&dataset_id="+created.datasetId)).status
  };
  assert.deepEqual(unsupported,{share:404,createView:404,patch:404,unrestricted:404});
  const meta=await (await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth")).json();
  assert.ok(Array.isArray(meta.scopes_supported)&&!meta.scopes_supported.includes("table:create"));
  await op.keyboard.press("Escape");
  await op.getByRole("button",{name:"Share this board"}).click();
  await expect(op.getByRole("region",{name:"Saved view links"})).toHaveCount(0);
  await op.keyboard.press("Escape");

  stage="close authority and reopen persistent store";
  const before=await snapshot(board,op);assert.deepEqual(counts(before),one);
  assert.equal(before.typedRecords[0].updatedBy,owner.identity.accountId);
  assert.equal(before.typedRecords[0].id,row.recordId);
  assert.equal(before.typedRecords[0].cells[created.fieldId],"Still here after restart");
  assert.equal(before.typedCatalogReceipts[0].id,created.receiptId);
  assert.equal(before.typedCatalogEvents[0].id,created.eventId);
  assert.equal(before.typedPatchReceipts[0].id,row.receiptId);
  assert.equal(before.typedPatchEvents[0].id,row.eventId);
  // Reopen through the same HTTPS origin and existing passkey account, not a reseeded store.
  await op.goto(origin+"/boards");
  await op.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(op).toHaveURL(origin+"/signin",options);
  await op.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await expect(op).toHaveURL(origin+"/boards",options);
  const identity=(await api(op,"me")).body;
  assert.equal(identity.id,owner.identity.id);assert.equal(identity.accountId,owner.identity.accountId);
  await op.getByRole("button",{name:/Persistent catalog rehearsal/}).click();
  await op.getByRole("button",{name:"Open board Data"}).click();
  await op.getByRole("button",{name:"Open saved view All rows",exact:true}).click();
  await expect(grid(op).getByRole("cell",{name:"Still here after restart",exact:true})).toBeVisible(options);
  await expect(grid(op)).toHaveAttribute("data-dataset-id",created.datasetId);
  await expect(grid(op)).toHaveAttribute("data-view-id",created.defaultViewId);
  await expect(grid(op).getByRole("columnheader",{name:"Title"})).toHaveAttribute("data-field-id",created.fieldId);
  await expect(grid(op).locator("[data-record-id]")).toHaveAttribute("data-record-id",row.recordId);
  await op.screenshot({path:join(evidence,"after-restart.png")});
  const after=await snapshot(board,op);assert.deepEqual(after,before);

  stage="turn persistent profile off without changing data";
  await stop(backend);await startBackend("0");await op.goto(origin+"/boards/"+board);
  await expect(op.getByRole("button",{name:"Share this board"})).toBeVisible(options);
  const off={list:(await api(op,"records/views?board_id="+board)).status,
    table:(await api(op,"records/tables/create",input)).status,
    row:(await api(op,"records/rows/create",rowInput)).status,
    query:(await api(op,"records/views/owner-query",{...ref,page_size:1})).status};
  assert.deepEqual(off,{list:404,table:404,row:404,query:404});
  await expect(op.getByRole("button",{name:"Open board Data"})).toHaveCount(0);
  assert.deepEqual(await snapshot(board,op),before);
  await save("persistent-text-catalog-trace",{profile:"persistent HTTPS (loopback TLS proxy)",qaFlags:false,
    nonTemporaryFixture:true,initial:zero,created,row,denied,unsupported,tableCreateScopeAdvertised:false,
    postRestart:counts(after),sameAccount:true,stableIds:true,writerPreserved:true,afterFeatureOff:counts(before),off});
  console.log("PERSISTENT_TEXT_CATALOG_PASS",JSON.stringify({datasetId:created.datasetId,fieldId:created.fieldId,viewId:created.defaultViewId,recordId:row.recordId,counts:counts(after),denied,unsupported,off}));
}catch(error){
  console.error("PERSISTENT_TEXT_CATALOG_FAILURE",stage,error?.name??"Error");
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  for(const job of jobs)await stop(job);
  await new Promise(resolve=>tls.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
