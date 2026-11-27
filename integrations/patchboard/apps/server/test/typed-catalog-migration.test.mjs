import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,rm,readFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app as parent} from "./fixtures/pre-native-catalog-schema/jazz.generated.ts";
import parentPermissions from "./fixtures/pre-native-catalog-schema/private.permissions.json" with {type:"json"};
import * as oldViews from "./fixtures/pre-native-catalog-schema/typed-shared-view.ts";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {installTypedViewShareLedger,querySavedTypedView,TypedViewAccessDenied} from "../src/typed-shared-view.ts";
import {createTextTable} from "../src/typed-catalog.ts";

test("exact #22 store and SQL shares survive both catalog migrations and reopen",async()=>{
  const root=await mkdtemp(join(tmpdir(),"patchboard-private-ci-catalog-migration-"));
  const store=join(root,"jazz"),sqlPath=join(root,"shares.sqlite");
  process.env.PATCHBOARD_PRIVATE_ROOT=root;
  process.env.PATCHBOARD_PRIVATE_ORIGIN="http://localhost:19193";
  process.env.PATCHBOARD_PRIVATE_DEV="1";
  const boardId=randomUUID(),datasetId=randomUUID(),fieldId=randomUUID(),lengthId=randomUUID(),recordId=randomUUID(),receiptId=randomUUID(),eventId=randomUUID();
  const ownerSubject=randomUUID(),writerSubject=randomUUID(),readerSubject=randomUUID();
  const oldDir=new URL("./fixtures/pre-native-catalog-schema",import.meta.url).pathname;
  const newDir=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
  const open=(model,policy)=>createJazz({app:model,permissions:policy,store:sqlite({path:store}),authenticate:()=>null}).ready();
  let jazz,sql;
  const snap=(db,model,viewId)=>Promise.all([
    db.one(model.boards.where({id:boardId})),db.one(model.typedDatasets.where({id:datasetId})),
    db.one(model.typedFields.where({id:fieldId})),db.one(model.typedFields.where({id:lengthId})),
    db.one(model.typedRecords.where({id:recordId})),db.one(model.typedPatchReceipts.where({id:receiptId})),
    db.one(model.typedPatchEvents.where({id:eventId})),db.one(model.typedViews.where({id:viewId}))
  ]);
  // primary is additive/optional; normalize only that newly introduced property.
  const normalize=rows=>rows.map((row,i)=>{
    if(i!==2&&i!==3)return row;
    const {primary,...rest}=row;assert.ok(primary==null);return rest;
  });
  const ledger=()=>sql.prepare("SELECT * FROM patchboard_typed_view_share ORDER BY id").all();
  try{
    process.env.JAZZ_APP_DIR=oldDir;
    jazz=await open(parent,parentPermissions);
    const owner=await jazz.createAccountFor(ownerSubject),writer=await jazz.createAccountFor(writerSubject);
    const cells={[fieldId]:"Demo preserved",[lengthId]:14};
    const seed=(table,value,id)=>jazz.db.insert(table,value,{id}).wait({tier:"global"});
    await seed(parent.boards,{ownerId:owner,title:"Exact parent fixture"},boardId);
    await seed(parent.typedDatasets,{boardId,name:"Parent records",schemaVersion:3,state:"active"},datasetId);
    await seed(parent.typedFields,{boardId,datasetId,name:"Title",kind:"text"},fieldId);
    await seed(parent.typedFields,{boardId,datasetId,name:"Title length",kind:"computed",computeFromFieldId:fieldId},lengthId);
    await seed(parent.typedRecords,{boardId,datasetId,cells,version:8,updatedBy:writer},recordId);
    await seed(parent.typedPatchReceipts,{boardId,datasetId,recordId,actorId:writer,requestId:"old-writer",fingerprint:"a".repeat(64),schemaVersion:3,previousVersion:7,committedVersion:8,committedCells:cells,eventId},receiptId);
    await seed(parent.typedPatchEvents,{boardId,datasetId,recordId,actorId:writer,requestId:"old-writer",receiptId,previousVersion:7,committedVersion:8,fieldIds:[fieldId]},eventId);
    const view=await oldViews.createSavedTypedView(jazz.db,{boardId,datasetId,actorId:owner,definition:{
      name:"Demo items",allowedFieldIds:[fieldId],filter:{op:"text_prefix",fieldId,value:"Demo"},sort:{fieldId,direction:"asc"}}});
    sql=new DatabaseSync(sqlPath);oldViews.installTypedViewShareLedger(sql);
    const ref={boardId,datasetId,viewId:view.viewId,actorId:owner,verifiedSubjectId:ownerSubject};
    const active=await oldViews.issueTypedViewShare(jazz.db,sql,ref),revoked=await oldViews.issueTypedViewShare(jazz.db,sql,ref);
    await oldViews.revokeTypedViewShare(jazz.db,sql,{...ref,shareId:revoked.shareId,expectedVersion:1});
    const q={boardId,datasetId,viewId:view.viewId,verifiedSubjectId:readerSubject,channel:"browser",pageSize:1};
    const projected=await oldViews.querySavedTypedView(jazz.db,sql,{...q,shareToken:active.shareToken});
    await assert.rejects(()=>oldViews.querySavedTypedView(jazz.db,sql,{...q,shareToken:revoked.shareToken}),oldViews.TypedViewAccessDenied);
    const before=normalize(await snap(jazz.db,parent,view.viewId)),ledgerBefore=ledger();
    await jazz.close();jazz=null;sql.close();sql=null;
    process.env.JAZZ_APP_DIR=newDir;
    // Both migration sources and snapshots must be registered, not collapsed.
    const generated=await readFile(join(newDir,"jazz.generated.ts"),"utf8");
    for(const [from,to] of [["ed9b0d151df4","9906825b7802"],["9906825b7802","eba3a7168187"]]){
      assert.ok(new RegExp('"fromHash": "'+from+'[a-f0-9]+"[,]\\s*"toHash": "'+to).test(generated));
    }
    jazz=await open(app,permissions);sql=new DatabaseSync(sqlPath);installTypedViewShareLedger(sql);
    async function verify(){
      assert.deepEqual(normalize(await snap(jazz.db,app,view.viewId)),before);
      assert.deepEqual(ledger(),ledgerBefore);
      assert.deepEqual(await querySavedTypedView(jazz.db,sql,{...q,shareToken:active.shareToken}),projected);
      await assert.rejects(()=>querySavedTypedView(jazz.db,sql,{...q,shareToken:revoked.shareToken}),TypedViewAccessDenied);
      assert.equal(await jazz.createAccountFor(ownerSubject),owner);
      assert.equal(await jazz.createAccountFor(writerSubject),writer);
      assert.equal((await jazz.db.all(app.typedPatchReceipts.where({boardId}))).length,1);
      assert.equal((await jazz.db.all(app.typedPatchEvents.where({boardId}))).length,1);
    }
    await verify();
    assert.deepEqual(await jazz.db.all(app.typedCatalogReceipts.where({boardId})),[]);
    const created=await createTextTable(jazz.db,{boardId,actorId:owner,requestId:"new-after-migration",name:"New table",primaryFieldName:"Title",defaultViewName:"All rows"});
    await jazz.close();jazz=null;sql.close();sql=null;
    jazz=await open(app,permissions);sql=new DatabaseSync(sqlPath);
    await verify();
    assert.equal((await jazz.db.one(app.typedFields.where({id:created.fieldId}))).primary,true);
    assert.equal((await jazz.db.all(app.typedCatalogReceipts.where({boardId}))).length,1);
    assert.equal((await jazz.db.all(app.typedCatalogEvents.where({boardId}))).length,1);
    console.log("NATIVE_CATALOG_PARENT_MIGRATION_PASS",JSON.stringify({
      from:"ed9b0d151df4",via:"9906825b7802",to:"eba3a7168187",recordId,receiptId,eventId,viewId:view.viewId,
      version:8,writerPreserved:true,activeShareRestored:true,revokedShareDenied:true,newCatalogReopened:true
    }));
  }finally{await jazz?.close();sql?.close();process.env.JAZZ_APP_DIR=newDir;await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});}
});
