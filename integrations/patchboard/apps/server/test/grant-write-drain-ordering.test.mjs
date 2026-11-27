import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {
  installGrantAdmissionLedger,admitVerifiedMcpGrant,
  authorizeProtectedMcpInvocation,revokeGrantWithReceipt,GrantDrainPending,listCurrentSubjectGrants
} from "../src/account-adapters/grant-admission.ts";
import {
  beginProtectedMcpWriteLease,settleProtectedMcpWriteLease,
  disconnectAfterMcpWritesDrain,outstandingMcpWrites,runReservedMcpWrite
} from "../src/account-adapters/grant-write-drain.ts";
import {patchCanvasLabelMarkdown} from "../src/canvas-versioned-patch.ts";

process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
test("ACC-051 deterministic two-client SQL→Jazz revocation ordering, persisted versions and events",async t=>{
  const root=await mkdtemp(join(tmpdir(),"dim0-acc051-revoke-order-"));
  const sqlFile=join(root,"auth.sqlite");
  let sql=new DatabaseSync(sqlFile);
  sql.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
  sql.exec(`CREATE TABLE patchboard_oauth_grant(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
    board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER)`);
  installGrantAdmissionLedger(sql);
  const open=()=>createJazz({app,permissions:privatePermissions,
    store:sqlite({path:join(root,"jazz")}),authenticate:()=>null}).ready();
  let server=await open();
  const boardId=randomUUID(),actor=randomUUID();
  const ids={leased:randomUUID(),revoked:randomUUID(),clientB:randomUUID(),browser:randomUUID()};
  const grants={A:{id:randomUUID(),userId:randomUUID(),clientId:"test-client-A",boardId},
    B:{id:randomUUID(),userId:randomUUID(),clientId:"test-client-B",boardId},
    C:{id:randomUUID(),userId:randomUUID(),clientId:"test-client-C",boardId}};
  const permission=new Set(["board:read","board:write"]);
  const payload=id=>({id,graphUid:boardId,type:"note",version:7,
    label:{markdown:"seven"},content:{markdown:"preserved"}});
  const cmd=(id,key,actorId=actor)=>({boardId,id,actorId,
    expectedVersion:7,requestId:key,patch:{label_markdown:"eight-"+key}});
  const count=async()=>({
    receipts:(await server.db.all(app.canvasPatchReceipts.where({boardId}))).length,
    events:(await server.db.all(app.canvasPatchEvents.where({boardId}))).length
  });
  const row=id=>server.db.one(app.canvasEntities.where({id}));
  const grantStatus=id=>sql.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?").get(id);
  const settings=(g,key,options)=>disconnectAfterMcpWritesDrain(sql,g.userId,{
    grantId:g.id,clientId:g.clientId,expectedVersion:1,requestId:key
  },options);
  try {
    await server.db.insert(app.boards,{ownerId:actor,title:"Revocation ordering"},
      {id:boardId}).wait({tier:"global"});
    for(const id of Object.values(ids))await server.db.insert(app.canvasEntities,{
      boardId,kind:"node",payload:payload(id),version:7,updatedBy:actor
    },{id}).wait({tier:"global"});
    for(const grant of Object.values(grants))sql.prepare(
      "INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)"
    ).run(grant.id,grant.userId,grant.clientId,grant.boardId,Date.now());
    const admissions=Object.fromEntries(Object.entries(grants).map(([k,g])=>[
      k,admitVerifiedMcpGrant(sql,g,permission)
    ]));
    for(const a of Object.values(admissions))assert.ok(a);

    await t.test("C: A reserved a lease before disconnect; settings cannot confirm until v8 authority receipt",async()=>{
      const lease=beginProtectedMcpWriteLease(sql,admissions.A,grants.A);
      assert.ok(lease);
      let resolveCommit;
      const held=new Promise(resolve=>{resolveCommit=resolve;});
      const inFlight=held.then(async()=>{
        assert.equal(authorizeProtectedMcpInvocation(sql,admissions.A,grants.A,
          "board:write",Date.now(),lease.id),true);
        const saved=await patchCanvasLabelMarkdown(server.db,
          cmd(ids.leased,"leased-A"));
        settleProtectedMcpWriteLease(sql,lease);
        return saved;
      });
      let confirmed=false;
      const disconnect=settings(grants.A,"disconnect-after-reserve",{maxWaitMs:5000})
        .then(x=>{confirmed=true;return x;});
      assert.ok(sql.prepare("SELECT 1 FROM patchboard_grant_disconnect_pending WHERE grant_id=?").get(grants.A.id));
      assert.equal(confirmed,false,"UI must not show Disconnected");
      assert.equal(grantStatus(grants.A.id).revoked_at_ms,null);
      assert.equal(outstandingMcpWrites(sql,grants.A.id),1);
      assert.equal(authorizeProtectedMcpInvocation(sql,admissions.A,grants.A,
        "board:write"),false,"new callback denied while disconnect pending");
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.A,grants.A),null);
      resolveCommit();
      const committed=await inFlight;
      assert.equal(committed.version,8);
      assert.equal(committed.updatedBy,actor);
      assert.equal((await count()).events,1);
      const result=await disconnect;
      assert.equal(confirmed,true);
      assert.equal(result.committedVersion,2);
      assert.ok(grantStatus(grants.A.id).revoked_at_ms);
      assert.equal(outstandingMcpWrites(sql,grants.A.id),0);
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.A,grants.A),null);
      assert.equal((await row(ids.leased)).version,8);
    });
    await t.test("N: new A2 callback admitted before revoke but not yet leased must deny after confirmation",async()=>{
      assert.equal(admissions.C.admittedScopes.includes("board:write"),true);
      // Callback already had valid HTTP admission. Pause immediately before
      // the SQL lease reservation, then the actual settings revoke commits.
      const revoke=await settings(grants.C,"disconnect-before-reserve");
      assert.equal(revoke.committedVersion,2);
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.C,grants.C),null);
      assert.equal((await row(ids.revoked)).version,7);
      assert.deepEqual(await count(),{receipts:1,events:1});
    });
    await t.test("P: separate client B and owner's browser retain v8 write authority",async()=>{
      const lease=beginProtectedMcpWriteLease(sql,admissions.B,grants.B);
      assert.ok(lease);
      const viaB=await patchCanvasLabelMarkdown(server.db,cmd(ids.clientB,"client-B"));
      settleProtectedMcpWriteLease(sql,lease);
      assert.equal(viaB.version,8);
      const browser=await patchCanvasLabelMarkdown(server.db,cmd(ids.browser,"owner-browser"));
      assert.equal(browser.version,8);
      assert.equal(outstandingMcpWrites(sql,grants.B.id),0);
      assert.equal(grantStatus(grants.B.id).revoked_at_ms,null);
      assert.deepEqual(await count(),{receipts:3,events:3});
    });
    await t.test("S: unknown Jazz outcome: timeout returns no 200 and pending fence survives SQLite reopen",async()=>{
      const lease=beginProtectedMcpWriteLease(sql,admissions.B,grants.B);
      assert.ok(lease);
      await assert.rejects(()=>settings(grants.B,"disconnect-unknown",{
        maxWaitMs:25,pollMs:5
      }),GrantDrainPending);
      assert.equal(grantStatus(grants.B.id).revoked_at_ms,null);
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.B,grants.B),null);
      assert.throws(()=>revokeGrantWithReceipt(sql,grants.B.id,"provider-unsafe"),
        GrantDrainPending);
      sql.close();
      sql=new DatabaseSync(sqlFile);
      sql.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000");
      installGrantAdmissionLedger(sql);
      assert.equal(outstandingMcpWrites(sql,grants.B.id),1);
      assert.equal(beginProtectedMcpWriteLease(sql,admissions.B,grants.B),null);
      assert.equal(grantStatus(grants.B.id).revoked_at_ms,null);
      assert.equal((await count()).events,3);
      // Reopen the ledger and retry the original pending intent; no fabricated
      // settlement. Worker reconciliation belongs in the next PR.
      const pending=listCurrentSubjectGrants(sql,grants.B.userId).grants[0].pendingDisconnect;
      assert.deepEqual(pending,{requestId:"disconnect-unknown",expectedVersion:1});
      await assert.rejects(()=>settings(grants.B,"disconnect-unknown",{maxWaitMs:0}),GrantDrainPending);
      await assert.rejects(()=>settings(grants.B,"changed-intent",{maxWaitMs:0}),/STALE_STATE/);
      assert.equal(outstandingMcpWrites(sql,grants.B.id),1);
      assert.equal(grantStatus(grants.B.id).revoked_at_ms,null);
    });
    await t.test("R: Jazz + SQL restart preserve every v8 writer, receipt, event, grant version",async()=>{
      await server.close();server=await open();
      for(const id of [ids.leased,ids.clientB,ids.browser]){
        assert.equal((await row(id)).version,8);
        assert.equal((await row(id)).updatedBy,actor);
      }
      assert.equal((await row(ids.revoked)).version,7);
      assert.deepEqual(await count(),{receipts:3,events:3});
      for(const grant of Object.values(grants)){
        assert.equal(grantStatus(grant.id).grant_version,
          grant===grants.A || grant===grants.C ? 2:1);
      }
      assert.equal(sql.prepare(
        "SELECT COUNT(*) AS n FROM patchboard_grant_security_event").get().n,2);
      console.log("ACC051_TWO_CLIENT_DRAIN_SQL_JAZZ_PASS",JSON.stringify({
        boardId,entityIds:ids,writerActorId:actor,
        grants:Object.fromEntries(Object.entries(grants).map(([k,g])=>[k,g.id])),
        versions:{leased:8,revoked:7,clientB:8,browser:8},
        receiptCount:3,eventCount:3,revocationEvents:2,
        disconnectedBoundary:"HTTP 200 only after Jazz wait and SQL lease release",
        ambiguousLeaseBlocksConfirmation:true
      }));
    });
  } finally {
    await server.close();sql.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});


