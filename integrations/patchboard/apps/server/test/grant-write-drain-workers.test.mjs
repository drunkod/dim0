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
import {
  installGrantAdmissionLedger,admitVerifiedMcpGrant
} from "../src/account-adapters/grant-admission.ts";
import {
  beginProtectedMcpWriteLease,settleProtectedMcpWriteLease,outstandingMcpWrites,reconcileTerminatedCanvasWriteLease
} from "../src/account-adapters/grant-write-drain.ts";
import {
  patchCanvasLabelMarkdown,canvasPatchOperationIdentity
} from "../src/canvas-versioned-patch.ts";

import {getCanvasEntity} from "../src/canvas-entity-service.ts";

process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const helper=fileURLToPath(new URL("./grant-drain-worker.mjs",import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function eventually(action,label){
  for(let n=0;n<300;n++){
    try{const value=await action();if(value)return value;}catch{}
    await sleep(20);
  }
  throw new Error("WORKER_BARRIER_TIMEOUT:"+label);
}
test("legacy #16 lease migration retains unresolved rows and is idempotent",async()=>{
  const sql=new DatabaseSync(":memory:");
  try{
    sql.exec(`CREATE TABLE patchboard_oauth_grant(
      id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
      board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER);
      CREATE TABLE patchboard_mcp_write_lease(
        id TEXT PRIMARY KEY,grant_id TEXT NOT NULL,admission_id TEXT NOT NULL,opened_at_ms INTEGER NOT NULL);
      INSERT INTO patchboard_mcp_write_lease VALUES('old','grant','admission',1);`);
    installGrantAdmissionLedger(sql);
    installGrantAdmissionLedger(sql);
    assert.deepEqual({...sql.prepare("SELECT * FROM patchboard_mcp_write_lease WHERE id='old'").get()},
      {id:"old",grant_id:"grant",admission_id:"admission",opened_at_ms:1,
        tool_name:"unattributed",operation_identity:null,verified_subject_id:null,verified_board_id:null});
    assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,null,"old",{workerTerminated:true}),
      {status:"UNKNOWN_OPERATION",settled:false});
    assert.equal(outstandingMcpWrites(sql,"grant"),1);
  }finally{sql.close();}
});

