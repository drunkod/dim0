/** Disposable cross-process catalog recovery. No installed connector, live
 * OAuth tokens or pre-existing board/store. Exactly one Jazz authority open. */
import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {spawn} from "node:child_process";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,rm,writeFile,readFile,access} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {fileURLToPath} from "node:url";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {installGrantAdmissionLedger,admitVerifiedMcpGrant,listCurrentSubjectGrants,authorizeProtectedMcpInvocation} from "../src/account-adapters/grant-admission.ts";
import {installJazzMemberDirectory,rememberJazzMemberIdentity} from "../src/private-auth/member-directory.ts";
import {outstandingMcpWrites} from "../src/account-adapters/grant-write-drain.ts";
import {textTableOperationIdentity} from "../src/typed-catalog.ts";
import {changeSavedTypedView} from "../src/typed-shared-view.ts";

process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const helper=fileURLToPath(new URL("./grant-drain-worker.mjs",import.meta.url));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const zero={datasets:0,fields:0,views:0,receipts:0,events:0,records:0};
const one={...zero,datasets:1,fields:1,views:1,receipts:1,events:1};
const mismatch={status:"RECEIPT_MISMATCH",settled:false};
const unknown={status:"UNKNOWN_OPERATION",settled:false};
const unfenced={status:"WORKER_MAY_STILL_COMMIT",settled:false};

