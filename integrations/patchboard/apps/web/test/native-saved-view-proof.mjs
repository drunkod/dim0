/** Native saved-view rehearsal, actual clipboard and native passkeys in disposable stores. */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
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
const root=await mkdtemp(join(tmpdir(),"patchboard-private-ci-native-view-"));
const evidence=process.env.DIM0_NATIVE_VIEW_EVIDENCE ? resolve(process.env.DIM0_NATIVE_VIEW_EVIDENCE) : await mkdtemp(join(tmpdir(),"dim0-native-view-evidence-"));
await mkdir(evidence,{recursive:true,mode:0o700});
const freePort=()=>new Promise((yes,no)=>{
  const s=createServer().once("error",no);
  s.listen(0,"127.0.0.1",()=>{const port=s.address().port;s.close(()=>yes(port));});
});
const uiPort=await freePort();let backendPort=await freePort();while(uiPort===backendPort)backendPort=await freePort();
const origin="http://localhost:"+uiPort;
const env=Object.fromEntries(Object.entries(process.env).filter(([k])=>!/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(k)));
Object.assign(env,{CI:"1",PATCHBOARD_PRIVATE_ROOT:root,PATCHBOARD_PRIVATE_DEV:"1",PATCHBOARD_PRIVATE_ORIGIN:origin,
  PATCHBOARD_PRIVATE_PORT:String(backendPort),PATCHBOARD_OAUTH_CI_RESTART:"1",PATCHBOARD_QA_TYPED_RECORD:"1",
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
let backend,frontend,browser;
const vite=join(webui,"node_modules/.bin/vite");
const options={timeout:30000};
async function startBackend(enabled="1"){
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
async function see(page,value,total=2){
  await expect(grid(page).getByRole("cell",{name:value,exact:true})).toBeVisible(options);
  await expect(grid(page).getByRole("columnheader")).toHaveCount(1);
  await expect(grid(page).getByRole("columnheader",{name:"Title",exact:true})).toBeVisible();
  await expect(page.getByText(total+" matching records",{exact:true})).toBeVisible(options);
  await expect(page.getByText("Internal planning",{exact:true})).toHaveCount(0);
  await expect(page.getByText("Title length",{exact:true})).toHaveCount(0);
}
async function cleared(page,message){
  await expect(page.getByRole("alert").filter({hasText:message})).toBeVisible(options);
  await expect(grid(page)).toHaveCount(0);
  await expect(page.getByText(/matching records/)).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Next page"})).toBeDisabled();
  await expect(page.getByRole("button",{name:"First page"})).toBeDisabled();
}
let stage="startup";
try{
  await execute("pnpm",["auth:migrate:private"],patchboard);
  await startBackend();await startFrontend();
  browser=await chromium.launch({headless:true});
  const owner=await account(),recipient=await account(),op=owner.page,rp=recipient.page;
  assert.notEqual(owner.identity.id,recipient.identity.id);
  assert.notEqual(owner.identity.accountId,recipient.identity.accountId);
  await rp.getByRole("button",{name:"Sign out",exact:true}).click();
  await expect(rp).toHaveURL(origin+"/signin",options);
  stage="seed";
  const created=await api(op,"boards",{title:"Native saved-grid QA"});assert.equal(created.status,201);
  const board=created.body.board_id,dataset=randomUUID(),title=randomUUID(),length=randomUUID();
  const records=[randomUUID(),randomUUID(),randomUUID()];
  const values=["Demo alpha","Internal planning","Demo beta"];
  await offline(async db=>{
    await db.insert(app.typedDatasets,{boardId:board,name:"Demo dataset",schemaVersion:3,state:"active"},{id:dataset}).wait({tier:"global"});
    await db.insert(app.typedFields,{boardId:board,datasetId:dataset,name:"Title",kind:"text"},{id:title}).wait({tier:"global"});
    await db.insert(app.typedFields,{boardId:board,datasetId:dataset,name:"Title length",kind:"computed",computeFromFieldId:title},{id:length}).wait({tier:"global"});
    for(let i=0;i<3;i++)await db.insert(app.typedRecords,{boardId:board,datasetId:dataset,version:7,updatedBy:owner.identity.accountId,cells:{[title]:values[i],[length]:values[i].length}},{id:records[i]}).wait({tier:"global"});
  });
  const definition=(prefix="Demo",direction="asc")=>({name:"Demo items",allowed_field_ids:[title],filter:{op:"text_prefix",field_id:title,value:prefix},sort:{field_id:title,direction}});
  const createdView=await api(op,"records/views/create",{board_id:board,dataset_id:dataset,definition:definition()});assert.equal(createdView.status,201);
  const view=createdView.body.viewId,ref={board_id:board,dataset_id:dataset,view_id:view};
  const path="records/dataset?"+new URLSearchParams({board_id:board,dataset_id:dataset});
  const before=await api(op,path);assert.equal(before.status,200);assert.equal(before.body.records.length,3);
  stage="owner Data";
  await op.goto(origin+"/boards/"+board);
  await op.getByRole("button",{name:"Open board Data"}).click();
  await op.getByRole("button",{name:"Open saved view Demo items"}).click();
  await see(op,"Demo alpha");
  assert.equal(await grid(op).locator("tbody tr").getAttribute("data-record-id"),records[0]);
  await op.screenshot({animations:"disabled",path:join(evidence,"owner-data.png")});
  await op.keyboard.press("Escape");
  stage="copy actual link";
  await op.getByRole("button",{name:"Share this board"}).click();
  const share=op.getByRole("region",{name:"Saved view links"});
  await share.getByRole("button",{name:"Create view link"}).click();
  await share.getByRole("button",{name:"Copy view link"}).click();
  await expect(share.getByText("View link copied.",{exact:true})).toBeVisible(options);
  const copied=await op.evaluate(()=>navigator.clipboard.readText());
  const url=new URL(copied);assert.equal(url.origin,origin);assert.equal(url.pathname,"/shared-view/"+board+"/"+dataset+"/"+view);
  assert.equal(url.search,"");assert.match(url.hash,/^#share=[A-Za-z0-9_-]{43}$/);
  await op.keyboard.press("Escape");
  stage="recipient sign-in";
  const boardFetches=[];
  rp.on("request",request=>{const p=new URL(request.url()).pathname;if(["/patchboard-private/api/board","/patchboard-private/api/canvas","/patchboard-private/api/join"].includes(p))boardFetches.push(p);});
  await rp.goto(copied,{waitUntil:"domcontentloaded"});
  await rp.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await see(rp,"Demo alpha");
  const afterIdentity=(await api(rp,"me")).body;assert.equal(afterIdentity.id,recipient.identity.id);
  assert.equal(new URL(rp.url()).pathname,url.pathname);assert.equal(new URL(rp.url()).hash,url.hash);
  assert.deepEqual(boardFetches,[],"landing must not fetch full board or join");
  assert.deepEqual((await api(rp,"boards")).body.boards,[]);
  assert.deepEqual((await api(rp,"account/connected-apps")).body.grants,[]);
  const boardDenied=await api(rp,"canvas?board_id="+board);assert.equal(boardDenied.status,403);
  const datasetDenied=await api(rp,path);assert.equal(datasetDenied.status,403);
  await rp.getByRole("button",{name:"Next page"}).click();
  await see(rp,"Demo beta");
  assert.equal(await grid(rp).locator("tbody tr").getAttribute("data-record-id"),records[2]);
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-page-two.png")});
  console.log("NATIVE_COPIED_LINK_NONMEMBER_PASS",JSON.stringify({board,dataset,view,records:[records[0],records[2]],field:title,total:2,boardDenied:403,datasetDenied:403,grants:0}));
  stage="definition revision";
  assert.equal((await api(op,"records/views/revise",{...ref,expected_version:1,definition:definition("Demo alpha")})).status,200);
  const stale=rp.waitForResponse(r=>r.url().endsWith("/records/views/query")&&r.status()===409);
  await rp.getByRole("button",{name:"Refresh view"}).click();await stale;
  await see(rp,"Demo alpha",1);
  await expect(rp.getByText("The view changed. Showing a fresh first page.")).toBeVisible(options);
  assert.equal((await api(op,"records/views/revise",{...ref,expected_version:2,definition:definition()})).status,200);
  await rp.getByRole("button",{name:"Refresh view"}).click();await see(rp,"Demo alpha");
  await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta");
  stage="revoke via native Share";
  await op.goto(origin+"/boards/"+board);
  await op.getByRole("button",{name:"Share this board"}).click();
  await op.getByRole("region",{name:"Saved view links"}).getByRole("button",{name:"Revoke view link"}).click();
  await expect(op.getByRole("region",{name:"Saved view links"}).getByText("View link revoked.",{exact:true})).toBeVisible(options);
  const denial=rp.waitForResponse(r=>r.url().endsWith("/records/views/query")&&r.status()===403);
  await rp.getByRole("button",{name:"Refresh view"}).click();await denial;
  await cleared(rp,/revoked or is unavailable/);
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-revoked.png")});
  await rp.reload();await cleared(rp,/revoked or is unavailable/);
  await stop(backend);await startBackend();await rp.reload();await cleared(rp,/revoked or is unavailable/);
  console.log("NATIVE_VIEW_REVOCATION_RELOAD_RESTART_PASS",JSON.stringify({http:403,gridCleared:true}));
  const after=await api(op,path);
  assert.equal(after.status,200);const sorted=x=>[...x].sort((a,b)=>a.id.localeCompare(b.id));
  assert.deepEqual(sorted(after.body.records),sorted(before.body.records));
  assert.deepEqual((await api(rp,"boards")).body.boards,[]);
  assert.deepEqual((await api(rp,"account/connected-apps")).body.grants,[]);
  // The original revoked link remains denied. Issue a distinct active link
  // for the size-boundary fixture, leaving the original three-row audit intact.
  await op.goto(origin+"/boards/"+board);
  await op.getByRole("button",{name:"Share this board"}).click();
  const replacement=op.getByRole("region",{name:"Saved view links"});
  await replacement.getByRole("button",{name:"Create view link"}).click();
  await replacement.getByRole("button",{name:"Copy view link"}).click();
  await expect(replacement.getByText("View link copied.",{exact:true})).toBeVisible(options);
  const activeCopied=await op.evaluate(()=>navigator.clipboard.readText());
  assert.notEqual(activeCopied,copied);
  await rp.goto(activeCopied);await see(rp,"Demo alpha");
  stage="dataset limit";
  const fillers=Array.from({length:498},()=>randomUUID());
  async function add(db,ids){const tx=await db.serializableTransaction(async t=>{
    for(const id of ids)t.insert(app.typedRecords,{boardId:board,datasetId:dataset,version:7,updatedBy:owner.identity.accountId,cells:{[title]:"Private filler",[length]:14}},{id});
  });await tx.wait({timeoutMs:10000});}
  await offline(db=>add(db,fillers.slice(0,497)));
  await rp.reload();await see(rp,"Demo alpha");await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta");
  await offline(db=>add(db,fillers.slice(497)));
  await rp.reload();await cleared(rp,/500-record QA limit/);
  console.log("NATIVE_VIEW_LIMIT_PASS",JSON.stringify({at500:2,at501:"VIEW_DATASET_LIMIT_500",partialGrid:false}));
  await save("native-view-trace",{board,dataset,view,projectedField:title,hiddenField:length,firstRecord:records[0],secondRecord:records[2],hiddenRecord:records[1],
    actualClipboard:true,fragmentOnly:true,sameRecipientAfterPasskey:true,noFullBoardLoad:true,boardDenied:403,datasetDenied:403,
    membershipCount:0,oauthGrants:0,filteredTotal:2,definitionReset:true,at500:2,at501:"VIEW_DATASET_LIMIT_500",
    revokedPageFetch:403,clearedRowsAndCount:true,disabledPagination:true,reloadDenied:true,restartDenied:true,ownerRowsPreserved:3});
  stage="feature off";
  stage="feature off backend";await stop(backend);await startBackend("0");
  stage="feature off build";await stop(frontend);await startFrontend("0");
  stage="feature off board";
  await op.goto(origin+"/boards/"+board);await expect(op.getByRole("button",{name:"Share this board"})).toBeVisible(options);
  await expect(op.getByRole("button",{name:"Open board Data"})).toHaveCount(0);
  stage="feature off Share";
  await op.getByRole("button",{name:"Share this board"}).click();
  await expect(op.getByRole("dialog").getByRole("button",{name:"Create link",exact:true})).toBeVisible(options);
  await expect(op.getByRole("region",{name:"Saved view links"})).toHaveCount(0);
  stage="feature off ordinary invite";
  const ordinary=op.waitForResponse(r=>r.url().endsWith("/api/invite")&&r.request().method()==="POST");
  await op.getByRole("dialog").getByRole("button",{name:"Create link",exact:true}).click();
  assert.equal((await ordinary).status(),201);
  await expect(op.getByRole("dialog").getByLabel("Invitation link")).not.toHaveValue("",options);
  stage="feature off direct view";
  // A fresh document proves the off build, rather than a same-fragment
  // navigation that can retain the previous enabled JavaScript.
  const offPage=await recipient.context.newPage();
  await offPage.goto(activeCopied,{waitUntil:"domcontentloaded"});
  await expect(offPage.getByRole("heading",{name:"Saved view unavailable",exact:true})).toBeVisible(options);
  await expect(grid(offPage)).toHaveCount(0);
  assert.equal((await api(op,"records/views?board_id="+board)).status,404);
  const activeToken=new URLSearchParams(new URL(activeCopied).hash.slice(1)).get("share");
  assert.equal((await api(offPage,"records/views/query",{...ref,share_token:activeToken,page_size:1})).status,404);
  await offPage.close();
  console.log("NATIVE_VIEW_FEATURE_OFF_PASS");
  console.log("NATIVE_SAVED_VIEW_ACCEPTANCE_PASS");
}catch(error){
  // Never print an assertion URL, share token, cursor or cookie.
  console.error("NATIVE_SAVED_VIEW_FAILURE",stage,error?.name??"Error",String(error?.message??"").split("\n")[0].replace(/https?:\/\/[^\s]+/g,"[URL]").replace(/[A-Za-z0-9_-]{43,}/g,"[REDACTED]"));
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  for(const job of jobs)await stop(job);
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
