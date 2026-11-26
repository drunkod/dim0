import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app as older} from "./fixtures/pre-typed-record-schema/jazz.generated.ts";
import olderPermissions from "./fixtures/pre-typed-record-schema/private.permissions.json" with {type:"json"};
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {patchTypedRecord,readTypedRecord} from "../src/typed-record-patch.ts";

const oldDir=new URL("./fixtures/pre-typed-record-schema",import.meta.url).pathname;
const newDir=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
test("additive old persisted Jazz store migrates to typed record tables without losing identities",async()=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-typed-migration-"));
  const boardId=randomUUID(),datasetId=randomUUID(),
    titleFieldId=randomUUID(),computedFieldId=randomUUID(),recordId=randomUUID();
  const ownerSubject=randomUUID(),editorSubject=randomUUID();
  let server;
  try{
    process.env.JAZZ_APP_DIR=oldDir;
    server=await createJazz({app:older,permissions:olderPermissions,
      store:sqlite({path:root}),authenticate:()=>null}).ready();
    const owner=await server.createAccountFor(ownerSubject);
    const editor=await server.createAccountFor(editorSubject);
    const memberId=randomUUID(),entityId=randomUUID(),canvasReceiptId=randomUUID(),canvasEventId=randomUUID();
    const canvasPayload={id:entityId,graphUid:boardId,type:"note",version:8,label:{markdown:"Preserved canvas"},content:{markdown:"Preserve"}};
    await server.db.insert(older.boards,{ownerId:owner,title:"Pre-typed persisted board"},
      {id:boardId}).wait({tier:"global"});
    await server.db.insert(older.boardMembers,{
      boardId,userId:editor,role:"editor",roleVersion:2
    },{id:memberId}).wait({tier:"global"});
    await server.db.insert(older.canvasEntities,{boardId,kind:"node",payload:canvasPayload,version:8,updatedBy:editor},{id:entityId}).wait({tier:"global"});
    await server.db.insert(older.canvasPatchReceipts,{boardId,entityId,actorId:editor,requestId:"old-canvas-write",fingerprint:"a".repeat(64),previousVersion:7,committedVersion:8,committedPayload:canvasPayload,eventId:canvasEventId},{id:canvasReceiptId}).wait({tier:"global"});
    await server.db.insert(older.canvasPatchEvents,{boardId,entityId,actorId:editor,requestId:"old-canvas-write",receiptId:canvasReceiptId,previousVersion:7,committedVersion:8,field:"label.markdown"},{id:canvasEventId}).wait({tier:"global"});
    const oldRows=await Promise.all([
      server.db.one(older.boards.where({id:boardId})),server.db.one(older.boardMembers.where({id:memberId})),
      server.db.one(older.canvasEntities.where({id:entityId})),server.db.one(older.canvasPatchReceipts.where({id:canvasReceiptId})),
      server.db.one(older.canvasPatchEvents.where({id:canvasEventId}))
    ]);
    await server.close();server=null;

    process.env.JAZZ_APP_DIR=newDir;
    const open=()=>createJazz({app,permissions:privatePermissions,
      store:sqlite({path:root}),authenticate:()=>null}).ready();
    const verifyOld=async()=>{
      const newRows=await Promise.all([
        server.db.one(app.boards.where({id:boardId})),server.db.one(app.boardMembers.where({id:memberId})),
        server.db.one(app.canvasEntities.where({id:entityId})),server.db.one(app.canvasPatchReceipts.where({id:canvasReceiptId})),
        server.db.one(app.canvasPatchEvents.where({id:canvasEventId}))
      ]);
      assert.deepEqual(newRows,oldRows);
    };
    server=await open();
    await verifyOld();
    assert.equal(await server.createAccountFor(ownerSubject),owner);
    assert.equal(await server.createAccountFor(editorSubject),editor);
    assert.equal((await server.db.one(app.boards.where({id:boardId})))?.title,
      "Pre-typed persisted board");
    const before=await server.db.one(app.boardMembers.where({id:memberId}));
    assert.equal(before.userId,editor);
    assert.equal(before.role,"editor");
    assert.equal((await server.db.all(app.typedRecords.where({boardId}))).length,0);

    await server.db.insert(app.typedDatasets,{
      boardId,name:"Typed add-on",schemaVersion:3,state:"active"
    },{id:datasetId}).wait({tier:"global"});
    await server.db.insert(app.typedFields,{
      boardId,datasetId,name:"Title",kind:"text"
    },{id:titleFieldId}).wait({tier:"global"});
    await server.db.insert(app.typedFields,{
      boardId,datasetId,name:"Title length",kind:"computed",
      computeFromFieldId:titleFieldId
    },{id:computedFieldId}).wait({tier:"global"});
    await server.db.insert(app.typedRecords,{
      boardId,datasetId,cells:{[titleFieldId]:"Original",[computedFieldId]:8},
      version:7,updatedBy:owner
    },{id:recordId}).wait({tier:"global"});
    const command={
      boardId,datasetId,recordId,actorId:editor,
      schemaVersion:3,expectedVersion:7,
      requestId:"typed-old-store-"+randomUUID(),
      set:{[titleFieldId]:"Migrated and edited"}
    };
    const first=await patchTypedRecord(server.db,command);
    assert.equal(first.version,8);
    assert.equal((await server.db.all(app.typedPatchReceipts.where({boardId}))).length,1);
    await server.close();

    server=await open();
    await verifyOld();
    assert.equal((await server.db.one(app.boards.where({id:boardId})))?.ownerId,owner);
    assert.equal((await server.db.one(app.boardMembers.where({id:memberId})))?.role,
      "editor");
    const ownerView=await readTypedRecord(server.db,{
      boardId,datasetId,recordId,actorId:owner
    });
    assert.equal(ownerView.version,8);
    assert.equal(ownerView.updatedBy,editor);
    assert.equal(ownerView.cells[titleFieldId],"Migrated and edited");
    assert.equal(ownerView.cells[computedFieldId],
      Array.from("Migrated and edited").length);
    const replay=await patchTypedRecord(server.db,command);
    assert.equal(replay.replayed,true);
    assert.equal(replay.receiptId,first.receiptId);
    assert.equal(replay.eventId,first.eventId);
    assert.equal((await server.db.all(app.typedPatchReceipts.where({boardId}))).length,1);
    assert.equal((await server.db.all(app.typedPatchEvents.where({boardId}))).length,1);
    console.log("ACC051_TYPED_OLD_STORE_ADDITIVE_MIGRATION_PASS",JSON.stringify({
      boardId,datasetId,recordId,editorActorId:editor,
      firstReceiptId:first.receiptId,eventId:first.eventId,
      previousVersion:7,committedVersion:8,
      from:"afadd0f49eda",to:"7ddacb95394d",oldMembershipPreserved:true,canvasReceiptEventPreserved:true,sameIdentityAfterRestart:true,
      copiedPreTypedStore:true
    }));
  }finally{
    if(server)await server.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
    process.env.JAZZ_APP_DIR=newDir;
  }
});
