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

const filteredSharing=process.argv.includes("--filtered-sharing");
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
  PATCHBOARD_PRIVATE_PORT:String(backendPort),PATCHBOARD_OAUTH_CI_RESTART:"0",PATCHBOARD_QA_TYPED_RECORD:"0",PATCHBOARD_QA_HTTPS_TEXT_TABLE:"0",PATCHBOARD_PERSISTENT_TEXT_CATALOG:"0",PATCHBOARD_PERSISTENT_FILTERED_SHARING:"0",PATCHBOARD_ACC051_INFLIGHT_QA:"0",
  PATCHBOARD_PRIVATE_DIM0_ONLY:"1",VITE_DIM0_JAZZ_CANVAS:"1",VITE_DIM0_QA_NATIVE_SAVED_VIEW:"0",VITE_DIM0_QA_NATIVE_CATALOG_READONLY:"0",VITE_DIM0_PERSISTENT_TEXT_CATALOG:"1",VITE_DIM0_PERSISTENT_FILTERED_SHARING:"0",DIM0_JAZZ_PUBLIC_HOST:hostname,APP_PORT:String(uiPort),NODE_EXTRA_CA_CERTS:cert});
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
let backend,frontend,browser,backendMode="0",sharingMode="0";
const vite=join(webui,"node_modules/.bin/vite");
const options={timeout:30000};
function rawBackend(path,requestHost){
  return new Promise((yes,no)=>{
    const req=httpRequest({hostname:"127.0.0.1",port:backendPort,path,headers:{Host:requestHost}},res=>{
      res.resume();res.on("end",()=>yes({status:res.statusCode,headers:res.headers}));
    });req.on("error",no);req.setTimeout(2000,()=>req.destroy(Error("Timeout")));req.end();
  });
}
async function startBackend(enabled=backendMode,sharing=sharingMode){
  backendMode=enabled;sharingMode=sharing;
  backend=launch("pnpm",["--filter","@patchboard/server","exec","tsx","src/private-demo.ts"],patchboard,{PATCHBOARD_PERSISTENT_TEXT_CATALOG:enabled,PATCHBOARD_PERSISTENT_FILTERED_SHARING:sharing});
  for(let i=0;i<160;i++){
    assert.equal(backend.child.exitCode,null,"QA backend exited");
    try{if((await rawBackend("/health",host)).status===200)return;}catch{}
    await sleep(250);
  }throw Error("Backend readiness failed");
}
async function startFrontend(sharing=filteredSharing?"1":"0"){
  const buildDir=join(root,"native-persistent-"+sharing);
  await execute(vite,["build","--outDir",buildDir],webui,{VITE_DIM0_PERSISTENT_FILTERED_SHARING:sharing});
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


async function runFilteredSharing(board,owner,recipient){
  const op=owner.page,rp=recipient.page,boardUrl=origin+"/boards/"+board;
  const openData=async()=>{
    await op.getByRole("button",{name:"Open board Data"}).click();
    const data=op.getByRole("region",{name:"Board Data"});
    await expect(data).toBeVisible(options);
    return data;
  };
  const see=async(page,text,total)=>{
    await expect(grid(page).getByRole("cell",{name:text,exact:true})).toBeVisible(options);
    await expect(page.getByText(total+" matching records",{exact:true})).toBeVisible(options);
    await expect(grid(page).getByRole("columnheader")).toHaveCount(1);
    await expect(grid(page).getByRole("columnheader",{name:"Title",exact:true})).toBeVisible();
  };
  const cleared=async()=>{
    await expect(rp.getByRole("alert")).toContainText("revoked or is unavailable",options);
    await expect(grid(rp)).toHaveCount(0);
    await expect(rp.getByText(/matching records/)).toHaveCount(0);
    await expect(rp.getByRole("button",{name:"First page"})).toBeDisabled();
    await expect(rp.getByRole("button",{name:"Next page"})).toBeDisabled();
  };
  stage="catalog-only profile does not expose sharing routes";
  await stop(backend);await startBackend("1","0");
  await op.goto(boardUrl);
  assert.equal((await api(op,"records/views?board_id="+board)).status,200);
  for(const action of ["create","share","revoke","query","revise"])
    assert.equal((await api(op,"records/views/"+action,{})).status,404);
  assert.equal((await api(op,"records/views/shares?board_id="+board)).status,404);
  stage="native table, rows and filtered view";
  await stop(backend);await startBackend("1","1");
  await op.goto(boardUrl);
  let data=await openData();
  await expect(data.getByText("No saved views on this board.",{exact:true})).toBeVisible(options);
  const tableResponse=op.waitForResponse(r=>r.url().endsWith("/records/tables/create")&&r.request().method()==="POST");
  await data.getByLabel("Table name",{exact:true}).fill("Persistent sharing");
  await data.getByRole("button",{name:"Create table",exact:true}).click();
  const table=await tableResponse;assert.equal(table.status(),201);
  const created=await table.json(),tableInput=table.request().postDataJSON();
  const {datasetId:dataset,fieldId:title,defaultViewId:allRows}=created;
  await expect(grid(op)).toHaveAttribute("data-view-id",allRows,options);
  const added=[],inputs=[];
  for(const value of ["Demo alpha","Internal planning","Demo beta"]){
    const response=op.waitForResponse(r=>r.url().endsWith("/records/rows/create")&&r.request().method()==="POST");
    await data.getByLabel("New row Title",{exact:true}).fill(value);
    await data.getByRole("button",{name:"Add row",exact:true}).click();
    const reply=await response;assert.equal(reply.status(),201);
    const row=await reply.json();
    assert.equal(row.updatedBy,owner.identity.accountId);
    added.push(row);inputs.push(reply.request().postDataJSON());
    await expect(op.getByText(added.length+" matching records",{exact:true})).toBeVisible(options);
    await expect(data.getByLabel("New row Title",{exact:true})).toHaveValue("");
  }
  await see(op,"Demo alpha",3);
  await data.getByRole("button",{name:"Next page"}).click();await see(op,"Demo beta",3);
  await data.getByRole("button",{name:"Next page"}).click();await see(op,"Internal planning",3);
  await data.getByLabel("Saved view name",{exact:true}).fill("Demo items");
  await data.getByLabel("Title starts with",{exact:true}).fill("Demo");
  const saveResponse=op.waitForResponse(r=>r.url().endsWith("/records/views/create")&&r.request().method()==="POST");
  await data.getByRole("button",{name:"Save view",exact:true}).click();
  const saved=await saveResponse;assert.equal(saved.status(),201);
  const view=(await saved.json()).viewId,definition=saved.request().postDataJSON();
  const ref={board_id:board,dataset_id:dataset,view_id:view};
  await see(op,"Demo alpha",2);
  await expect(grid(op)).toHaveAttribute("data-view-id",view);
  await op.screenshot({animations:"disabled",path:join(evidence,"owner-filtered.png")});
  await op.keyboard.press("Escape");
  stage="native copied link and independent recipient";
  await rp.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(rp).toHaveURL(origin+"/signin",options);
  await op.getByRole("button",{name:"Share this board"}).click();
  const group=op.getByRole("group",{name:"Share saved view Demo items",exact:true});
  const issueResponse=op.waitForResponse(r=>r.url().endsWith("/records/views/share")&&r.request().method()==="POST");
  await group.getByRole("button",{name:"Create view link",exact:true}).click();
  const issue=await issueResponse;assert.equal(issue.status(),201);
  const issued=await issue.json();
  await group.getByRole("button",{name:"Copy view link",exact:true}).click();
  await expect(group.getByText("View link copied.",{exact:true})).toBeVisible(options);
  const copied=await op.evaluate(()=>navigator.clipboard.readText());
  const u=new URL(copied);
  assert.equal(u.origin,origin);assert.equal(u.pathname,"/shared-view/"+board+"/"+dataset+"/"+view);
  assert.equal(u.search,"");assert.match(u.hash,/^#share=[A-Za-z0-9_-]{43}$/);
  assert.equal(new URLSearchParams(u.hash.slice(1)).get("share"),issued.shareToken);
  const query={...ref,share_token:issued.shareToken,page_size:1};
  const metadataPath="records/views/shares?"+new URLSearchParams(ref);
  const active={shareId:issued.shareId,shareVersion:1,revoked:false};
  assert.deepEqual((await api(op,metadataPath)).body.shares,[active]);
  await op.keyboard.press("Escape");
  const boardFetches=[];
  const observeLanding=r=>{
    if(["/patchboard-private/api/board","/patchboard-private/api/canvas","/patchboard-private/api/join"].includes(new URL(r.url()).pathname))boardFetches.push(true);
  };
  rp.on("request",observeLanding);
  await rp.goto(copied,{waitUntil:"domcontentloaded"});
  await rp.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await see(rp,"Demo alpha",2);
  assert.equal((await api(rp,"me")).body.id,recipient.identity.id);
  assert.deepEqual(boardFetches,[]);rp.off("request",observeLanding);
  assert.equal((await api(rp,"records/views/query",{...query,record_id:added[1].recordId})).status,404);
  assert.equal((await api(rp,"records/views/query",{...query,requested_field_ids:[randomUUID()]})).status,400);
  const first=await api(rp,"records/views/query",query);
  assert.equal(first.status,200);assert.deepEqual(first.body.fields,[title]);
  assert.deepEqual(first.body.columns,[{id:title,name:"Title"}]);
  assert.deepEqual(first.body.rows.map(r=>r.cells),[{[title]:"Demo alpha"}]);
  await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta",2);
  await expect(rp.getByText("Internal planning",{exact:true})).toHaveCount(0);
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-page-two.png")});
  const denied={
    canvas:(await api(rp,"canvas?board_id="+board)).status,
    table:(await api(rp,"records/tables/create",{...tableInput,request_id:randomUUID()})).status,
    row:(await api(rp,"records/rows/create",{...inputs[0],request_id:randomUUID()})).status,
    view:(await api(rp,"records/views/create",definition)).status,
    list:(await api(rp,"records/views?board_id="+board)).status,
    ownerQuery:(await api(rp,"records/views/owner-query",{...ref,page_size:1})).status,
    shares:(await api(rp,metadataPath)).status,
    issue:(await api(rp,"records/views/share",ref)).status,
    revoke:(await api(rp,"records/views/revoke",{...ref,share_id:issued.shareId,expected_version:1})).status,
    otherView:(await api(rp,"records/views/query",{...query,view_id:allRows})).status,
  };
  assert.ok(Object.values(denied).every(status=>status===403),JSON.stringify(denied));
  assert.deepEqual((await api(rp,"boards")).body.boards,[]);
  assert.deepEqual((await api(rp,"account/connected-apps")).body.grants,[]);
  const unsupported={
    dataset:(await api(rp,"records/dataset?"+new URLSearchParams({board_id:board,dataset_id:dataset}))).status,
    patch:(await api(op,"records/patch",{})).status,
    revise:(await api(op,"records/views/revise",{})).status,
  };
  assert.deepEqual(unsupported,{dataset:404,patch:404,revise:404});
  const meta=await (await fetch(origin+"/.well-known/oauth-authorization-server/patchboard-auth")).json();
  assert.ok(Array.isArray(meta.scopes_supported)&&!meta.scopes_supported.includes("table:create"));

  stage="active share survives restart of both durable stores";
  const before=await snapshot(board,op);
  const expected={...one,typedViews:2,typedRecords:3,typedPatchReceipts:3,typedPatchEvents:3};
  assert.deepEqual(counts(before),expected);
  assert.deepEqual(before.typedRecords.map(r=>r.cells[title]).sort(),["Demo alpha","Demo beta","Internal planning"]);
  assert.deepEqual(before.typedRecords.map(r=>r.updatedBy),Array(3).fill(owner.identity.accountId));
  assert.deepEqual(before.typedViews.find(v=>v.id===view).allowedFieldIds,[title]);
  await op.goto(boardUrl);
  assert.deepEqual((await api(op,metadataPath)).body.shares,[active]);
  const next=await api(rp,"records/views/query",{...query,cursor:first.body.nextCursor});
  assert.equal(next.status,200);assert.deepEqual(next.body.rows.map(r=>r.cells),[{[title]:"Demo beta"}]);
  await rp.reload();await see(rp,"Demo alpha",2);
  await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta",2);
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-after-restart.png")});

  stage="native revoke and next fetch clears recipient";
  await op.getByRole("button",{name:"Share this board"}).click();
  const revokeResponse=op.waitForResponse(r=>r.url().endsWith("/records/views/revoke")&&r.request().method()==="POST");
  await group.getByRole("button",{name:"Revoke view link",exact:true}).click();
  const revoked=await revokeResponse;assert.equal(revoked.status(),200);
  const revokedMetadata={shareId:issued.shareId,shareVersion:2,revoked:true};
  assert.deepEqual(await revoked.json(),revokedMetadata);
  await expect(group.getByText("View link revoked.",{exact:true})).toBeVisible(options);
  const denial=rp.waitForResponse(r=>r.url().endsWith("/records/views/query")&&r.status()===403);
  await rp.getByRole("button",{name:"Refresh view"}).click();await denial;await cleared();
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-revoked.png")});
  await rp.reload();await cleared();
  const after=await snapshot(board,op);assert.deepEqual(after,before);
  await rp.reload();await cleared();
  await op.goto(boardUrl);assert.deepEqual((await api(op,metadataPath)).body.shares,[revokedMetadata]);
  data=await openData();
  await data.getByRole("button",{name:"Open saved view All rows",exact:true}).click();
  await see(op,"Demo alpha",3);
  await data.getByRole("button",{name:"Next page"}).click();await see(op,"Demo beta",3);
  await data.getByRole("button",{name:"Next page"}).click();await see(op,"Internal planning",3);
  await op.keyboard.press("Escape");

  stage="sharing off with persistent catalog still on";
  await stop(backend);await startBackend("1","0");
  await stop(frontend);await startFrontend("0");
  await op.goto(boardUrl);
  data=await openData();await data.getByRole("button",{name:"Open saved view All rows",exact:true}).click();
  await see(op,"Demo alpha",3);
  await expect(data.getByRole("button",{name:"Save view",exact:true})).toHaveCount(0);
  await expect(data.getByRole("button",{name:"Add row",exact:true})).toBeVisible();
  await op.keyboard.press("Escape");
  await op.getByRole("button",{name:"Share this board"}).click();
  await expect(op.getByRole("region",{name:"Saved view links"})).toHaveCount(0);
  const ordinary=op.waitForResponse(r=>r.url().endsWith("/api/invite")&&r.request().method()==="POST");
  await op.getByRole("dialog").getByRole("button",{name:"Create link",exact:true}).click();
  assert.equal((await ordinary).status(),201);
  const off={
    create:(await api(op,"records/views/create",definition)).status,
    share:(await api(op,"records/views/share",ref)).status,
    revoke:(await api(op,"records/views/revoke",{...ref,share_id:issued.shareId,expected_version:2})).status,
    shares:(await api(op,metadataPath)).status,
    query:(await api(rp,"records/views/query",query)).status
  };
  assert.ok(Object.values(off).every(status=>status===404),JSON.stringify(off));
  const offPage=await recipient.context.newPage();await offPage.goto(copied,{waitUntil:"domcontentloaded"});
  await expect(offPage.getByRole("heading",{name:"Saved view unavailable",exact:true})).toBeVisible(options);
  assert.deepEqual(await snapshot(board,op),before);
  assert.deepEqual(boardFetches,[]);
  await save("persistent-filtered-sharing-trace",{
    profile:"persistent HTTPS local fixture",qaFlags:false,created,viewId:view,shareId:issued.shareId,
    rows:added.map(r=>r.recordId),allowedField:title,canonicalTitles:["Demo alpha","Demo beta","Internal planning"],
    filteredTitles:["Demo alpha","Demo beta"],actualClipboard:true,recipientMemberships:0,oauthGrants:0,
    activeMetadata:active,activeAfterRestart:true,oldCursorAfterRestart:true,revokedMetadata,
    revokedNextFetch:403,clearedGridAndCount:true,disabledPagination:true,reloadAndRestartDenied:true,
    denied,unsupported,off,ordinaryInviteStatus:201,counts:counts(before),ownerRetained:3,unchanged:true
  });
  console.log("PERSISTENT_FILTERED_SHARING_PASS",JSON.stringify({datasetId:dataset,fieldId:title,viewId:view,shareId:issued.shareId,counts:counts(before),activeAfterRestart:true,revokedNextFetch:403,ownerRetained:3,off}));
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

  if(filteredSharing){
    await runFilteredSharing(board,owner,other);
  }else{
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
  stage="committed row response lost; reload and exact retry";
  // Intercept the actual browser POST, let it reach the authority, capture
  // its committed 201 and discard the reply before it reaches the UI.
  let resolveFirstRow, rejectFirstRow;
  const firstRow=new Promise((yes,no)=>{resolveFirstRow=yes;rejectFirstRow=no;});
  const dropRowReply=async route=>{
    try{
      const input=route.request().postDataJSON();
      const committed=await route.fetch();
      assert.equal(committed.status(),201);
      const result=await committed.json();
      assert.equal(result.replayed,false);
      await route.abort("failed");
      resolveFirstRow({input,result});
    }catch(error){rejectFirstRow(error);await route.abort("failed").catch(()=>{});}
  };
  await op.route("**/patchboard-private/api/records/rows/create",dropRowReply,{times:1});
  await data.getByLabel("New row Title",{exact:true}).fill("Still here after restart");
  await data.getByRole("button",{name:"Add row",exact:true}).click();
  const first=await firstRow;
  const row=first.result,rowInput=first.input;
  assert.equal(row.updatedBy,owner.identity.accountId);
  await expect(data.getByText(/Commit outcome unconfirmed/)).toBeVisible(options);
  await expect(data.getByRole("button",{name:"Retry Add row",exact:true})).toBeEnabled(options);
  await op.reload();
  await op.getByRole("button",{name:"Open board Data"}).click();
  await expect(data.getByText(/Commit outcome unconfirmed/)).toBeVisible(options);
  await expect(data.getByLabel("New row Title",{exact:true})).toHaveValue(rowInput.value);
  await expect(data.getByLabel("New row Title",{exact:true})).toBeDisabled();
  await expect(data.getByRole("button",{name:"Add row",exact:true})).toBeDisabled();
  // Committed row is already visible from authoritative readback, even
  // though the browser never received the successful write response.
  await expect(grid(op).locator("[data-record-id]")).toHaveAttribute("data-record-id",row.recordId,options);
  await expect(op.getByText("1 matching records",{exact:true})).toBeVisible(options);
  await op.screenshot({path:join(evidence,"reload-before-retry.png")});
  const rowResponse=op.waitForResponse(r=>r.url().endsWith("/records/rows/create")&&r.request().method()==="POST");
  await data.getByRole("button",{name:"Retry Add row",exact:true}).click();
  const rowReply=await rowResponse;assert.equal(rowReply.status(),201);
  assert.deepEqual(rowReply.request().postDataJSON(),rowInput);
  const replay=await rowReply.json();assert.deepEqual(replay,{...row,replayed:true});
  await expect(data.getByText("Row added.",{exact:true})).toBeVisible(options);
  await expect(data.getByRole("button",{name:"Retry Add row",exact:true})).toHaveCount(0);
  await expect.poll(()=>op.evaluate(()=>Object.keys(sessionStorage).filter(k=>k.startsWith("dim0:catalog-intent:v1:")).length)).toBe(0);
  console.log("PERSISTENT_ROW_RELOAD_RETRY_PASS",JSON.stringify({requestId:rowInput.request_id,recordId:row.recordId,receiptId:row.receiptId,eventId:row.eventId,replayed:replay.replayed,identicalInput:true}));
  await expect(grid(op).getByRole("cell",{name:"Still here after restart",exact:true})).toBeVisible(options);
  await expect(grid(op).locator("[data-record-id]")).toHaveAttribute("data-record-id",row.recordId);
  await expect(op.getByText("1 matching records",{exact:true})).toBeVisible();
  await op.screenshot({path:join(evidence,"before-restart.png")});
  const ref={board_id:board,dataset_id:created.datasetId,view_id:created.defaultViewId};

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
    nonTemporaryFixture:true,initial:zero,created,row,replay,rowRequestId:rowInput.request_id,identicalRowRetry:true,lostCommittedResponse:true,reloadedBeforeConfirmation:true,denied,unsupported,tableCreateScopeAdvertised:false,
    postRestart:counts(after),sameAccount:true,stableIds:true,writerPreserved:true,afterFeatureOff:counts(before),off});
  console.log("PERSISTENT_TEXT_CATALOG_PASS",JSON.stringify({datasetId:created.datasetId,fieldId:created.fieldId,viewId:created.defaultViewId,recordId:row.recordId,counts:counts(after),identicalRowRetry:true,replayed:replay.replayed,denied,unsupported,off}));
  }
}catch(error){
  console.error("PERSISTENT_TEXT_CATALOG_FAILURE",stage,error?.name??"Error");
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  for(const job of jobs)await stop(job);
  await new Promise(resolve=>tls.close(resolve));
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
