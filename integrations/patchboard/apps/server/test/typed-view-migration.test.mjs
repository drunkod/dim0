import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app as older} from "./fixtures/pre-saved-view-schema/jazz.generated.ts";
import olderPermissions from "./fixtures/pre-saved-view-schema/private.permissions.json" with {type:"json"};
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {createSavedTypedView,issueTypedViewShare,revokeTypedViewShare,installTypedViewShareLedger,querySavedTypedView,TypedViewAccessDenied} from "../src/typed-shared-view.ts";

test("persisted #19 typed rows, receipts and events survive additive saved-view migration",async()=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-view-migration-"));
  const store=join(root,"jazz"),sqlPath=join(root,"shares.sqlite");
  process.env.PATCHBOARD_PRIVATE_ROOT=root;
  process.env.PATCHBOARD_PRIVATE_ORIGIN="http://localhost:19192";
  process.env.PATCHBOARD_PRIVATE_DEV="1";
  const boardId=randomUUID(),datasetId=randomUUID(),title=randomUUID(),computed=randomUUID(),recordId=randomUUID(),receiptId=randomUUID(),eventId=randomUUID(),memberId=randomUUID();
  const ownerSubject=randomUUID(),editorSubject=randomUUID(),readerSubject=randomUUID();
  const oldDir=new URL("./fixtures/pre-saved-view-schema",import.meta.url).pathname;
  const newDir=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
  let jazz,sql;
  const open=(model,policy)=>createJazz({app:model,permissions:policy,store:sqlite({path:store}),authenticate:()=>null}).ready();
  const snapshot=(db,model)=>Promise.all([
    db.one(model.boards.where({id:boardId})),db.one(model.boardMembers.where({id:memberId})),
    db.one(model.typedDatasets.where({id:datasetId})),db.one(model.typedFields.where({id:title})),
    db.one(model.typedFields.where({id:computed})),db.one(model.typedRecords.where({id:recordId})),
    db.one(model.typedPatchReceipts.where({id:receiptId})),db.one(model.typedPatchEvents.where({id:eventId}))
  ]);
  try{
    process.env.JAZZ_APP_DIR=oldDir;
    jazz=await open(older,olderPermissions);
    const owner=await jazz.createAccountFor(ownerSubject),editor=await jazz.createAccountFor(editorSubject);
    const cells={[title]:"Demo migrated",[computed]:13};
    const seed=(table,value,id)=>jazz.db.insert(table,value,{id}).wait({tier:"global"});
    await seed(older.boards,{ownerId:owner,title:"Parent typed board"},boardId);
    await seed(older.boardMembers,{boardId,userId:editor,role:"editor",roleVersion:2},memberId);
    await seed(older.typedDatasets,{boardId,name:"Parent dataset",schemaVersion:3,state:"active"},datasetId);
    await seed(older.typedFields,{boardId,datasetId,name:"Title",kind:"text"},title);
    await seed(older.typedFields,{boardId,datasetId,name:"Title length",kind:"computed",computeFromFieldId:title},computed);
    await seed(older.typedRecords,{boardId,datasetId,cells,version:8,updatedBy:editor},recordId);
    await seed(older.typedPatchReceipts,{boardId,datasetId,recordId,actorId:editor,requestId:"parent-typed",fingerprint:"a".repeat(64),schemaVersion:3,previousVersion:7,committedVersion:8,committedCells:cells,eventId},receiptId);
    await seed(older.typedPatchEvents,{boardId,datasetId,recordId,actorId:editor,requestId:"parent-typed",receiptId,previousVersion:7,committedVersion:8,fieldIds:[title]},eventId);
    const before=await snapshot(jazz.db,older);
    await jazz.close();jazz=null;
    process.env.JAZZ_APP_DIR=newDir;
    jazz=await open(app,permissions);
    assert.deepEqual(await snapshot(jazz.db,app),before);
    assert.equal(await jazz.createAccountFor(ownerSubject),owner);
    assert.equal(await jazz.createAccountFor(editorSubject),editor);
    assert.deepEqual(await jazz.db.all(app.typedViews.where({datasetId})),[]);
    const definition={name:"Demo items",allowedFieldIds:[title],filter:{op:"text_prefix",fieldId:title,value:"Demo"},sort:{fieldId:title,direction:"asc"}};
    const view=await createSavedTypedView(jazz.db,{boardId,datasetId,actorId:owner,definition});
    sql=new DatabaseSync(sqlPath);installTypedViewShareLedger(sql);
    const ref={boardId,datasetId,viewId:view.viewId,actorId:owner,verifiedSubjectId:ownerSubject};
    const active=await issueTypedViewShare(jazz.db,sql,ref);
    const revoked=await issueTypedViewShare(jazz.db,sql,ref);
    await revokeTypedViewShare(jazz.db,sql,{...ref,shareId:revoked.shareId,expectedVersion:1});
    const viewBefore=await jazz.db.one(app.typedViews.where({id:view.viewId}));
    await jazz.close();jazz=null;sql.close();sql=null;
    jazz=await open(app,permissions);sql=new DatabaseSync(sqlPath);installTypedViewShareLedger(sql);
    assert.deepEqual(await snapshot(jazz.db,app),before);
    assert.deepEqual(await jazz.db.one(app.typedViews.where({id:view.viewId})),viewBefore);
    const query={boardId,datasetId,viewId:view.viewId,verifiedSubjectId:readerSubject,channel:"browser",pageSize:1};
    const result=await querySavedTypedView(jazz.db,sql,{...query,shareToken:active.shareToken});
    assert.deepEqual(result.rows,[{id:recordId,version:8,cells:{[title]:"Demo migrated"}}]);
    await assert.rejects(()=>querySavedTypedView(jazz.db,sql,{...query,shareToken:revoked.shareToken}),TypedViewAccessDenied);
    assert.equal((await jazz.db.all(app.typedPatchReceipts.where({boardId}))).length,1);
    assert.equal((await jazz.db.all(app.typedPatchEvents.where({boardId}))).length,1);
    console.log("SAVED_VIEW_PARENT_MIGRATION_PASS",JSON.stringify({from:"7ddacb95394d",to:"ed9b0d151df4",recordId,receiptId,eventId,viewId:view.viewId,version:8,writerPreserved:true,activeShareRestored:true,revokedShareDenied:true}));
  }finally{await jazz?.close();sql?.close();process.env.JAZZ_APP_DIR=newDir;await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