test("catalog leases: observed writer exit, conservative exact evidence, independent Owner projection",async t=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-catalog-crash-worker-"));
  const sqlFile=join(root,"grant.sqlite"),jazzDir=join(root,"jazz");
  const sql=new DatabaseSync(sqlFile);
  sql.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=4000");
  sql.exec("CREATE TABLE patchboard_oauth_grant(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER)");
  installGrantAdmissionLedger(sql);installJazzMemberDirectory(sql);
  const open=()=>createJazz({app,permissions,store:sqlite({path:jazzDir}),authenticate:()=>null}).ready();
  const workers=[];
  let activeJazz=false;
  async function withJazz(action){
    assert.equal(activeJazz,false,"one Jazz authority at a time");
    activeJazz=true;
    let jazz;
    try{jazz=await open();return await action(jazz);}
    finally{await jazz?.close();activeJazz=false;}
  }
  const subject=randomUUID();
  const boards=Object.fromEntries(["before","after","changed","missing"].map(k=>[k,randomUUID()]));
  const grants=Object.fromEntries([...Object.keys(boards),"independent"].map(k=>[k,{
    id:randomUUID(),userId:subject,clientId:"catalog-"+k,boardId:boards[k==="independent"?"after":k]
  }]));
  let actor;
  const command=k=>({boardId:boards[k],actorId:actor,requestId:"qa_"+k+"_"+randomUUID().replaceAll("-",""),
    name:k==="after"?"Recovered catalog":"Catalog "+k,primaryFieldName:"Title",defaultViewName:"All rows"});
  const state=k=>sql.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?").get(grants[k].id);
  const countLeases=k=>outstandingMcpWrites(sql,grants[k].id);
  const getLease=id=>sql.prepare("SELECT * FROM patchboard_mcp_write_lease WHERE id=?").get(id);
  const pending=k=>listCurrentSubjectGrants(sql,subject).grants.find(g=>g.id===grants[k].id).pendingDisconnect;
  async function fork(mode,config){
    const label=randomUUID().replaceAll("-","");
    const path=join(root,label+".json");
    await writeFile(path,JSON.stringify({root,sqlFile,jazzDir,label,...config}),{mode:0o600});
    const child=spawn(process.execPath,["--import","tsx",helper,path,mode],{
      cwd:fileURLToPath(new URL("../",import.meta.url)),stdio:["ignore","pipe","pipe"]
    });
    let stderr="",exitResult;
    child.stdout.resume();child.stderr.on("data",d=>{stderr=(stderr+String(d)).slice(-4000);});
    const exit=new Promise((resolve,reject)=>{
      child.once("error",reject);
      child.once("exit",(code,signal)=>{exitResult={code,signal,stderr};resolve(exitResult);});
    });
    const get=async suffix=>{
      const marker=join(root,label+"."+suffix);
      const end=Date.now()+15000;
      while(Date.now()<end){
        try{await access(marker);return JSON.parse(await readFile(marker,"utf8"));}catch{}
        if(exitResult)throw Error("Child exited before "+suffix+": "+JSON.stringify(exitResult));
        await sleep(20);
      }
      throw Error("CATALOG_WORKER_TIMEOUT:"+suffix+": "+stderr);
    };
    const worker={child,exit,get,release:suffix=>writeFile(join(root,label+"."+suffix),"ok",{mode:0o600}),observed:()=>exitResult};
    workers.push(worker);return worker;
  }
  async function snapshot(k){
    return withJazz(async jazz=>Object.fromEntries(await Promise.all(Object.entries({
      datasets:app.typedDatasets,fields:app.typedFields,views:app.typedViews,
      receipts:app.typedCatalogReceipts,events:app.typedCatalogEvents,records:app.typedRecords
    }).map(async ([name,table])=>[name,(await jazz.db.all(table.where({boardId:boards[k]}),{tier:"remote"})).sort((a,b)=>a.id.localeCompare(b.id))]))));
  }
  const counts=(rows,k)=>({...Object.fromEntries(Object.entries(rows).map(([name,values])=>[name,values.length])),leases:countLeases(k)});
  const expectCounts=(rows,k,expected,leases)=>assert.deepEqual(counts(rows,k),{...expected,leases});
  const intent=k=>"disconnect-"+k;
  async function disconnect(k){
    const w=await fork("disconnect",{grant:grants[k],requestId:intent(k),maxWaitMs:120});
    const result=await w.get("result");assert.equal((await w.exit).code,0);
    return result;
  }
  async function expectPending(k){
    const result=await disconnect(k);
    assert.deepEqual(result,{status:503,error:"WRITE_DRAIN_PENDING"});
    assert.deepEqual(pending(k),{requestId:intent(k),expectedVersion:1});
    assert.equal(state(k).revoked_at_ms,null);
    return result.status;
  }
  async function writer(k){
    const c=command(k),identity=textTableOperationIdentity(c);
    const admission=admitVerifiedMcpGrant(sql,grants[k],new Set(["board:read","board:write","table:create"]));
    assert.ok(admission);
    assert.equal(activeJazz,false);activeJazz=true;
    const w=await fork("catalogWriter",{grant:grants[k],admission,command:c,operation:{tool:"call-api-write",identity}});
    const ready=await w.get("ready");
    assert.equal(ready.pid,w.child.pid);assert.ok(ready.lease?.id);
    const leaseId=ready.lease.id,row=getLease(leaseId);
    assert.equal(row.tool_name,"call-api-write");
    assert.equal(row.grant_id,grants[k].id);assert.equal(row.admission_id,admission.id);
    assert.equal(row.verified_subject_id,subject);assert.equal(row.verified_board_id,boards[k]);
    assert.deepEqual(JSON.parse(row.operation_identity),identity);
    return {...w,k,admission,identity,c,leaseId};
  }
  async function terminate(w){
    assert.equal(w.observed(),undefined,"writer must be alive before kill");
    assert.equal(w.child.kill("SIGKILL"),true);
    const exit=await w.exit;assert.equal(exit.signal,"SIGKILL",exit.stderr);
    assert.equal(w.observed(),exit);
    activeJazz=false;
    return {pid:w.child.pid,signal:exit.signal,leaseId:w.leaseId};
  }
  async function commit(w){
    await w.release("submit");
    const saved=await w.get("committed");
    assert.equal(saved.pid,w.child.pid);assert.equal(saved.leaseId,w.leaseId);
    assert.equal(saved.replayed,false);
    for(const [returned,expected] of [["datasetId","datasetId"],["fieldId","fieldId"],["defaultViewId","viewId"],["receiptId","receiptId"],["eventId","eventId"]])
      assert.equal(saved[returned],w.identity[expected]);
    const result=await w.get("unfenced");
    assert.deepEqual(result,unfenced);
    assert.equal(w.observed(),undefined,"denial was observed while the actual writer was still alive");
    assert.equal(countLeases(w.k),1);
    return saved;
  }
  async function recover(w){
    // Only the parent supervisor observes the exact child's OS exit; do not
    // accept a caller-supplied boolean, a timeout, or a missing process guess.
    assert.equal(w.observed()?.signal,"SIGKILL");
    assert.equal(activeJazz,false);activeJazz=true;
    try{
      const r=await fork("reconcileCatalog",{leaseId:w.leaseId,workerTerminated:w.observed().signal==="SIGKILL"});
      const outcome=await r.get("result");
      w.recoveryPid=r.child.pid;
      assert.notEqual(r.child.pid,w.child.pid);
      assert.equal((await r.exit).code,0);
      return outcome;
    }finally{activeJazz=false;}
  }
  async function denial(w,expected,label){
    const result=await recover(w);assert.deepEqual(result,expected,label);
    assert.equal(countLeases(w.k),1,label);
    assert.equal(state(w.k).revoked_at_ms,null,label);
  }
  try{
    await withJazz(async jazz=>{
      actor=await jazz.createAccountFor(subject);
      for(const [key,id] of Object.entries(boards))
        await jazz.db.insert(app.boards,{ownerId:actor,title:"Isolated "+key},{id}).wait({tier:"global"});
    });
    rememberJazzMemberIdentity(sql,actor,subject);
    for(const g of Object.values(grants))sql.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)")
      .run(g.id,g.userId,g.clientId,g.boardId,Date.now());
    await t.test("crash before submission: no objects; same disconnect stays pending",async()=>{
      const w=await writer("before");
      const exit=await terminate(w);
      const initial=await snapshot("before");expectCounts(initial,"before",zero,1);
      const before=counts(initial,"before");
      const first=await expectPending("before");
      const result=await recover(w);assert.deepEqual(result,{status:"NO_RECEIPT",settled:false});
      const after=await snapshot("before");assert.deepEqual(after,initial);expectCounts(after,"before",zero,1);
      const retry=await expectPending("before");
      console.log("CATALOG_CRASH_BEFORE_TRACE",JSON.stringify({boardId:boards.before,writerExit:exit,before,after:counts(after,"before"),recovery:result.status,disconnect:[first,retry],pendingIntent:pending("before")}));
    });
    await t.test("committed writer: exact durable evidence clears only lease; retries and isolation",async()=>{
      const w=await writer("after");
      const first=await expectPending("after");
      const saved=await commit(w),exit=await terminate(w);
      const initial=await snapshot("after");expectCounts(initial,"after",one,1);
      const before=counts(initial,"after");
      assert.equal(initial.receipts[0].fingerprint,w.identity.fingerprint);
      assert.equal(initial.events[0].receiptId,saved.receiptId);

      // Negative controls change ONLY disposable ledger evidence. Restore it
      // before the positive recovery, never rewrite actual Jazz evidence.
      const updateIdentity=value=>sql.prepare("UPDATE patchboard_mcp_write_lease SET operation_identity=? WHERE id=?").run(value,w.leaseId);
      const rejected=[];
      for(const [key,value] of Object.entries({actorId:randomUUID(),boardId:randomUUID(),requestId:"different_request",
        fingerprint:"0".repeat(64),eventId:randomUUID(),datasetId:randomUUID(),fieldId:randomUUID(),viewId:randomUUID(),receiptId:randomUUID()})){
        updateIdentity(JSON.stringify({...w.identity,[key]:value}));
        await denial(w,key==="receiptId"?{status:"NO_RECEIPT",settled:false}:mismatch,key);
        rejected.push(key);
      }
      for(const value of ["{",null,JSON.stringify({...w.identity,requestId:123}),JSON.stringify({...w.identity,fingerprint:["a".repeat(64)]}),
        JSON.stringify({...w.identity,extra:true}),JSON.stringify({...w.identity,tool:"patch_canvas_entity"}),JSON.stringify({...w.identity,action:"dataset.rename.v1"})]){
        updateIdentity(value);await denial(w,unknown,"malformed/unsupported");rejected.push("malformed/unsupported");
      }
      updateIdentity(JSON.stringify(w.identity));
      for(const [table,column,idCol,id,changed,original] of [
        ["patchboard_mcp_write_lease","verified_subject_id","id",w.leaseId,randomUUID(),subject],
        ["patchboard_mcp_write_lease","verified_board_id","id",w.leaseId,randomUUID(),boards.after],
        ["patchboard_mcp_write_lease","grant_id","id",w.leaseId,grants.independent.id,grants.after.id],
        ["patchboard_oauth_grant","board_id","id",grants.after.id,randomUUID(),boards.after],
        ["patchboard_mcp_admission","client_id","id",w.admission.id,"wrong-client",grants.after.clientId],
        ["patchboard_mcp_admission","board_id","id",w.admission.id,randomUUID(),boards.after],
        ["patchboard_mcp_admission","admitted_scope","id",w.admission.id,"board:write","board:read board:write table:create"],
        ["patchboard_jazz_identity","jazz_account_id","auth_user_id",subject,randomUUID(),actor]
      ]){
        const set=sql.prepare("UPDATE "+table+" SET "+column+"=? WHERE "+idCol+"=?");
        set.run(changed,id);
        // For the substituted grant check the actual lease row, not the old grant count.
        const result=await recover(w);assert.deepEqual(result,mismatch,table+"."+column);
        assert.ok(getLease(w.leaseId));set.run(original,id);
        assert.equal(countLeases("after"),1);
        rejected.push(table+"."+column);
      }
      // Exercise the real admission pruning path using fixture time, not a
      // manual deletion or an expired admission as worker-termination proof.
      const fresh=admitVerifiedMcpGrant(sql,grants.independent,new Set(["board:read"]),w.admission.expiresAtMs+60001);
      assert.ok(fresh);assert.equal(sql.prepare("SELECT 1 FROM patchboard_mcp_admission WHERE id=?").get(w.admission.id),undefined);
      assert.deepEqual(await snapshot("after"),initial);
      assert.equal(countLeases("after"),1);
      const result=await recover(w);assert.deepEqual(result,{status:"PROVED_COMMITTED",settled:true});
      const after=await snapshot("after");assert.deepEqual(after,initial);expectCounts(after,"after",one,0);
      const repeated=await recover(w);assert.deepEqual(repeated,{status:"ALREADY_SETTLED",settled:true});
      assert.deepEqual(await snapshot("after"),initial);
      assert.deepEqual(pending("after"),{requestId:intent("after"),expectedVersion:1});
      const done=await disconnect("after");assert.equal(done.status,200);assert.equal(done.receipt.committedVersion,2);
      assert.ok(state("after").revoked_at_ms);assert.equal(pending("after"),null);
      assert.deepEqual(await disconnect("after"),done);
      assert.equal(admitVerifiedMcpGrant(sql,grants.after,new Set(["board:read"])),null);
      assert.equal(countLeases("before"),1);
      const independent=admitVerifiedMcpGrant(sql,grants.independent,new Set(["board:read"]));
      assert.ok(independent);assert.equal(authorizeProtectedMcpInvocation(sql,independent,grants.independent,"board:read"),true);
      const reader=await fork("catalogOwnerReadback",{grant:grants.independent});
      const read=await reader.get("result");assert.equal((await reader.exit).code,0);
      assert.notEqual(reader.child.pid,w.child.pid);
      assert.equal(read.independentAdmission,true);assert.equal(read.view.singleTextTable,true);
      assert.equal(read.view.datasetId,saved.datasetId);assert.equal(read.view.viewId,saved.defaultViewId);
      assert.deepEqual(read.view.fields,[{id:saved.fieldId,name:"Title"}]);
      assert.equal(read.grid.datasetId,saved.datasetId);assert.equal(read.grid.viewId,saved.defaultViewId);
      assert.deepEqual(read.grid.fields,[saved.fieldId]);
      assert.deepEqual(read.grid.columns,[{id:saved.fieldId,name:"Title"}]);assert.equal(read.grid.total,0);
      console.log("CATALOG_CRASH_AFTER_TRACE",JSON.stringify({boardId:boards.after,writerExit:exit,before,after:counts(after,"after"),unfencedWhileAlive:unfenced.status,
        recovery:result.status,recoveryPid:w.recoveryPid,repeated:repeated.status,admissionPruned:true,disconnect:[first,done.status],disconnectReplay:true,revokedAdmissionDenied:true,independentClientUsable:true,
        ownerReadback:{pid:read.pid,datasetId:read.view.datasetId,fieldId:read.view.fields[0].id,defaultViewId:read.view.viewId,viewVersion:read.view.viewVersion,rows:read.grid.total},
        receiptId:saved.receiptId,eventId:saved.eventId,rejected}));
    });
    await t.test("legitimate Owner changes default view: insufficient original definition, edit survives",async()=>{
      const w=await writer("changed");const saved=await commit(w),exit=await terminate(w);
      const first=await expectPending("changed");
      await withJazz(async jazz=>{
        const changed=await changeSavedTypedView(jazz.db,{boardId:boards.changed,datasetId:saved.datasetId,viewId:saved.defaultViewId,
          actorId:actor,expectedVersion:1,definition:{name:"Owner revised view",allowedFieldIds:[saved.fieldId],
            filter:{op:"text_prefix",fieldId:saved.fieldId,value:"Demo"},sort:{fieldId:saved.fieldId,direction:"desc"}}});
        assert.equal(changed.viewVersion,2);
      });
      const initial=await snapshot("changed");expectCounts(initial,"changed",one,1);
      assert.equal(initial.views[0].definitionVersion,2);
      const result=await recover(w);assert.deepEqual(result,mismatch);
      const after=await snapshot("changed");assert.deepEqual(after,initial);expectCounts(after,"changed",one,1);
      const retry=await expectPending("changed");
      console.log("CATALOG_REVISED_VIEW_TRACE",JSON.stringify({writerExit:exit,before:counts(initial,"changed"),after:counts(after,"changed"),
        recovery:result.status,disconnect:[first,retry],ownerEditPreserved:true,view:after.views[0]}));
    });
    await t.test("missing actual Jazz event cannot settle a genuine receipt",async()=>{
      const w=await writer("missing");const saved=await commit(w);await terminate(w);
      const first=await expectPending("missing");
      await withJazz(jazz=>jazz.db.delete(app.typedCatalogEvents,saved.eventId).wait({tier:"global"}));
      const initial=await snapshot("missing");expectCounts(initial,"missing",{...one,events:0},1);
      await denial(w,mismatch,"event absent");
      assert.deepEqual(await snapshot("missing"),initial);
      assert.equal(await expectPending("missing"),first);
      console.log("CATALOG_MISSING_EVENT_TRACE",JSON.stringify({receiptId:saved.receiptId,missingEventId:saved.eventId,recovery:mismatch.status,counts:counts(initial,"missing"),disconnect:[503,503]}));
    });
  }finally{
    for(const w of workers){if(!w.observed())w.child.kill("SIGKILL");await w.exit.catch(()=>{});}
    sql.close();await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
});
