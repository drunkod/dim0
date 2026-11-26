import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {DatabaseSync} from "node:sqlite";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import guestPermissions from "@patchboard/jazz-schema/jazz.permissions.json" with {type:"json"};
import {createTextTable,addTextRow,textTableOperationIdentity,
  TypedCatalogInvalid,TypedCatalogConflict} from "../src/typed-catalog.ts";
import {TypedRecordPermissionDenied,TypedRecordRequestConflict,
  TypedRecordVersionConflict,patchTypedRecord} from "../src/typed-record-patch.ts";
import {createSavedTypedView,querySavedTypedView,issueTypedViewShare,
  installTypedViewShareLedger,revokeTypedViewShare
} from "../src/typed-shared-view.ts";
process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;

test("catalog receipts/events are server-owned under guest and private policies",()=>{
  for(const policy of [guestPermissions,privatePermissions])
    for(const table of ["typedCatalogReceipts","typedCatalogEvents"])
      assert.deepEqual(policy.tables[table],{
        read:"false",insert:"false",update:"false",delete:"false"
      });
});
test("single owner catalog transaction, lost reply replay, three rows and restart",async t=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-owner-catalog-"));
  process.env.PATCHBOARD_PRIVATE_ROOT=root;
  process.env.PATCHBOARD_PRIVATE_ORIGIN="http://localhost:9881";
  process.env.PATCHBOARD_PRIVATE_DEV="1";
  const path=join(root,"jazz"),sql=new DatabaseSync(join(root,"shares.sqlite"));
  installTypedViewShareLedger(sql);
  const open=()=>createJazz({app,permissions:privatePermissions,
    store:sqlite({path}),authenticate:()=>null}).ready();
  let server=await open();
  const subjects={owner:randomUUID(),viewer:randomUUID(),recipient:randomUUID()};
  const actors=Object.fromEntries(await Promise.all(
    Object.entries(subjects).map(async([k,v])=>[k,await server.createAccountFor(v)])
  ));
  const boardId=randomUUID();
  const input={boardId,actorId:actors.owner,requestId:"schema-1",
    name:"Demo table",primaryFieldName:"Title",defaultViewName:"All rows"};
  let created,records=[],view,share;
  const count=async()=>({
    datasets:(await server.db.all(app.typedDatasets.where({boardId}))).length,
    fields:(await server.db.all(app.typedFields.where({boardId}))).length,
    views:(await server.db.all(app.typedViews.where({boardId}))).length,
    catalogReceipts:(await server.db.all(app.typedCatalogReceipts.where({boardId}))).length,
    catalogEvents:(await server.db.all(app.typedCatalogEvents.where({boardId}))).length,
    records:(await server.db.all(app.typedRecords.where({boardId}))).length
  });
  try{
    await server.db.insert(app.boards,{ownerId:actors.owner,title:"Empty QA board"},
      {id:boardId}).wait({tier:"global"});
    await server.db.insert(app.boardMembers,{
      boardId,userId:actors.viewer,role:"viewer"
    }).wait({tier:"global"});
    await t.test("invalid definition and direct viewer creation produce zero objects",async()=>{
      assert.deepEqual(await count(),{
        datasets:0,fields:0,views:0,catalogReceipts:0,catalogEvents:0,records:0
      });
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,primaryFieldName:""
      }),TypedCatalogInvalid);
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,primaryFieldName:"Title",defaultViewName:"Bad\nname"
      }),TypedCatalogInvalid);
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,actorId:actors.viewer
      }),TypedRecordPermissionDenied);
      assert.equal((await count()).datasets,0);
      assert.equal((await count()).catalogEvents,0);
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,requestId:"blocked-by-oauth-lease"
      },{beforeWriteSubmit:()=>{throw new Error(
        "GRANT_ADMISSION_EXPIRED_OR_INVALID"
      );}}),/GRANT_ADMISSION_EXPIRED_OR_INVALID/);
      assert.deepEqual(await count(),{
        datasets:0,fields:0,views:0,catalogReceipts:0,catalogEvents:0,records:0
      },"denied admission before Jazz submission must leave no catalog objects");
      let checks=0;
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,requestId:"guard-changed-after-entry"
      },{beforeWriteSubmit:()=>{if(++checks>1)throw new Error("GRANT_ADMISSION_EXPIRED_OR_INVALID");}}),
        /GRANT_ADMISSION_EXPIRED_OR_INVALID/);
      assert.equal(checks,2);
      assert.deepEqual(await count(),{datasets:0,fields:0,views:0,catalogReceipts:0,catalogEvents:0,records:0});

    });
    await t.test("owner gets stable catalog IDs, replay after lost reply, conflict",async()=>{
      created=await createTextTable(server.db,input);
      assert.equal(created.replayed,false);
      assert.equal(created.schemaVersion,1);
      for(const x of [created.datasetId,created.fieldId,created.defaultViewId,
        created.receiptId,created.eventId])
        assert.match(x,/^[a-f\d-]{36}$/);
      const identity=textTableOperationIdentity(input);
      assert.equal(identity.tool,"call-api-write");
      assert.equal(identity.action,"dataset.create.v1");
      assert.equal(identity.datasetId,created.datasetId);
      assert.equal(identity.fieldId,created.fieldId);
      assert.equal(identity.viewId,created.defaultViewId);
      assert.equal(identity.receiptId,created.receiptId);
      assert.equal(identity.eventId,created.eventId);
      assert.equal((await server.db.one(app.typedCatalogReceipts.where({
        id:created.receiptId
      }))).fingerprint,identity.fingerprint);
      let replayChecks=0;
      await assert.rejects(()=>createTextTable(server.db,input,{
        beforeWriteSubmit:()=>{if(++replayChecks===3)throw new Error("GRANT_ADMISSION_EXPIRED_OR_INVALID");}
      }),/GRANT_ADMISSION_EXPIRED_OR_INVALID/);
      assert.equal(replayChecks,3);
      const replay=await createTextTable(server.db,input);
      assert.deepEqual({...replay,replayed:false},created);
      assert.equal(replay.replayed,true);
      await assert.rejects(()=>createTextTable(server.db,{
        ...input,name:"Other name"
      }),TypedCatalogConflict);
      assert.deepEqual(await count(),{
        datasets:1,fields:1,views:1,catalogReceipts:1,catalogEvents:1,records:0
      });
      const primaryField=await server.db.one(app.typedFields.where({
        id:created.fieldId
      }));
      assert.equal(primaryField.kind,"text");
      assert.equal(primaryField.primary,true);
      const defaultGrid=await server.db.one(app.typedViews.where({
        id:created.defaultViewId
      }));
      assert.equal(defaultGrid.kind,"grid");
      assert.deepEqual(defaultGrid.allowedFieldIds,[created.fieldId]);
    });
    await t.test("owner adds three durable text rows and versioned edit works",async()=>{
      for(const [index,value] of ["Demo alpha","Internal planning","Demo beta"].entries()){
        const inputRow={boardId,datasetId:created.datasetId,actorId:actors.owner,
          requestId:"row-"+index,schemaVersion:1,fieldId:created.fieldId,value};
        const first=await addTextRow(server.db,inputRow);
        assert.equal(first.version,1);
        assert.equal(first.replayed,false);
        const replay=await addTextRow(server.db,inputRow);
        assert.equal(replay.recordId,first.recordId);
        assert.equal(replay.replayed,true);
        await assert.rejects(()=>addTextRow(server.db,{
          ...inputRow,value:"REPLACED"
        }),TypedRecordRequestConflict);
        records.push(first);
      }
      const single=await server.db.one(app.typedRecords.where({id:records[1].recordId}));
      assert.equal(single.cells[created.fieldId],"Internal planning");
      const patch={boardId,datasetId:created.datasetId,recordId:records[1].recordId,
        actorId:actors.owner,requestId:"edit-1",schemaVersion:1,
        expectedVersion:1,set:{[created.fieldId]:"Internal adjusted"}};
      const updated=await patchTypedRecord(server.db,patch);
      assert.equal(updated.version,2);
      assert.equal(updated.cells[created.fieldId],"Internal adjusted");
      await assert.rejects(()=>patchTypedRecord(server.db,{
        ...patch,requestId:"edit-2",set:{[created.fieldId]:"Stale"}
      }),TypedRecordVersionConflict);
      assert.equal((await count()).records,3);
      await assert.rejects(()=>addTextRow(server.db,{
        boardId,datasetId:created.datasetId,actorId:actors.viewer,
        requestId:"viewer-row",schemaVersion:1,fieldId:created.fieldId,value:"DENIED"
      }),TypedRecordPermissionDenied);
      assert.equal((await count()).records,3);
    });
    await t.test("save view, share without membership, restart retains IDs, revoke",async()=>{
      view=await createSavedTypedView(server.db,{
        boardId,datasetId:created.datasetId,actorId:actors.owner,
        definition:{
          name:"Demo items",allowedFieldIds:[created.fieldId],
          filter:{op:"text_prefix",fieldId:created.fieldId,value:"Demo"},
          sort:{fieldId:created.fieldId,direction:"asc"}
        }
      });
      share=await issueTypedViewShare(server.db,sql,{
        boardId,datasetId:created.datasetId,viewId:view.viewId,
        actorId:actors.owner,verifiedSubjectId:subjects.owner
      });
      const query=()=>querySavedTypedView(server.db,sql,{
        boardId,datasetId:created.datasetId,viewId:view.viewId,
        shareToken:share.shareToken,verifiedSubjectId:subjects.recipient,
        channel:"browser",pageSize:1
      });
      const first=await query();
      assert.equal(first.total,2);
      assert.deepEqual(first.rows.map(x=>x.id),[records[0].recordId]);
      await server.close();
      server=await open();
      const reread=await query();
      assert.equal(reread.total,2);
      assert.equal(reread.rows[0].id,records[0].recordId);
      const second=await querySavedTypedView(server.db,sql,{
        boardId,datasetId:created.datasetId,viewId:view.viewId,
        shareToken:share.shareToken,verifiedSubjectId:subjects.recipient,
        channel:"browser",pageSize:1,cursor:reread.nextCursor
      });
      assert.deepEqual(second.rows.map(x=>x.id),[records[2].recordId]);
      assert.deepEqual(await count(),{
        datasets:1,fields:1,views:2,catalogReceipts:1,catalogEvents:1,records:3
      });
      const replay=await createTextTable(server.db,input);
      assert.equal(replay.replayed,true);
      assert.equal(replay.datasetId,created.datasetId);
      const after=await revokeTypedViewShare(server.db,sql,{
        boardId,datasetId:created.datasetId,viewId:view.viewId,
        shareId:share.shareId,actorId:actors.owner,expectedVersion:1
      });
      assert.equal(after.revoked,true);
      await assert.rejects(query);
      console.log("ACC051_OWNER_CATALOG_TRANSACTION_RESTART_PASS",JSON.stringify({
        boardId,datasetId:created.datasetId,primaryFieldId:created.fieldId,
        defaultViewId:created.defaultViewId,savedViewId:view.viewId,
        recordIds:records.map(r=>r.recordId),
        schemaVersion:1,postRestartReplayStable:true,
        catalogReceiptId:created.receiptId,catalogEventId:created.eventId,
        rowReceiptIds:records.map(r=>r.receiptId),
        savedViewTotal:2,viewerDenied:true,revoked:true
      }));
    });
  }finally{
    await server.close();sql.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
