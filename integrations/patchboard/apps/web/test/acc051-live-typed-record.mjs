/**
 * Real virtual-passkey browser and signed OAuth MCP PATCH on one QA-gated
 * TYPED dataset/record. No Canvas JSON alias and no row/field share-view
 * claims. Jazz SQLite is opened exclusively while private server is stopped.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {realpathSync} from "node:fs";
import {writeFile,mkdir} from "node:fs/promises";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};

const serverRequire=createRequire(new URL("../../server/package.json",import.meta.url));
serverRequire("tsx/esm/api").register();
process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const requireDisposable=()=>{
  const root=process.env.PATCHBOARD_PRIVATE_ROOT;
  assert.ok(process.env.PATCHBOARD_PRIVATE_DEV==="1" &&
    process.env.PATCHBOARD_OAUTH_CI_RESTART==="1" &&
    root?.startsWith(join(tmpdir(),"patchboard-private-ci-")));
  assert.ok(realpathSync(root).startsWith(join(realpathSync(tmpdir()),"patchboard-private-ci-")));
  return root;
};
const snapshot=async(action)=>{
  const root=requireDisposable();
  const server=await createJazz({app,permissions,
    store:sqlite({path:join(root,"jazz")}),authenticate:()=>null}).ready();
  try{return await action(server.db);}
  finally{await server.close();}
};
const browserPatch=(page,body)=>page.evaluate(async body=>{
  const response=await fetch("/patchboard-private/api/records/patch",{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},body:JSON.stringify(body)
  });
  return {status:response.status,body:await response.json()};
},body);
const browserRead=(page,boardId,datasetId,recordId)=>page.evaluate(async args=>{
  const response=await fetch(
    "/patchboard-private/api/records/record?"+new URLSearchParams({
      board_id:args.boardId,dataset_id:args.datasetId,record_id:args.recordId
    }),{cache:"no-store"});
  return {status:response.status,body:await response.json()};
},{boardId,datasetId,recordId});

export async function proveAcc051LiveTypedRecord({
  origin,boardId,siblingBoardId,
  ownerPage,editorPage,viewerPage,editorActorId,ownerActorId,
  editorToken,viewerWriteToken,readOnlyToken,makeMcp,restart
}){
  requireDisposable();
  const ids={
    datasetId:randomUUID(),readOnlyDatasetId:randomUUID(),
    textFieldId:randomUUID(),computedFieldId:randomUUID(),
    otherDatasetFieldId:randomUUID(),
    recordR:randomUUID(),recordS:randomUUID(),recordLocked:randomUUID()
  };
  const schemaVersion=3;
  const baseCells={
    [ids.textFieldId]:"Original",[ids.computedFieldId]:8
  };
  // Exactly two writable dataset records R/S plus one service-locked record
  // in a different dataset. Stable field/record UUIDs never come from MCP.
  await restart(async()=>snapshot(async db=>{
    await db.insert(app.typedDatasets,{
      boardId,name:"Rehearsal",schemaVersion,state:"active"
    },{id:ids.datasetId}).wait({tier:"global"});
    await db.insert(app.typedDatasets,{
      boardId,name:"Locked",schemaVersion,state:"read_only"
    },{id:ids.readOnlyDatasetId}).wait({tier:"global"});
    await db.insert(app.typedFields,{
      boardId,datasetId:ids.datasetId,name:"Title",kind:"text"
    },{id:ids.textFieldId}).wait({tier:"global"});
    await db.insert(app.typedFields,{
      boardId,datasetId:ids.datasetId,name:"Title length",
      kind:"computed",computeFromFieldId:ids.textFieldId
    },{id:ids.computedFieldId}).wait({tier:"global"});
    await db.insert(app.typedFields,{
      boardId,datasetId:ids.readOnlyDatasetId,name:"Locked title",
      kind:"text"
    },{id:ids.otherDatasetFieldId}).wait({tier:"global"});
    for(const id of [ids.recordR,ids.recordS]){
      await db.insert(app.typedRecords,{
        boardId,datasetId:ids.datasetId,
        cells:baseCells,version:7,updatedBy:ownerActorId
      },{id}).wait({tier:"global"});
    }
    await db.insert(app.typedRecords,{
      boardId,datasetId:ids.readOnlyDatasetId,
      cells:{[ids.otherDatasetFieldId]:"Locked"},
      version:7,updatedBy:ownerActorId
    },{id:ids.recordLocked}).wait({tier:"global"});
  }));
  await ownerPage.reload();
  await editorPage.reload();
  if(process.env.PATCHBOARD_QA_TYPED_RECORD!=="1"){
    const {client,connect}=makeMcp(editorToken);
    const body={board_id:boardId,dataset_id:ids.datasetId,record_id:ids.recordR,
      schema_version:3,expected_version:7,request_id:"disabled-"+randomUUID(),
      set:{[ids.textFieldId]:"Must not commit"}};
    try{
      await connect();
      const tools=(await client.listTools()).tools.map(x=>x.name);
      assert.equal(tools.length,11);
      assert.ok(!tools.includes("patch_typed_record"));
      const denied=await client.callTool({name:"patch_typed_record",arguments:body}).catch(e=>({rejected:String(e)}));
      assert.ok(denied.isError || denied.rejected);
      const read=await browserRead(ownerPage,boardId,ids.datasetId,ids.recordR);
      const write=await browserPatch(editorPage,body);
      assert.equal(read.status,404);assert.equal(write.status,404);
      await restart(async()=>snapshot(async db=>{
        const row=await db.one(app.typedRecords.where({id:ids.recordR}),{tier:"remote"});
        assert.equal(row.version,7);assert.deepEqual(row.cells,baseCells);
        assert.equal(row.updatedBy,ownerActorId);
        assert.equal((await db.all(app.typedPatchReceipts.where({boardId}))).length,0);
        assert.equal((await db.all(app.typedPatchEvents.where({boardId}))).length,0);
      }));
      console.log("QA_TYPED_DISABLED_PASS",JSON.stringify({tools:tools.length,typedAbsent:true,cachedCallDenied:true,browserRead:404,browserWrite:404,version:7,receipts:0,events:0}));
      return null;
    }finally{await client.close();}
  }
  const initial=await browserRead(ownerPage,boardId,ids.datasetId,ids.recordR);
  assert.equal(initial.status,200);
  assert.equal(initial.body.version,7);
  assert.equal(initial.body.schemaVersion,3);
  assert.equal(initial.body.cells[ids.textFieldId],"Original");
  assert.equal(initial.body.cells[ids.computedFieldId],8);
  assert.equal(initial.body.fields.find(f=>f.id===ids.computedFieldId).kind,"computed");
  const viewerRead=await browserRead(viewerPage,boardId,ids.datasetId,ids.recordR);
  assert.equal(viewerRead.status,200,"current direct Viewer retains read permission");
  const outside=await browserRead(ownerPage,siblingBoardId,ids.datasetId,ids.recordR);
  assert.equal(outside.status,403,"dataset belongs to main board, not sibling");

  const {client:editorMcp,connect:connectEditor}=makeMcp(editorToken);
  const {client:viewerMcp,connect:connectViewer}=makeMcp(viewerWriteToken);
  const {client:readerMcp,connect:connectReader}=makeMcp(readOnlyToken);
  const ledger=new DatabaseSync(join(requireDisposable(),"auth","better-auth.sqlite"));
  ledger.exec(`PRAGMA busy_timeout=5000;
    CREATE TABLE qa_typed_lease_trace(id TEXT, phase TEXT, identity TEXT);
    CREATE TRIGGER qa_typed_reserve AFTER INSERT ON patchboard_mcp_write_lease
      WHEN NEW.tool_name='patch_typed_record' BEGIN
      INSERT INTO qa_typed_lease_trace VALUES(NEW.id,'reserve',NEW.operation_identity); END;
    CREATE TRIGGER qa_typed_settle AFTER DELETE ON patchboard_mcp_write_lease
      WHEN OLD.tool_name='patch_typed_record' BEGIN
      INSERT INTO qa_typed_lease_trace VALUES(OLD.id,'settle',OLD.operation_identity); END;`);
  try{
    await Promise.all([connectEditor(),connectViewer(),connectReader()]);
    const editorTools=(await editorMcp.listTools()).tools.map(x=>x.name);
    const viewerTools=(await viewerMcp.listTools()).tools.map(x=>x.name);
    const readOnlyTools=(await readerMcp.listTools()).tools.map(x=>x.name);
    assert.ok(editorTools.includes("patch_typed_record"));
    assert.ok(viewerTools.includes("patch_typed_record"),
      "writer scoped but current viewer role cannot use it");
    assert.equal(editorTools.length,13);
    assert.ok(!readOnlyTools.includes("patch_typed_record"),
      "read-only OAuth consent never discovers typed writes");
    const command=(recordId,requestId,title="Demo rehearsed.",
      fieldId=ids.textFieldId,datasetId=ids.datasetId)=>({
        board_id:boardId,dataset_id:datasetId,record_id:recordId,
        schema_version:schemaVersion,expected_version:7,
        request_id:requestId,set:{[fieldId]:title}
      });
    const update=command(ids.recordR,"qa-typed-lost-"+randomUUID());
    let intercepted=0,serverCommit;
    const routeUrl="**/patchboard-private/api/records/patch";
    const abortResponse=async route=>{
      intercepted++;
      const original=await route.fetch();
      assert.equal(original.status(),200);
      serverCommit=await original.json();
      await route.abort("failed");
    };
    await editorPage.route(routeUrl,abortResponse);
    let dropped;
    try{
      dropped=await editorPage.evaluate(async input=>{
        try{
          const response=await fetch("/patchboard-private/api/records/patch",{
            method:"POST",credentials:"same-origin",
            headers:{"content-type":"application/json"},
            body:JSON.stringify(input)
          });
          return {dropped:false,status:response.status};
        }catch{return {dropped:true};}
      },update);
    }finally{await editorPage.unroute(routeUrl,abortResponse);}
    assert.equal(intercepted,1);
    assert.equal(dropped.dropped,true);
    assert.equal(serverCommit.version,8);
    assert.equal(serverCommit.replayed,false);
    assert.equal(serverCommit.updatedBy,editorActorId);
    assert.equal(serverCommit.recordId,ids.recordR);
    assert.equal(serverCommit.cells[ids.textFieldId],"Demo rehearsed.");
    assert.equal(serverCommit.cells[ids.computedFieldId],
      Array.from("Demo rehearsed.").length);
    const replay=await editorMcp.callTool({
      name:"patch_typed_record",arguments:update
    });
    assert.equal(replay.isError,undefined,JSON.stringify(replay));
    const resumed=JSON.parse(replay.content[0].text);
    assert.equal(resumed.replayed,true);
    const leaseTrace=ledger.prepare("SELECT * FROM qa_typed_lease_trace ORDER BY rowid").all();
    assert.equal(leaseTrace.length,2);
    assert.deepEqual(leaseTrace.map(x=>x.phase),["reserve","settle"]);
    assert.equal(leaseTrace[0].id,leaseTrace[1].id);
    const reservedIdentity=JSON.parse(leaseTrace[0].identity);
    assert.equal(reservedIdentity.receiptId,serverCommit.receiptId);
    assert.equal(reservedIdentity.eventId,serverCommit.eventId);
    assert.equal(reservedIdentity.actorId,editorActorId);
    assert.equal(resumed.version,8);
    assert.equal(resumed.receiptId,serverCommit.receiptId);
    assert.equal(resumed.eventId,serverCommit.eventId);
    assert.deepEqual(resumed.cells,serverCommit.cells);

    const mismatch=await editorMcp.callTool({
      name:"patch_typed_record",
      arguments:{...update,set:{[ids.textFieldId]:"wrong replay"}}
    });
    assert.equal(mismatch.isError,true);
    assert.match(mismatch.content[0].text,/REQUEST_ID_CONFLICT/);
    const deniedEdits=[
      {name:"computed",cmd:command(ids.recordS,"computed-"+randomUUID(),
        "illegal",ids.computedFieldId),error:"INVALID_FIELD"},
      {name:"other-dataset-field",cmd:command(ids.recordS,
        "other-field-"+randomUUID(),"illegal",ids.otherDatasetFieldId),
        error:"INVALID_FIELD"},
      {name:"stale-schema",cmd:{...command(ids.recordS,
        "schema-"+randomUUID()),schema_version:2},error:"SCHEMA_VERSION_CONFLICT"},
      {name:"stale-record",cmd:command(ids.recordR,
        "stale-"+randomUUID()),error:"VERSION_CONFLICT"},
      {name:"read-only-dataset",cmd:command(ids.recordLocked,
        "locked-"+randomUUID(),"illegal",ids.otherDatasetFieldId,
        ids.readOnlyDatasetId),error:"SERVICE_GUARD_DENIED"},
      {name:"sibling-board",cmd:{...command(ids.recordS,
        "sibling-"+randomUUID()),board_id:siblingBoardId},
        error:"BOARD_ACCESS_DENIED"}
    ];
    for(const {name,cmd,error} of deniedEdits){
      const denied=await editorMcp.callTool({
        name:"patch_typed_record",arguments:cmd
      });
      assert.equal(denied.isError,true,name+":"+JSON.stringify(denied));
      assert.match(denied.content[0].text,new RegExp(error),name);
    }
    const unchanged=await browserRead(ownerPage,boardId,ids.datasetId,ids.recordS);
    assert.equal(unchanged.body.version,7);assert.deepEqual(unchanged.body.cells,baseCells);
    const readOnlyDenied=await readerMcp.callTool({name:"patch_typed_record",arguments:command(ids.recordS,"readonly-"+randomUUID())}).catch(e=>({rejected:String(e)}));
    assert.ok(readOnlyDenied.rejected || readOnlyDenied.isError);
    const viewerCmd=command(ids.recordS,"viewer-"+randomUUID());
    assert.equal((await browserPatch(viewerPage,viewerCmd)).status,403);
    const viewerMcpDenied=await viewerMcp.callTool({
      name:"patch_typed_record",arguments:viewerCmd
    });
    assert.equal(viewerMcpDenied.isError,true);
    assert.match(viewerMcpDenied.content[0].text,/BOARD_ACCESS_DENIED/);

    // Actual browser + actual OAuth MCP on a *different* R2 v7 record:
    // exactly one serializable version conflict winner.
    const raceBase=command(ids.recordS,"race-browser-"+randomUUID(),"Browser won");
    const raceMcp=command(ids.recordS,"race-mcp-"+randomUUID(),"MCP won");
    const [browserRace,mcpRace]=await Promise.all([
      browserPatch(editorPage,raceBase),
      editorMcp.callTool({name:"patch_typed_record",arguments:raceMcp})
    ]);
    const browserWon=browserRace.status===200,mcpWon=mcpRace.isError===undefined;
    assert.notEqual(browserWon,mcpWon,"two independent v7 writers cannot both commit");
    if(!browserWon)assert.equal(browserRace.status,409);
    if(!mcpWon)assert.match(mcpRace.content[0].text,/VERSION_CONFLICT/);
    const winner=browserWon?browserRace.body:
      JSON.parse(mcpRace.content[0].text);
    assert.equal(winner.version,8);

    // Owner reads the exact original verified actor and committed typed cells,
    // not merely a Canvas JSON element or the editor's local optimistic value.
    await ownerPage.reload();
    const owner=await browserRead(ownerPage,boardId,ids.datasetId,ids.recordR);
    assert.equal(owner.status,200);
    assert.equal(owner.body.recordId,ids.recordR);
    assert.equal(owner.body.version,8);
    assert.equal(owner.body.updatedBy,editorActorId);
    assert.equal(owner.body.cells[ids.textFieldId],"Demo rehearsed.");
    assert.equal(owner.body.cells[ids.computedFieldId],
      Array.from("Demo rehearsed.").length);
    assert.equal((await browserRead(ownerPage,boardId,ids.datasetId,
      ids.recordS)).body.version,8);
    assert.equal((await browserRead(ownerPage,boardId,ids.readOnlyDatasetId,
      ids.recordLocked)).body.version,7);
    const traces=ledger.prepare("SELECT id,phase FROM qa_typed_lease_trace ORDER BY rowid").all();
    const reserved=traces.filter(x=>x.phase==="reserve").map(x=>x.id).sort();
    const settled=traces.filter(x=>x.phase==="settle").map(x=>x.id).sort();
    assert.equal(reserved.length,10);
    assert.deepEqual(reserved,settled);
    assert.equal(ledger.prepare("SELECT count(*) AS n FROM patchboard_mcp_write_lease WHERE tool_name='patch_typed_record'").get().n,0);
    console.log("QA_TYPED_ENABLED_LEASES_PASS",JSON.stringify({tools:editorTools.length,writeTools:7,reserved:reserved.length,settled:settled.length,readOnlyDirectDenied:true}));
    // Jazz SQLite permits only one server authority at a time. Release
    // the disposable server before opening the authoritative audit reader.
    ledger.close();
    let audit;
    await restart(async()=>snapshot(async db=>{
      const receipts=await db.all(app.typedPatchReceipts.where({boardId}),
        {tier:"remote"});
      const events=await db.all(app.typedPatchEvents.where({boardId}),
        {tier:"remote"});
      const canvasReceiptId=await db.one(app.canvasPatchReceipts.where({
        id:serverCommit.receiptId
      }),{tier:"remote"});
      assert.ok(!canvasReceiptId,
        "typed operation namespace cannot collide with a canvas receipt");
      assert.equal(receipts.length,2);
      assert.equal(events.length,2);
      const primary=receipts.find(x=>x.id===serverCommit.receiptId);
      const event=events.find(x=>x.id===serverCommit.eventId);
      assert.ok(primary && event);
      assert.equal(primary.actorId,editorActorId);
      assert.equal(primary.previousVersion,7);
      assert.equal(primary.committedVersion,8);
      assert.equal(primary.eventId,event.id);
      assert.equal(primary.fingerprint.length,64);
      assert.equal(event.receiptId,primary.id);
      assert.deepEqual(event.fieldIds,[ids.textFieldId]);
      assert.equal((await db.one(app.typedRecords.where({
        id:ids.recordR
      }),{tier:"remote"})).version,8);
      assert.equal((await db.one(app.typedRecords.where({
        id:ids.recordLocked
      }),{tier:"remote"})).version,7);
      audit={receipts:receipts.length,events:events.length,
        receiptId:primary.id,eventId:event.id};
    }));
    await ownerPage.reload();
    const ownerAfter=await browserRead(ownerPage,boardId,ids.datasetId,ids.recordR);
    assert.equal(ownerAfter.status,200);
    assert.equal(ownerAfter.body.updatedBy,editorActorId);
    assert.equal(ownerAfter.body.version,8);
    assert.equal(ownerAfter.body.cells[ids.textFieldId],"Demo rehearsed.");
    assert.equal(ownerAfter.body.cells[ids.computedFieldId],
      Array.from("Demo rehearsed.").length);
    console.log("ACC051_TYPED_RACE_WINNER_PASS",JSON.stringify({
      boardId,recordId:ids.recordS,winner:browserWon?"browser":"mcp",
      version:8,onlyOneWinner:true,deniedRecordVersion:7
    }));
    console.log("ACC051_TYPED_RECEIPT_EVENT_IDS_PASS",JSON.stringify({
      boardId,datasetId:ids.datasetId,recordId:ids.recordR,
      receiptId:serverCommit.receiptId,eventId:serverCommit.eventId,
      actorId:editorActorId,receiptCount:audit.receipts,
      eventCount:audit.events,version:8
    }));
    const evidence={
        boardId,siblingBoardId,datasetId:ids.datasetId,
        recordR:ids.recordR,recordS:ids.recordS,
        fieldTitleId:ids.textFieldId,computedFieldId:ids.computedFieldId,
        readonlyDatasetId:ids.readOnlyDatasetId,
        editorActorId,ownerActorId,
        committedReceiptId:serverCommit.receiptId,
        committedEventId:serverCommit.eventId,
        previousVersion:7,committedVersion:8,
        savedTitle:"Demo rehearsed.",computedLength:Array.from("Demo rehearsed.").length,
        lostBrowserResponse:true,replayedByOAuthMcp:true,
        independentOwnerReloadAfterRestart:true,
        viewerBrowserMcpDenied:true,readonlyGrantToolAbsent:true,
        staleSchemaDenied:true,staleRecordDenied:true,computedEditDenied:true,
        wrongDatasetFieldDenied:true,wrongBoardDenied:true,
        readonlyDatasetGuardDenied:true,requestIdMismatchDenied:true,
        twoWriterOneWinner:true,
        typedReceiptCount:audit.receipts,typedEventCount:audit.events,
        currentLiveInheritanceEnabled:false,browserCommitStatus:200,mcpReplayIsError:false,
        ownerReadStatus:ownerAfter.status,ownerReadRecordId:ownerAfter.body.recordId,
        ownerReadVersion:ownerAfter.body.version,ownerReadWriter:ownerAfter.body.updatedBy,
        raceWinner:browserWon?"browser":"mcp",sdkReservations:reserved.length,sdkSettlements:settled.length
      };
    assert.equal(ownerAfter.body.recordId,ids.recordR);
    console.log("ACC051_REAL_TYPED_RECORD_BROWSER_MCP_V7_V8_PASS",JSON.stringify(evidence));
    if(process.env.PATCHBOARD_TYPED_EVIDENCE_DIR){
      await mkdir(process.env.PATCHBOARD_TYPED_EVIDENCE_DIR,{recursive:true,mode:0o700});
      await writeFile(join(process.env.PATCHBOARD_TYPED_EVIDENCE_DIR,"typed-verification.json"),JSON.stringify(evidence,null,2)+"\n",{mode:0o600});
    }
    return {...ids,update,serverCommit,audit,raceWinner:browserWon?"browser":"mcp"};
  }finally{
    try{ledger.close();}catch{}
    const cleanup=new DatabaseSync(join(requireDisposable(),"auth","better-auth.sqlite"));
    try{cleanup.exec("PRAGMA busy_timeout=5000; DROP TRIGGER IF EXISTS qa_typed_reserve; DROP TRIGGER IF EXISTS qa_typed_settle; DROP TABLE IF EXISTS qa_typed_lease_trace");}finally{cleanup.close();}
    await Promise.allSettled([
      editorMcp.close(),viewerMcp.close(),readerMcp.close()
    ]);
  }
}