test("only confirmed SDK outcomes settle a reservation; unknown replies and throws stay outstanding",async()=>{
  const db=new DatabaseSync(":memory:");
  try {
    db.exec("CREATE TABLE patchboard_oauth_grant(id TEXT PRIMARY KEY,user_id TEXT,client_id TEXT,board_id TEXT,created_at_ms INTEGER,revoked_at_ms INTEGER)");
    installGrantAdmissionLedger(db);
    const grant={id:randomUUID(),userId:randomUUID(),clientId:"client",boardId:randomUUID()};
    db.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)").run(grant.id,grant.userId,grant.clientId,grant.boardId,Date.now());
    const admission=admitVerifiedMcpGrant(db,grant,new Set(["board:write"]));
    const reserve=()=>beginProtectedMcpWriteLease(db,admission,grant);
    for(const reply of [
      {content:[{type:"text",text:"{}"}]},
      {isError:true,content:[{type:"text",text:"VERSION_CONFLICT"}]},
      {isError:true,content:[{type:"text",text:"WRITE_REJECTED"}]},
      {isError:true,content:[{type:"text",text:"GRANT_ADMISSION_EXPIRED_OR_INVALID"}]},
    ]){
      const lease=reserve();assert.ok(lease);
      assert.deepEqual(await runReservedMcpWrite(db,lease,async()=>reply),reply);
      assert.equal(outstandingMcpWrites(db,grant.id),0);
    }
    for(const reply of [
      {isError:true,content:[{type:"text",text:"COMMIT_OUTCOME_UNKNOWN: retry same request_id"}]},
      {isError:true,content:[{type:"text",text:"WRITE_FAILED: Check read_board before retrying"}]},
      {isError:true,content:[{type:"text",text:"VERSION_CONFLICT: uncertain"}]},
      undefined,
    ]){
      const lease=reserve();assert.ok(lease);
      const before=outstandingMcpWrites(db,grant.id);
      await runReservedMcpWrite(db,lease,async()=>reply);
      assert.equal(outstandingMcpWrites(db,grant.id),before);
    }
    const lease=reserve();
    await assert.rejects(runReservedMcpWrite(db,lease,async()=>{throw new Error("transport or Jazz failure");}),/transport or Jazz failure/);
    assert.equal(outstandingMcpWrites(db,grant.id),5);
    await assert.rejects(disconnectAfterMcpWritesDrain(db,grant.userId,{grantId:grant.id,clientId:grant.clientId,expectedVersion:1,requestId:"uncertain"},{maxWaitMs:0}),GrantDrainPending);
    assert.equal(beginProtectedMcpWriteLease(db,admission,grant),null);
  }finally{db.close();}
});