test("MCP grant drain: distinct OS processes serialize SQL while one Jazz authority owns the store",async t=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-real-worker-processes-"));
  const sqlFile=join(root,"grant.sqlite"),jazzDir=join(root,"jazz");
  const sql=new DatabaseSync(sqlFile);
  sql.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000");
  sql.exec(`CREATE TABLE patchboard_oauth_grant(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
    board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER)`);
  installGrantAdmissionLedger(sql);
  const openJazz=()=>createJazz({app,permissions,store:sqlite({path:jazzDir}),
    authenticate:()=>null}).ready();
  let jazz=await openJazz();
  const subject=randomUUID(),actor=await jazz.createAccountFor(subject);
  const owner=await jazz.createAccountFor(randomUUID());
  const boardId=randomUUID();
  const rows={first:randomUUID(),denied:randomUUID(),crashed:randomUUID(),
    recovered:randomUUID(),independent:randomUUID(),forged:randomUUID()};
  const patch=(id,requestId)=>({
    boardId,actorId:actor,id,expectedVersion:7,requestId,
    patch:{label_markdown:"written-"+requestId}
  });
  const grants=Object.fromEntries(["A","B","C","D","E","F"].map(key=>[
    key,{id:randomUUID(),userId:subject,clientId:"qa-worker-"+key,boardId}
  ]));
  for(const grant of Object.values(grants))sql.prepare(`INSERT INTO patchboard_oauth_grant
    (id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)`).run(
      grant.id,grant.userId,grant.clientId,grant.boardId,Date.now());
  const admissions=Object.fromEntries(Object.entries(grants).map(([key,g])=>[
    key,admitVerifiedMcpGrant(sql,g,new Set(["board:read","board:write"]))
  ]));
  assert.ok(Object.values(admissions).every(Boolean));
  const leaseOp=(command)=>({
    tool:"patch_canvas_entity",identity:canvasPatchOperationIdentity(command)
  });
  let count=()=>jazz.db.all(app.canvasPatchReceipts.where({boardId}));
  const readRow=id=>jazz.db.one(app.canvasEntities.where({id}));
  let workers=[];
  async function spawnWorker(mode,config){
    const label=randomUUID().replaceAll("-","");
    const path=join(root,label+".json");
    await writeFile(path,JSON.stringify({root,sqlFile,jazzDir,label,...config}),
      {mode:0o600});
    const child=spawn(process.execPath,["--import","tsx",helper,path,mode],{
      cwd:fileURLToPath(new URL("../",import.meta.url)),stdio:["ignore","pipe","pipe"]
    });
    let stderr="";
    child.stderr.on("data",data=>{stderr=(stderr+data.toString()).slice(-3000);});
    child.stdout.resume();
    const exit=new Promise(resolve=>child.once("exit",(code,signal)=>
      resolve({code,signal,stderr})));
    const get=async suffix=>eventually(async()=>{
      const marker=join(root,label+"."+suffix);
      await access(marker);
      return JSON.parse(await readFile(marker,"utf8"));
    },label+"/"+suffix);
    const release=()=>writeFile(join(root,label+".release"),"ok",{mode:0o600});
    const worker={child,exit,get,release,label};
    workers.push(worker);
    return worker;
  }
  const grantState=key=>sql.prepare(`SELECT grant_version,revoked_at_ms
    FROM patchboard_oauth_grant WHERE id=?`).get(grants[key].id);
  try{
    await jazz.db.insert(app.boards,{ownerId:owner,title:"Cross-worker QA"},
      {id:boardId}).wait({tier:"global"});
    await jazz.db.insert(app.boardMembers,{boardId,userId:actor,role:"editor"}).wait({tier:"global"});
    for(const id of Object.values(rows))await jazz.db.insert(app.canvasEntities,{
      boardId,kind:"node",version:7,updatedBy:owner,
      payload:{id,graphUid:boardId,type:"note",version:7,
        label:{markdown:"original"},content:{markdown:"preserve"}}
    },{id}).wait({tier:"global"});

    await t.test("A lease in process A blocks revoke in process B until Jazz v8 authority and lease release",async()=>{
      const request=patch(rows.first,"crossproc-first");
      const A=await spawnWorker("reserve",{
        grant:grants.A,admission:admissions.A,operation:leaseOp(request)});
      const ready=await A.get("ready");
      assert.ok(ready.lease?.id);
      const B=await spawnWorker("disconnect",{
        grant:grants.A,requestId:"crossproc-revoke-A",maxWaitMs:5000});
      await eventually(()=>sql.prepare(`SELECT 1 FROM patchboard_grant_disconnect_pending
        WHERE grant_id=?`).get(grants.A.id),"pending across workers");
      assert.equal(grantState("A").revoked_at_ms,null);
      assert.equal(outstandingMcpWrites(sql,grants.A.id),1);
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.A,grants.A),null);
      const result=await patchCanvasLabelMarkdown(jazz.db,request);
      assert.equal(result.version,8);
      assert.equal(result.updatedBy,actor);
      await A.release();
      await A.get("settled");
      assert.equal((await A.exit).code,0);
      const completed=await B.get("result");
      assert.equal((await B.exit).code,0);
      assert.equal(completed.status,200);
      assert.equal(completed.receipt.committedVersion,2);
      assert.ok(grantState("A").revoked_at_ms);
      assert.equal(outstandingMcpWrites(sql,grants.A.id),0);
      assert.equal((await readRow(rows.first)).version,8);
      assert.equal((await count()).length,1);
    });

    await t.test("revoke in process B before A's lease denies a previously admitted callback",async()=>{
      const B=await spawnWorker("disconnect",{
        grant:grants.C,requestId:"crossproc-revoke-C"});
      assert.equal((await B.get("result")).status,200);
      assert.equal((await B.exit).code,0);
      const A=await spawnWorker("reserveOnce",{
        grant:grants.C,admission:admissions.C,
        operation:leaseOp(patch(rows.denied,"crossproc-denied"))});
      assert.equal((await A.get("result")).lease,null);
      assert.equal((await A.exit).code,0);
      assert.equal((await readRow(rows.denied)).version,7);
      assert.equal((await count()).length,1);
    });

    await t.test("crash after lease with no Jazz receipt stays pending, even across worker restart",async()=>{
      const A=await spawnWorker("reserve",{
        grant:grants.D,admission:admissions.D,
        operation:leaseOp(patch(rows.crashed,"unknown-no-receipt"))});
      const held=await A.get("ready");
      assert.ok(held.lease?.id);
      A.child.kill("SIGKILL");
      assert.equal((await A.exit).signal,"SIGKILL");
      const B=await spawnWorker("disconnect",{
        grant:grants.D,requestId:"crossproc-revoke-D",maxWaitMs:100});
      assert.equal((await B.get("result")).status,503);
      assert.equal((await B.exit).code,0);
      assert.equal(grantState("D").revoked_at_ms,null);
      // Jazz SQLite has ONE writer in this topology. Shut it down before the
      // recovery worker opens it independently: no simultaneous writer claim.
      await jazz.close();
      const recovery=await spawnWorker("reconcile",{
        leaseId:held.lease.id,workerTerminated:true});
      assert.deepEqual(await recovery.get("result"),
        {status:"NO_RECEIPT",settled:false});
      assert.equal((await recovery.exit).code,0);
      assert.equal(outstandingMcpWrites(sql,grants.D.id),1);
      jazz=await openJazz();
      const unknown=await getCanvasEntity(jazz.db,boardId,owner,rows.crashed);
      assert.equal(unknown.version,7);
      assert.equal(unknown.updatedBy,owner);
      assert.equal((await jazz.db.all(app.canvasPatchReceipts.where({entityId:rows.crashed}))).length,0);
      assert.equal((await jazz.db.all(app.canvasPatchEvents.where({entityId:rows.crashed}))).length,0);
      const retry=await spawnWorker("disconnect",{grant:grants.D,requestId:"crossproc-revoke-D",maxWaitMs:100});
      assert.equal((await retry.get("result")).status,503);
      assert.equal((await retry.exit).code,0);
      console.log("CRASH_BEFORE_COMMIT",JSON.stringify({exit:"SIGKILL",version:7,writer:unknown.updatedBy,leases:1,receipts:0,events:0,disconnect:[503,503],recovery:"NO_RECEIPT"}));
    });

    await t.test("crash after exact Jazz receipt: new worker verifies event and settles once",async()=>{
      const request=patch(rows.recovered,"worker-durable-event");
      await jazz.close();
      const A=await spawnWorker("reserve",{
        grant:grants.E,admission:admissions.E,operation:leaseOp(request),command:request});
      const held=await A.get("ready");
      const result=await A.get("committed");
      assert.deepEqual(await A.get("unfenced"),{status:"WORKER_MAY_STILL_COMMIT",settled:false});
      assert.equal(outstandingMcpWrites(sql,grants.E.id),1);
      assert.equal(A.child.exitCode,null);
      assert.equal(result.version,8);
      assert.equal(result.receiptId,
        canvasPatchOperationIdentity(request).receiptId);
      A.child.kill("SIGKILL");
      assert.equal((await A.exit).signal,"SIGKILL");
      const B=await spawnWorker("disconnect",{
        grant:grants.E,requestId:"crossproc-revoke-E",maxWaitMs:100});
      assert.equal((await B.get("result")).status,503);
      assert.equal((await B.exit).code,0);
      assert.equal(grantState("E").revoked_at_ms,null);
      // Simulate the normal 60s admission-receipt housekeeping before a
      // delayed recovery worker runs. Lease's verified SQL subject/board
      // survive independently and may still be reconciled.
      sql.prepare("DELETE FROM patchboard_mcp_admission WHERE id=?")
        .run(admissions.E.id);
      const unsafe=await spawnWorker("reconcile",{
        leaseId:held.lease.id,workerTerminated:false});
      assert.deepEqual(await unsafe.get("result"),
        {status:"WORKER_MAY_STILL_COMMIT",settled:false});
      assert.equal((await unsafe.exit).code,0);
      const recovered=await spawnWorker("reconcile",{
        leaseId:held.lease.id,workerTerminated:true});
      assert.deepEqual(await recovered.get("result"),
        {status:"PROVED_COMMITTED",settled:true});
      assert.equal((await recovered.exit).code,0);
      const again=await spawnWorker("reconcile",{
        leaseId:held.lease.id,workerTerminated:true});
      assert.deepEqual(await again.get("result"),
        {status:"ALREADY_SETTLED",settled:true});
      assert.equal((await again.exit).code,0);
      assert.equal(outstandingMcpWrites(sql,grants.E.id),0);
      const retry=await spawnWorker("disconnect",{
        grant:grants.E,requestId:"crossproc-revoke-E"});
      const finished=await retry.get("result");
      assert.equal(finished.status,200);
      assert.equal(finished.receipt.committedVersion,2);
      assert.ok(grantState("E").revoked_at_ms);
      const repeated=await spawnWorker("disconnect",{grant:grants.E,requestId:"crossproc-revoke-E"});
      assert.deepEqual(await repeated.get("result"),finished);
      assert.equal((await repeated.exit).code,0);
      assert.equal((await retry.exit).code,0);
      jazz=await openJazz();
      const saved=await getCanvasEntity(jazz.db,boardId,owner,rows.recovered);
      assert.equal(saved.version,8);
      assert.equal(saved.updatedBy,actor);
      assert.equal(saved.payload.label.markdown,request.patch.label_markdown);
      const receipt=(await jazz.db.one(app.canvasPatchReceipts.where({
        id:result.receiptId
      })));
      const event=(await jazz.db.one(app.canvasPatchEvents.where({
        id:result.eventId
      })));
      assert.equal(receipt?.eventId,event?.id);
      assert.equal(event?.receiptId,receipt?.id);
      assert.equal(receipt?.actorId,actor);
      assert.equal((await count()).length,2);
      assert.equal((await jazz.db.all(app.canvasPatchReceipts.where({entityId:rows.recovered}))).length,1);
      assert.equal((await jazz.db.all(app.canvasPatchEvents.where({entityId:rows.recovered}))).length,1);
      console.log("CRASH_AFTER_COMMIT",JSON.stringify({exit:"SIGKILL",version:saved.version,writer:saved.updatedBy,owner,leases:0,receipts:1,events:1,disconnect:[503,200],recovery:["WORKER_MAY_STILL_COMMIT","PROVED_COMMITTED","ALREADY_SETTLED"],receiptId:receipt.id,eventId:event.id,admissionPruned:true}));
    });

    await t.test("other client still commits; forged fingerprint never releases its pending lease",async()=>{
      const b=beginProtectedMcpWriteLease(sql,admissions.B,grants.B,{
        tool:"patch_canvas_entity",
        identity:canvasPatchOperationIdentity(patch(rows.independent,"independent-B"))
      });
      assert.ok(b);
      const committed=await patchCanvasLabelMarkdown(jazz.db,
        patch(rows.independent,"independent-B"));
      assert.equal(committed.version,8);
      // Client B settles through the exact normal SQL lease API.
      settleProtectedMcpWriteLease(sql,b);
      const request=patch(rows.forged,"forged-hash");
      const bad={...canvasPatchOperationIdentity(request),
        fingerprint:"0".repeat(64)};
      const F=await spawnWorker("reserve",{
        grant:grants.F,admission:admissions.F,
        operation:{tool:"patch_canvas_entity",identity:bad}});
      const held=await F.get("ready");
      await patchCanvasLabelMarkdown(jazz.db,request);
      F.child.kill("SIGKILL");
      assert.equal((await F.exit).signal,"SIGKILL");
      await jazz.close();
      const worker=await spawnWorker("reconcile",{
        leaseId:held.lease.id,workerTerminated:true});
      assert.deepEqual(await worker.get("result"),
        {status:"RECEIPT_MISMATCH",settled:false});
      assert.equal((await worker.exit).code,0);
      assert.equal(outstandingMcpWrites(sql,grants.F.id),1);
      assert.equal(grantState("F").revoked_at_ms,null);
      jazz=await openJazz();
      assert.equal((await readRow(rows.independent)).version,8);
      assert.equal((await readRow(rows.forged)).version,8);
      assert.equal((await count()).length,4);
      const original=canvasPatchOperationIdentity(request);
      const change=sql.prepare("UPDATE patchboard_mcp_write_lease SET operation_identity=? WHERE id=?");
      for(const value of ["null","[]","42","{",JSON.stringify({...original,expectedVersion:"7"}),JSON.stringify({...original,actorId:17})]){
        change.run(value,held.lease.id);
        assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,jazz.db,held.lease.id,{workerTerminated:true}),{status:"UNKNOWN_OPERATION",settled:false},value);
      }
      for(const identity of [
        {...original,actorId:randomUUID()},
        {...original,boardId:randomUUID()},
        {...original,eventId:randomUUID()},
      ]){
        change.run(JSON.stringify(identity),held.lease.id);
        assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,jazz.db,held.lease.id,{workerTerminated:true}),{status:"RECEIPT_MISMATCH",settled:false});
      }
      change.run(JSON.stringify(original),held.lease.id);
      const priorEvents=await jazz.db.all(app.canvasPatchEvents.where({boardId}));
      assert.equal(priorEvents.length,4);
      await jazz.db.delete(app.canvasPatchEvents,original.eventId).wait({tier:"global"});
      assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,jazz.db,held.lease.id,{workerTerminated:true}),{status:"RECEIPT_MISMATCH",settled:false});
      assert.equal((await jazz.db.all(app.canvasPatchEvents.where({boardId}))).length,3);
      assert.equal(outstandingMcpWrites(sql,grants.F.id),1);
      sql.prepare("UPDATE patchboard_mcp_write_lease SET verified_subject_id=NULL WHERE id=?").run(held.lease.id);
      assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,jazz.db,held.lease.id,{workerTerminated:true}),{status:"UNKNOWN_OPERATION",settled:false});
      sql.prepare("UPDATE patchboard_mcp_write_lease SET tool_name='unattributed',operation_identity=NULL WHERE id=?").run(held.lease.id);
      assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,jazz.db,held.lease.id,{workerTerminated:true}),{status:"UNKNOWN_OPERATION",settled:false});
      assert.equal(outstandingMcpWrites(sql,grants.F.id),1);
      assert.equal((await count()).length,4);
      console.log("ACC051_DISTINCT_WORKER_SQL_JAZZ_RECOVERY_PASS",JSON.stringify({
        boardId,writerActorId:actor,grantA:grants.A.id,
        pendingUnknownGrant:grants.D.id,recoveredGrant:grants.E.id,
        mismatchedGrant:grants.F.id,
        versions:{leaseFirst:8,revokeFirst:7,unknown:7,recovered:8,
          clientB:8,forgedReceipt:8},
        receipts:4,eventsAfterDeliberateFixtureDeletion:3,pendingUnknownBlocked:true,
        provedRecoveryExactlyOnce:true,twoProcessesWithSharedSql:true,
        simultaneousJazzSQLiteWriters:false
      }));
    });
  }finally{
    for(const w of workers)if(w.child.exitCode===null && w.child.signalCode===null)
      w.child.kill("SIGKILL");
    await Promise.all(workers.map(w=>w.exit));
    await jazz.close();
    sql.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:150});
  }
});
