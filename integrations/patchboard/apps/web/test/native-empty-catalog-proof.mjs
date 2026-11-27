/** Empty-board catalog rehearsal: every catalog mutation through native Owner controls. */
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
const root=await mkdtemp(join(tmpdir(),"patchboard-private-ci-native-catalog-"));
const evidence=process.env.DIM0_NATIVE_CATALOG_EVIDENCE ? resolve(process.env.DIM0_NATIVE_CATALOG_EVIDENCE) : await mkdtemp(join(tmpdir(),"dim0-native-catalog-evidence-"));
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
// The only direct Jazz access in this rehearsal is READ-ONLY inspection of
// the stopped fixture store. No catalog object is seeded or mutated here.
const names=["typedDatasets","typedFields","typedViews","typedRecords","typedCatalogReceipts","typedCatalogEvents","typedPatchReceipts","typedPatchEvents"];
const order=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
const counts=snapshot=>Object.fromEntries(names.map(name=>[name,snapshot[name].length]));
async function snapshot(boardId){
  let result;
  await offline(async db=>{
    result=Object.fromEntries(await Promise.all(names.map(async name=>[
      name,order(await db.all(app[name].where({boardId})))
    ])));
  });
  return result;
}
const tableCounts={typedDatasets:1,typedFields:1,typedViews:1,typedRecords:0,typedCatalogReceipts:1,typedCatalogEvents:1,typedPatchReceipts:0,typedPatchEvents:0};
const finalCounts={...tableCounts,typedViews:2,typedRecords:3,typedPatchReceipts:3,typedPatchEvents:3};
async function openData(page){
  await page.getByRole("button",{name:"Open board Data"}).click();
  const data=page.getByRole("region",{name:"Board Data"});
  await expect(data).toBeVisible(options);
  return data;
}
async function closeData(page){
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region",{name:"Board Data"})).not.toBeVisible(options);
}
async function seeCount(page,n){
  await expect(page.getByText(n+" matching records",{exact:true})).toBeVisible(options);
  await expect(grid(page).getByRole("columnheader")).toHaveCount(1);
  await expect(grid(page).getByRole("columnheader",{name:"Title",exact:true})).toBeVisible();
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

  stage="empty board audit";
  const boardResult=await api(op,"boards",{title:"Native empty catalog QA"});assert.equal(boardResult.status,201);
  const board=boardResult.body.board_id;
  const initial=counts(await snapshot(board));
  assert.deepEqual(initial,Object.fromEntries(names.map(name=>[name,0])));
  await op.goto(origin+"/boards/"+board);
  let data=await openData(op);
  await expect(data.getByText("No saved views on this board.",{exact:true})).toBeVisible(options);
  assert.deepEqual((await api(op,"records/views?board_id="+board)).body.views,[]);

  stage="table lost response and retry";
  const tables=[],tableReplies=[];
  const tablePath="**/patchboard-private/api/records/tables/create";
  const interceptTable=async route=>{
    tables.push(route.request().postDataJSON());
    const reply=await route.fetch();
    assert.equal(reply.status(),201);tableReplies.push(await reply.json());
    if(tables.length===1)await route.abort("failed");else await route.fulfill({response:reply});
  };
  await op.route(tablePath,interceptTable);
  await data.getByLabel("Table name",{exact:true}).fill("Rehearsal");
  await data.getByLabel("Primary text field",{exact:true}).fill("Title");
  await data.getByLabel("Default grid name",{exact:true}).fill("All rows");
  await data.getByRole("button",{name:"Create table",exact:true}).click();
  await expect(data.getByRole("button",{name:"Retry Create table"})).toBeEnabled(options);
  await expect(data.getByLabel("Table name",{exact:true})).toBeDisabled();
  await data.getByRole("button",{name:"Retry Create table"}).click();
  await seeCount(op,0);
  await expect(data.getByRole("heading",{name:"All rows",exact:true})).toBeVisible(options);
  await op.unroute(tablePath,interceptTable);
  assert.equal(tables.length,2);assert.ok(tables[0].request_id);assert.deepEqual(tables[0],tables[1]);
  const created=tableReplies[0],replay=tableReplies[1];
  assert.equal(created.replayed,false);assert.deepEqual(replay,{...created,replayed:true});
  const {datasetId:dataset,fieldId:title,defaultViewId:allRows}=created;
  assert.equal((await api(op,"records/tables/create",{...tables[0],name:"Conflicting definition"})).status,409);
  const firstAudit=await snapshot(board);
  assert.deepEqual(counts(firstAudit),tableCounts);
  assert.equal(firstAudit.typedDatasets[0].id,dataset);
  assert.equal(firstAudit.typedDatasets[0].name,"Rehearsal");
  assert.equal(firstAudit.typedFields[0].id,title);assert.equal(firstAudit.typedFields[0].primary,true);
  assert.equal(firstAudit.typedFields[0].kind,"text");assert.equal(firstAudit.typedFields[0].name,"Title");
  assert.equal(firstAudit.typedViews[0].id,allRows);
  assert.equal(firstAudit.typedCatalogReceipts[0].id,created.receiptId);
  assert.equal(firstAudit.typedCatalogEvents[0].id,created.eventId);
  assert.equal(firstAudit.typedCatalogEvents[0].receiptId,created.receiptId);
  await op.reload();data=await openData(op);
  await expect(data.getByRole("heading",{name:"Rehearsal",exact:true})).toHaveCount(1);
  await expect(data.getByRole("button",{name:"Open saved view All rows",exact:true})).toHaveCount(1);
  await data.getByRole("button",{name:"Open saved view All rows",exact:true}).click();
  await seeCount(op,0);
  console.log("NATIVE_EMPTY_CATALOG_TABLE_RETRY_PASS",JSON.stringify({initial,created,replay,afterReload:counts(firstAudit)}));

  stage="add three rows with first response lost";
  const rows=[],rowReplies=[];
  const rowPath="**/patchboard-private/api/records/rows/create";
  const interceptRow=async route=>{
    rows.push(route.request().postDataJSON());
    const reply=await route.fetch();
    assert.equal(reply.status(),201);rowReplies.push(await reply.json());
    if(rows.length===1)await route.abort("failed");else await route.fulfill({response:reply});
  };
  await op.route(rowPath,interceptRow);
  const add=async(value,n)=>{
    await data.getByLabel("New row Title",{exact:true}).fill(value);
    await data.getByRole("button",{name:"Add row",exact:true}).click();
    if(n===1){
      await expect(data.getByRole("button",{name:"Retry Add row",exact:true})).toBeEnabled(options);
      await expect(data.getByLabel("New row Title",{exact:true})).toBeDisabled();
      await data.getByRole("button",{name:"Retry Add row",exact:true}).click();
    }
    await seeCount(op,n);
    await expect(data.getByLabel("New row Title",{exact:true})).toHaveValue("");
  };
  await add("Demo alpha",1);await add("Internal planning",2);await add("Demo beta",3);
  await op.unroute(rowPath,interceptRow);
  assert.equal(rows.length,4);assert.deepEqual(rows[0],rows[1]);
  assert.deepEqual(rowReplies[1],{...rowReplies[0],replayed:true});
  assert.equal(rowReplies[0].replayed,false);
  assert.equal(new Set([rows[0],rows[2],rows[3]].map(r=>r.request_id)).size,3);
  const added=[rowReplies[0],rowReplies[2],rowReplies[3]];
  for(const r of added){assert.equal(r.updatedBy,owner.identity.accountId);assert.equal(r.version,1);assert.equal(r.fieldId,title);}
  assert.equal((await api(op,"records/rows/create",{...rows[0],value:"Different retry"})).status,409);
  const datasetPath="records/dataset?"+new URLSearchParams({board_id:board,dataset_id:dataset});
  const canonical=await api(op,datasetPath);assert.equal(canonical.status,200);
  assert.deepEqual(canonical.body.records.map(r=>r.id).sort(),added.map(r=>r.recordId).sort());
  assert.deepEqual(canonical.body.records.map(r=>r.cells[title]).sort(),["Demo alpha","Demo beta","Internal planning"]);
  // Observe all three canonical rows through the visible paginated default grid.
  await see(op,"Demo alpha",3);
  await data.getByRole("button",{name:"Next page"}).click();await see(op,"Demo beta",3);
  await data.getByRole("button",{name:"Next page"}).click();
  await expect(grid(op).getByRole("cell",{name:"Internal planning",exact:true})).toBeVisible(options);
  await seeCount(op,3);
  await data.getByRole("button",{name:"First page"}).click();await see(op,"Demo alpha",3);

  stage="save filtered view through Data";
  await data.getByLabel("Saved view name",{exact:true}).fill("Demo items");
  await data.getByLabel("Title starts with",{exact:true}).fill("Demo");
  const saveResponse=op.waitForResponse(r=>r.url().endsWith("/records/views/create")&&r.request().method()==="POST");
  await data.getByRole("button",{name:"Save view",exact:true}).click();
  const saved=await saveResponse;assert.equal(saved.status(),201);
  const savedView=await saved.json();
  const view=savedView.viewId,ref={board_id:board,dataset_id:dataset,view_id:view};
  await see(op,"Demo alpha",2);
  await expect(data.getByRole("heading",{name:"Demo items",exact:true})).toBeVisible(options);
  await op.screenshot({animations:"disabled",path:join(evidence,"owner-filtered.png")});
  await closeData(op);
  const projection=await api(op,"records/views?board_id="+board);
  assert.equal(projection.status,200);
  assert.deepEqual(projection.body.views.map(v=>v.viewId).sort(),[allRows,view].sort());
  const preDenied=await snapshot(board);assert.deepEqual(counts(preDenied),finalCounts);
  assert.equal(preDenied.typedViews.find(v=>v.id===view).filter.value,"Demo");

  stage="copy actual link and sign in as nonmember";
  await op.reload();
  await op.getByRole("button",{name:"Share this board"}).click();
  const share=op.getByRole("group",{name:"Share saved view Demo items",exact:true});
  await share.getByRole("button",{name:"Create view link",exact:true}).click();
  await share.getByRole("button",{name:"Copy view link",exact:true}).click();
  await expect(share.getByText("View link copied.",{exact:true})).toBeVisible(options);
  const copied=await op.evaluate(()=>navigator.clipboard.readText());
  const u=new URL(copied);assert.equal(u.origin,origin);assert.equal(u.pathname,"/shared-view/"+board+"/"+dataset+"/"+view);
  assert.equal(u.search,"");assert.match(u.hash,/^#share=[A-Za-z0-9_-]{43}$/);
  await op.keyboard.press("Escape");
  const boardFetches=[];
  rp.on("request",r=>{const p=new URL(r.url()).pathname;if(["/patchboard-private/api/board","/patchboard-private/api/canvas","/patchboard-private/api/join"].includes(p))boardFetches.push(p);});
  await rp.goto(copied,{waitUntil:"domcontentloaded"});
  await rp.getByRole("button",{name:"Sign in with passkey",exact:true}).click();
  await see(rp,"Demo alpha");
  assert.equal((await api(rp,"me")).body.id,recipient.identity.id);
  assert.deepEqual(boardFetches,[]);
  await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta");
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-page-two.png")});
  const denied={board:(await api(rp,"canvas?board_id="+board)).status,dataset:(await api(rp,datasetPath)).status,
    table:(await api(rp,"records/tables/create",{...tables[0],request_id:randomUUID()})).status,
    row:(await api(rp,"records/rows/create",{...rows[0],request_id:randomUUID()})).status,
    view:(await api(rp,"records/views/create",{board_id:board,dataset_id:dataset,definition:{name:"Denied view",allowed_field_ids:[title],filter:{op:"text_prefix",field_id:title,value:""},sort:{field_id:title,direction:"asc"}}})).status};
  assert.deepEqual(denied,{board:403,dataset:403,table:403,row:403,view:403});
  assert.deepEqual((await api(rp,"boards")).body.boards,[]);
  assert.deepEqual((await api(rp,"account/connected-apps")).body.grants,[]);
  assert.deepEqual((await api(op,"account/connected-apps")).body.grants,[]);

  stage="restart, receipt/event audit and replay";
  const postRestart=await snapshot(board);
  assert.deepEqual(postRestart,preDenied);
  assert.deepEqual(counts(postRestart),finalCounts);
  assert.deepEqual(postRestart.typedRecords.map(r=>r.updatedBy),Array(3).fill(owner.identity.accountId));
  for(const r of added){
    const receipt=postRestart.typedPatchReceipts.find(x=>x.id===r.receiptId);
    const event=postRestart.typedPatchEvents.find(x=>x.id===r.eventId);
    assert.equal(receipt.recordId,r.recordId);assert.equal(receipt.eventId,r.eventId);
    assert.equal(receipt.previousVersion,0);assert.equal(receipt.committedVersion,1);
    assert.equal(receipt.actorId,owner.identity.accountId);
    assert.equal(event.receiptId,r.receiptId);assert.equal(event.recordId,r.recordId);
  }
  const retryRestart=await api(op,"records/tables/create",tables[0]);
  assert.equal(retryRestart.status,201);assert.deepEqual(retryRestart.body,replay);
  const rowRestart=await api(op,"records/rows/create",rows[0]);assert.equal(rowRestart.status,201);assert.deepEqual(rowRestart.body,rowReplies[1]);
  const reopened=await api(op,datasetPath);assert.equal(reopened.status,200);
  assert.deepEqual(order(reopened.body.records),order(canonical.body.records));
  assert.deepEqual((await api(op,"records/views?board_id="+board)).body.views,projection.body.views);
  await rp.reload();await see(rp,"Demo alpha");await rp.getByRole("button",{name:"Next page"}).click();await see(rp,"Demo beta");
  console.log("NATIVE_EMPTY_CATALOG_RESTART_PASS",JSON.stringify({counts:counts(postRestart),catalogReplay:retryRestart.body,denied,actualClipboard:true}));

  stage="native revoke";
  await op.goto(origin+"/boards/"+board);
  await op.getByRole("button",{name:"Share this board"}).click();
  const revoke=op.getByRole("group",{name:"Share saved view Demo items",exact:true});
  await revoke.getByRole("button",{name:"Revoke view link",exact:true}).click();
  await expect(revoke.getByText("View link revoked.",{exact:true})).toBeVisible(options);
  const denial=rp.waitForResponse(r=>r.url().endsWith("/records/views/query")&&r.status()===403);
  await rp.getByRole("button",{name:"Refresh view"}).click();await denial;
  await cleared(rp,/revoked or is unavailable/);
  await rp.screenshot({animations:"disabled",path:join(evidence,"recipient-revoked.png")});
  await rp.reload();await cleared(rp,/revoked or is unavailable/);
  const final=await snapshot(board);assert.deepEqual(final,preDenied);
  await rp.reload();await cleared(rp,/revoked or is unavailable/);
  await op.reload();data=await openData(op);
  await data.getByRole("button",{name:"Open saved view All rows",exact:true}).click();await seeCount(op,3);
  await closeData(op);

  stage="feature off ordinary board share";
  await stop(backend);await startBackend("0");await stop(frontend);await startFrontend("0");
  await op.goto(origin+"/boards/"+board);await expect(op.getByRole("button",{name:"Share this board"})).toBeVisible(options);
  await expect(op.getByRole("button",{name:"Open board Data"})).toHaveCount(0);
  await op.getByRole("button",{name:"Share this board"}).click();
  await expect(op.getByRole("region",{name:"Saved view links"})).toHaveCount(0);
  const ordinary=op.waitForResponse(r=>r.url().endsWith("/api/invite")&&r.request().method()==="POST");
  await op.getByRole("dialog").getByRole("button",{name:"Create link",exact:true}).click();
  assert.equal((await ordinary).status(),201);
  await expect(op.getByRole("dialog").getByLabel("Invitation link")).not.toHaveValue("",options);
  const off={list:(await api(op,"records/views?board_id="+board)).status,
    table:(await api(op,"records/tables/create",{...tables[0],request_id:randomUUID()})).status,
    row:(await api(op,"records/rows/create",{...rows[0],request_id:randomUUID()})).status,
    view:(await api(op,"records/views/create",{board_id:board,dataset_id:dataset,definition:{name:"Feature off",allowed_field_ids:[title],filter:{op:"text_prefix",field_id:title,value:""},sort:{field_id:title,direction:"asc"}}})).status};
  assert.deepEqual(off,{list:404,table:404,row:404,view:404});
  const offPage=await recipient.context.newPage();await offPage.goto(copied,{waitUntil:"domcontentloaded"});
  await expect(offPage.getByRole("heading",{name:"Saved view unavailable",exact:true})).toBeVisible(options);
  await expect(grid(offPage)).toHaveCount(0);
  // Reopen the same Jazz store under the disabled backend; no direct request created rows.
  const afterOff=await snapshot(board);assert.deepEqual(afterOff,final);
  await save("native-empty-catalog-trace",{
    initialCounts:initial,tableCreate:created,tableRetry:replay,identicalTableRequest:true,tableRequestConflict:409,
    afterTableReload:counts(firstAudit),rowCreate:added,rowRetry:rowReplies[1],identicalRowRequest:true,rowRequestConflict:409,
    filteredViewId:view,canonicalTitles:["Demo alpha","Internal planning","Demo beta"],filteredTitles:["Demo alpha","Demo beta"],
    actualClipboard:true,nonmemberPasskey:true,denied,recipientMemberships:0,oauthGrants:0,
    beforeRestart:counts(preDenied),postRestart:counts(postRestart),stableCatalogRetryAfterRestart:true,stableRowRetryAfterRestart:true,writerPreserved:true,
    revokedNextFetch:403,clearedGridAndCount:true,disabledPagination:true,reloadAndRestartDenied:true,ownerRetained:3,
    featureOff:off,ordinaryInviteStatus:201,afterFeatureOff:counts(afterOff)
  });
  console.log("NATIVE_EMPTY_CATALOG_FEATURE_OFF_PASS");
  console.log("NATIVE_EMPTY_CATALOG_ACCEPTANCE_PASS");
}catch(error){
  // Never print an assertion URL, share token, cursor or cookie.
  console.error("NATIVE_EMPTY_CATALOG_FAILURE",stage,error?.name??"Error",String(error?.message??"").split("\n")[0].replace(/https?:\/\/[^\s]+/g,"[URL]").replace(/[A-Za-z0-9_-]{43,}/g,"[REDACTED]"));
  process.exitCode=1;
}finally{
  await browser?.close().catch(()=>{});
  for(const job of jobs)await stop(job);
  await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
}
