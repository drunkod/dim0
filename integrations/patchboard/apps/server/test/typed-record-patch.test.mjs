import test from "node:test";
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {installGrantAdmissionLedger,admitVerifiedMcpGrant,GrantDrainPending,listCurrentSubjectGrants} from "../src/account-adapters/grant-admission.ts";
import {beginProtectedMcpWriteLease,runReservedMcpWrite,disconnectAfterMcpWritesDrain,outstandingMcpWrites,reconcileTerminatedCanvasWriteLease} from "../src/account-adapters/grant-write-drain.ts";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import guestPermissions from "@patchboard/jazz-schema/jazz.permissions.json" with {type:"json"};
import {
  patchTypedRecord,readTypedRecord,typedRecordOperationIdentity,
  TypedRecordPermissionDenied,TypedRecordGuardDenied,
  TypedRecordFieldInvalid,TypedRecordSchemaConflict,
  TypedRecordVersionConflict,TypedRecordRequestConflict
} from "../src/typed-record-patch.ts";

process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
test("QA typed relational records are backend-owned in BOTH Jazz permission variants",()=>{
  for(const policy of [privatePermissions,guestPermissions])
    for(const table of ["typedDatasets","typedFields","typedRecords",
      "typedPatchReceipts","typedPatchEvents"])
      assert.deepEqual(policy.tables[table],{
        read:"false",insert:"false",update:"false",delete:"false"
      },table+" must not permit direct client read or write");
});
test("first typed Jazz record v7→v8, source/guard/scope, retry, stale, race and restart",async t=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-typed-record-"));
  const open=()=>createJazz({app,permissions:privatePermissions,
    store:sqlite({path:root}),authenticate:()=>null}).ready();
  let server=await open();
  const subjects=Object.fromEntries(["owner","editor","viewer","outsider","spaceOnly"]
    .map(name=>[name,randomUUID()]));
  const actors=Object.fromEntries(await Promise.all(Object.entries(subjects)
    .map(async([k,v])=>[k,await server.createAccountFor(v)])));
  const boardId=randomUUID(),siblingId=randomUUID();
  const ids={dataset:randomUUID(),readonlyDataset:randomUUID(),
    fieldTitle:randomUUID(),fieldLength:randomUUID(),
    fieldOther:randomUUID(),record:randomUUID(),racer:randomUUID(),
    unchanged:randomUUID(),readonly:randomUUID()};
  const patch=(id,key,value="Demo rehearsed.",actorId=actors.editor,
    schemaVersion=3,datasetId=ids.dataset,fieldId=ids.fieldTitle)=>({
      boardId,actorId,datasetId,recordId:id,schemaVersion,
      expectedVersion:7,requestId:key,set:{[fieldId]:value}
    });
  const receipts=()=>server.db.all(app.typedPatchReceipts.where({boardId}));
  const events=()=>server.db.all(app.typedPatchEvents.where({boardId}));
  const record=id=>server.db.one(app.typedRecords.where({id}));
  const seed=async(recordId,datasetId=ids.dataset)=>server.db.insert(
    app.typedRecords,{boardId,datasetId,version:7,updatedBy:actors.owner,
      cells:{[ids.fieldTitle]:"Original",[ids.fieldLength]:8}
    },{id:recordId}).wait({tier:"global"});
  try{
    for(const id of [boardId,siblingId])
      await server.db.insert(app.boards,{ownerId:actors.owner,
        title:id===boardId?"Typed QA board":"Sibling"
      },{id}).wait({tier:"global"});
    for(const [name,role] of [["editor","editor"],["viewer","viewer"]])
      await server.db.insert(app.boardMembers,{
        boardId,userId:actors[name],role
      }).wait({tier:"global"});
    await server.db.insert(app.typedDatasets,{
      boardId,name:"QA rehearsal",schemaVersion:3,state:"active"
    },{id:ids.dataset}).wait({tier:"global"});
    await server.db.insert(app.typedDatasets,{
      boardId,name:"Restricted records",schemaVersion:3,state:"read_only"
    },{id:ids.readonlyDataset}).wait({tier:"global"});
    await server.db.insert(app.typedFields,{
      boardId,datasetId:ids.dataset,name:"Title",kind:"text"
    },{id:ids.fieldTitle}).wait({tier:"global"});
    await server.db.insert(app.typedFields,{
      boardId,datasetId:ids.dataset,name:"Title length",kind:"computed",
      computeFromFieldId:ids.fieldTitle
    },{id:ids.fieldLength}).wait({tier:"global"});
    await server.db.insert(app.typedFields,{
      boardId,datasetId:ids.readonlyDataset,name:"Other title",kind:"text"
    },{id:ids.fieldOther}).wait({tier:"global"});
    for(const id of [ids.record,ids.racer,ids.unchanged])await seed(id);
    await seed(ids.readonly,ids.readonlyDataset);
    let first;
    await t.test("P: authorized Editor modifies writable stable field once with derived computed cell",async()=>{
      first=await patchTypedRecord(server.db,patch(ids.record,"primary"));
      assert.equal(first.recordId,ids.record);
      assert.equal(first.version,8);
      assert.equal(first.previousVersion,7);
      assert.equal(first.schemaVersion,3);
      assert.equal(first.cells[ids.fieldTitle],"Demo rehearsed.");
      assert.equal(first.cells[ids.fieldLength],Array.from("Demo rehearsed.").length);
      assert.equal(first.updatedBy,actors.editor);
      assert.notEqual(typedRecordOperationIdentity(patch(ids.record,"primary")).receiptId,
        typedRecordOperationIdentity(patch(ids.record,"different")).receiptId);
      const r=await receipts(),e=await events();
      assert.equal(r.length,1);
      assert.equal(e.length,1);
      assert.equal(r[0].id,first.receiptId);
      assert.equal(e[0].id,first.eventId);
      assert.equal(e[0].actorId,actors.editor);
      assert.deepEqual(e[0].fieldIds,[ids.fieldTitle]);
      assert.equal((await record(ids.record)).version,8);
    });
    await t.test("R: exact same request can replay original v8 without duplicate event",async()=>{
      const again=await patchTypedRecord(server.db,patch(ids.record,"primary"));
      assert.equal(again.replayed,true);
      assert.equal(again.version,8);
      assert.equal(again.receiptId,first.receiptId);
      assert.equal(again.eventId,first.eventId);
      assert.deepEqual(again.cells,first.cells);
      assert.equal((await events()).length,1);
      assert.equal((await receipts()).length,1);
    });
    await t.test("N: no change on computed field, cross-dataset ID or malformed value",async()=>{
      for(const cmd of [
        patch(ids.unchanged,"computed","untrusted",actors.editor,3,ids.dataset,ids.fieldLength),
        patch(ids.unchanged,"other","untrusted",actors.editor,3,ids.dataset,ids.fieldOther),
        patch(ids.unchanged,"wrong-type",42),
      ]){
        await assert.rejects(()=>patchTypedRecord(server.db,cmd),TypedRecordFieldInvalid);
      }
      assert.equal((await record(ids.unchanged)).version,7);
      assert.equal((await events()).length,1);
    });
    await t.test("S: stale dataset schema and record version reject without audit",async()=>{
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.unchanged,"schema-old","bad",actors.editor,2)),
        TypedRecordSchemaConflict);
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.record,"stale-record")),TypedRecordVersionConflict);
      assert.equal((await record(ids.unchanged)).version,7);
      assert.equal((await events()).length,1);
    });
    await t.test("N: stable request ID cannot be reused with another payload",async()=>{
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.record,"primary","MALICIOUS")),TypedRecordRequestConflict);
      assert.equal((await record(ids.record)).cells[ids.fieldTitle],"Demo rehearsed.");
    });
    await t.test("N: wrong dataset/record, Viewer, outsider, Space-only, read-only service guard",async()=>{
      for(const who of ["viewer","outsider","spaceOnly"])
        await assert.rejects(()=>patchTypedRecord(server.db,
          patch(ids.unchanged,"deny-"+who,"bad",actors[who])),
          TypedRecordPermissionDenied);
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.readonly,"service-guard","BAD",actors.editor,3,
          ids.readonlyDataset,ids.fieldOther)),TypedRecordGuardDenied);
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.unchanged,"wrong-dataset","BAD",actors.editor,3,
          ids.readonlyDataset,ids.fieldOther)),TypedRecordPermissionDenied);
      await assert.rejects(()=>patchTypedRecord(server.db,
        {...patch(ids.unchanged,"other-board"),boardId:siblingId}),
        TypedRecordPermissionDenied);
      assert.equal((await record(ids.unchanged)).version,7);
      assert.equal((await record(ids.readonly)).version,7);
      assert.equal((await events()).length,1);
    });
    await t.test("C: two different v7 requests yield exactly one v8 and one conflict",async()=>{
      const a=patch(ids.racer,"race-1","Writer A");
      const b=patch(ids.racer,"race-2","Writer B");
      const result=await Promise.allSettled([
        patchTypedRecord(server.db,a),patchTypedRecord(server.db,b)
      ]);
      assert.equal(result.filter(x=>x.status==="fulfilled").length,1);
      assert.equal(result.filter(x=>x.status==="rejected" &&
        x.reason instanceof TypedRecordVersionConflict).length,1);
      assert.equal((await record(ids.racer)).version,8);
      assert.equal((await events()).length,2);
      assert.equal((await receipts()).length,2);
    });
    await t.test("QA typed lease participates in disconnect drain; uncertain typed outcome cannot be recovered as canvas",async()=>{
      const sql=new DatabaseSync(":memory:");
      try{
        sql.exec("CREATE TABLE patchboard_oauth_grant(id TEXT PRIMARY KEY,user_id TEXT,client_id TEXT,board_id TEXT,created_at_ms INTEGER,revoked_at_ms INTEGER)");
        installGrantAdmissionLedger(sql);
        const grants=["normal","unknown"].map(clientId=>({id:randomUUID(),userId:subjects.editor,clientId,boardId}));
        for(const g of grants)sql.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)").run(g.id,g.userId,g.clientId,g.boardId,Date.now());
        const reserve=(g,command)=>{
          const admission=admitVerifiedMcpGrant(sql,g,new Set(["board:write"]));
          const lease=beginProtectedMcpWriteLease(sql,admission,g,{tool:"patch_typed_record",identity:typedRecordOperationIdentity(command)});
          assert.ok(lease);
          return {admission,lease};
        };
        const intent=g=>({grantId:g.id,clientId:g.clientId,expectedVersion:1,requestId:"same-disconnect"});
        const disconnect=g=>disconnectAfterMcpWritesDrain(sql,g.userId,intent(g),{maxWaitMs:0});
        // Replay exact already-committed typed write; hold reservation before
        // attempting disconnect, then return the known authoritative result.
        const command=patch(ids.record,"primary"), g=grants[0];
        const {admission,lease}=reserve(g,command);
        await assert.rejects(disconnect(g),GrantDrainPending);
        assert.equal(beginProtectedMcpWriteLease(sql,admission,g),null);
        assert.deepEqual(listCurrentSubjectGrants(sql,g.userId).grants.find(x=>x.id===g.id).pendingDisconnect,{requestId:"same-disconnect",expectedVersion:1});
        await runReservedMcpWrite(sql,lease,async()=>{
          const result=await patchTypedRecord(server.db,command);
          assert.equal(result.replayed,true);
          return {content:[{type:"text",text:JSON.stringify(result)}]};
        });
        assert.equal(outstandingMcpWrites(sql,g.id),0);
        const revoked=await disconnect(g);
        assert.equal(revoked.committedVersion,2);
        assert.deepEqual(await disconnect(g),revoked);
        const uncertain=grants[1], held=reserve(uncertain,command).lease;
        await runReservedMcpWrite(sql,held,async()=>({isError:true,content:[{type:"text",text:"COMMIT_OUTCOME_UNKNOWN: retry same request_id"}]}));
        assert.equal(outstandingMcpWrites(sql,uncertain.id),1);
        // Even with a matching typed receipt/event, the canvas verifier must not settle it.
        assert.deepEqual(await reconcileTerminatedCanvasWriteLease(sql,server.db,held.id,{workerTerminated:true}),{status:"UNKNOWN_OPERATION",settled:false});
        await assert.rejects(disconnect(uncertain),GrantDrainPending);
        assert.equal(outstandingMcpWrites(sql,uncertain.id),1);
        assert.equal((await receipts()).length,2);assert.equal((await events()).length,2);
        console.log("TYPED_LEASE_DRAIN_AND_RECOVERY_BOUNDARY_PASS",JSON.stringify({settledKnown:true,originalDisconnectReplayed:true,unknownLease:1,canvasRecovery:"UNKNOWN_OPERATION",disconnectPending:true}));
      }finally{sql.close();}
    });
    await t.test("S/R: current membership denies old receipt replay after Editor downgrade",async()=>{
      // The request has already entered this server, but membership is
      // re-read INSIDE the Jazz transaction after the scheduling seam.
      let entered,release;
      const atBarrier=new Promise(resolve=>{entered=resolve;});
      const resume=new Promise(resolve=>{release=resolve;});
      const queued=patchTypedRecord(server.db,
        patch(ids.unchanged,"queued-after-role-change"),{
          beforeTransaction:async()=>{entered();await resume;}
        });
      await atBarrier;
      const editor=await server.db.one(app.boardMembers.where({
        boardId,userId:actors.editor
      }));
      await server.db.update(app.boardMembers,editor.id,{
        role:"viewer",roleVersion:2
      }).wait({tier:"global"});
      release();
      await assert.rejects(()=>queued,TypedRecordPermissionDenied);
      assert.equal((await record(ids.unchanged)).version,7);
      await assert.rejects(()=>patchTypedRecord(server.db,
        patch(ids.record,"primary")),TypedRecordPermissionDenied);
      assert.equal((await events()).length,2);
    });
    await t.test("R: after store restart, independent Owner reads exact typed cells/version/writer",async()=>{
      await server.close();
      server=await open();
      const owner=await readTypedRecord(server.db,{
        boardId,datasetId:ids.dataset,recordId:ids.record,actorId:actors.owner
      });
      assert.equal(owner.recordId,ids.record);
      assert.equal(owner.version,8);
      assert.equal(owner.updatedBy,actors.editor);
      assert.equal(owner.schemaVersion,3);
      assert.equal(owner.cells[ids.fieldTitle],"Demo rehearsed.");
      assert.equal(owner.cells[ids.fieldLength],Array.from("Demo rehearsed.").length);
      assert.equal(owner.fields.find(f=>f.id===ids.fieldLength).kind,"computed");
      assert.equal((await receipts()).length,2);
      assert.equal((await events()).length,2);
      console.log("ACC051_TYPED_RECORD_JAZZ_V7_V8_PASS",JSON.stringify({
        boardId,datasetId:ids.dataset,recordId:ids.record,
        fieldTitleId:ids.fieldTitle,computedFieldId:ids.fieldLength,
        editorActorId:actors.editor,
        receiptId:first.receiptId,eventId:first.eventId,
        priorVersion:7,committedVersion:8,receipts:2,events:2,
        computedEditDenied:true,serviceGuardDenied:true,
        inheritedOnlyDenied:true,staleSchemaDenied:true,
        staleVersionDenied:true,conflictOneWinner:true
      }));
    });
  }finally{
    await server.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
