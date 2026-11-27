import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {mkdtemp,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import guestPermissions from "@patchboard/jazz-schema/jazz.permissions.json" with {type:"json"};
import {
  installTypedViewShareLedger,createSavedTypedView,changeSavedTypedView,
  issueTypedViewShare,revokeTypedViewShare,querySavedTypedView,
  TypedViewAccessDenied,TypedViewCursorChanged,TypedViewNotFound,
  TypedViewUnsupported
} from "../src/typed-shared-view.ts";
process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;

test("saved typed view is not browser Jazz CRUD in guest or private policy",()=>{
  for(const policy of [privatePermissions,guestPermissions])
    assert.deepEqual(policy.tables.typedViews,{
      read:"false",insert:"false",update:"false",delete:"false"
    });
});
test("one persisted view scans canonical rows with share filter, opaque cursor and stable row ties",async t=>{
  const root=await mkdtemp(join(tmpdir(),"acc051-shared-view-"));
  process.env.PATCHBOARD_PRIVATE_ROOT=root;
  process.env.PATCHBOARD_PRIVATE_ORIGIN="http://localhost:9881";
  process.env.PATCHBOARD_PRIVATE_DEV="1";
  const sqlPath=join(root,"shares.sqlite"),jazzPath=join(root,"jazz");
  let sql=new DatabaseSync(sqlPath);
  sql.exec("PRAGMA journal_mode=WAL");
  installTypedViewShareLedger(sql);
  const open=()=>createJazz({app,permissions:privatePermissions,
    store:sqlite({path:jazzPath}),authenticate:()=>null}).ready();
  let jazz=await open();
  const ownerSubject=randomUUID(),visitorSubject=randomUUID();
  const owner=await jazz.createAccountFor(ownerSubject);
  const visitor=await jazz.createAccountFor(visitorSubject);
  const boardId=randomUUID(),siblingId=randomUUID(),otherBoardId=randomUUID();
  const datasetId=randomUUID(),textFieldId=randomUUID(),lengthFieldId=randomUUID();
  const ids={R1:randomUUID(),R2:randomUUID(),R3:randomUUID()};
  const rows=[["R1","Demo alpha"],["R2","Internal planning"],["R3","Demo beta"]];
  const def=(prefix="Demo",direction="asc")=>({
    name:"Demo items",allowedFieldIds:[textFieldId],
    filter:{op:"text_prefix",fieldId:textFieldId,value:prefix},
    sort:{fieldId:textFieldId,direction}
  });
  let view,share;
  const query=(overrides={})=>querySavedTypedView(jazz.db,sql,{
    boardId,datasetId,viewId:view.viewId,shareToken:share.shareToken,
    verifiedSubjectId:visitorSubject,channel:"browser",pageSize:1,...overrides
  });
  try{
    for(const id of [boardId,siblingId,otherBoardId])
      await jazz.db.insert(app.boards,{title:"QA "+id,ownerId:owner},
        {id}).wait({tier:"global"});
    await jazz.db.insert(app.typedDatasets,{
      boardId,name:"Canonical typed dataset",schemaVersion:3,state:"active"
    },{id:datasetId}).wait({tier:"global"});
    await jazz.db.insert(app.typedFields,{
      boardId,datasetId,name:"Title",kind:"text"
    },{id:textFieldId}).wait({tier:"global"});
    await jazz.db.insert(app.typedFields,{
      boardId,datasetId,name:"Title length",kind:"computed",
      computeFromFieldId:textFieldId
    },{id:lengthFieldId}).wait({tier:"global"});
    for(const [key,title] of rows){
      await jazz.db.insert(app.typedRecords,{
        boardId,datasetId,version:7,updatedBy:owner,
        cells:{[textFieldId]:title,[lengthFieldId]:Array.from(title).length}
      },{id:ids[key]}).wait({tier:"global"});
    }
    view=await createSavedTypedView(jazz.db,{
      boardId,datasetId,actorId:owner,definition:def()
    });
    share=await issueTypedViewShare(jazz.db,sql,{
      boardId,datasetId,viewId:view.viewId,
      actorId:owner,verifiedSubjectId:ownerSubject
    });
    await t.test("P: two signed-in subjects read two filtered rows and no hidden fields",async()=>{
      const one=await query();
      assert.equal(one.total,2);
      assert.deepEqual(one.rows.map(r=>r.id),[ids.R1]);
      assert.deepEqual(one.fields,[textFieldId]);
      assert.deepEqual(one.rows[0].cells,{[textFieldId]:"Demo alpha"});
      assert.equal(JSON.stringify(one).includes(lengthFieldId),false);
      assert.ok(one.nextCursor);
      const two=await query({cursor:one.nextCursor});
      assert.equal(two.total,2);
      assert.deepEqual(two.rows.map(r=>r.id),[ids.R3]);
      assert.deepEqual(two.rows[0].cells,{[textFieldId]:"Demo beta"});
      assert.equal(two.nextCursor,null);
      assert.equal(JSON.stringify(two).includes(lengthFieldId),false);
      const ownerPage=await querySavedTypedView(jazz.db,sql,{
        boardId,datasetId,viewId:view.viewId,shareToken:share.shareToken,
        verifiedSubjectId:ownerSubject,channel:"browser",pageSize:1
      });
      assert.deepEqual(ownerPage.rows.map(r=>r.id),[ids.R1]);
      assert.equal(ownerPage.total,2);
      const viewerMember=await jazz.db.one(app.boardMembers.where({
        boardId,userId:visitor
      }));
      assert.ok(!viewerMember,"share must not add native board membership");
      assert.deepEqual((await jazz.db.all(app.typedRecords.where({
        datasetId
      }))).map(r=>r.id).sort(),Object.values(ids).sort(),
        "canonical owner dataset still holds all three rows");
    });
    await t.test("N: known hidden record ID and nonexistent ID both give same result",async()=>{
      await assert.rejects(()=>query({recordId:ids.R2}),TypedViewNotFound);
      await assert.rejects(()=>query({recordId:randomUUID()}),TypedViewNotFound);
      const selected=await query({recordId:ids.R1});
      assert.equal(selected.rows[0].id,ids.R1);
      assert.equal(selected.total,1);
    });
    await t.test("N: hidden field projection and hidden filter/sort cannot be requested",async()=>{
      for(const options of [
        {requestedFieldIds:[textFieldId,lengthFieldId]},
        {requestedSortFieldId:lengthFieldId},
        {requestedFilterFieldId:lengthFieldId},
      ])await assert.rejects(()=>query(options),error=>
        error instanceof TypedViewUnsupported &&
        error.code==="VIEW_HIDDEN_FIELD_UNSUPPORTED");
      await assert.rejects(()=>query({requestedSortFieldId:textFieldId}),
        TypedViewUnsupported,"sort override remains unsupported even if allowed");
      await assert.rejects(()=>query({boardId:siblingId}),TypedViewAccessDenied);
      await assert.rejects(()=>query({boardId:otherBoardId}),TypedViewAccessDenied);
      const first=await query();
      await assert.rejects(()=>query({cursor:first.nextCursor+"tamper"}),
        TypedViewUnsupported);
      await assert.rejects(()=>query({cursor:first.nextCursor,
        verifiedSubjectId:randomUUID()}),TypedViewUnsupported);
      await assert.rejects(()=>query({cursor:first.nextCursor,channel:"mcp"}),
        TypedViewUnsupported);
      await assert.rejects(()=>query({cursor:first.nextCursor,pageSize:2}),
        TypedViewCursorChanged);
    });
    await t.test("S: share revoke denies old browser and MCP page-two cursor",async()=>{
      const first=await query();
      const revoked=await revokeTypedViewShare(jazz.db,sql,{
        boardId,datasetId,viewId:view.viewId,
        shareId:share.shareId,actorId:owner,expectedVersion:1
      });
      assert.deepEqual(revoked,{shareId:share.shareId,shareVersion:2,revoked:true});
      await assert.rejects(()=>query({cursor:first.nextCursor}),TypedViewAccessDenied);
      await assert.rejects(()=>query({channel:"mcp"}),TypedViewAccessDenied);
      share=await issueTypedViewShare(jazz.db,sql,{
        boardId,datasetId,viewId:view.viewId,
        actorId:owner,verifiedSubjectId:ownerSubject
      });
      assert.notEqual(share.shareId,revoked.shareId);
    });
    await t.test("S: new definition invalidates old cursor but permits fresh query",async()=>{
      const prior=await query();
      const changed=await changeSavedTypedView(jazz.db,{
        boardId,datasetId,viewId:view.viewId,actorId:owner,
        expectedVersion:1,definition:def("Demo","desc")
      });
      assert.equal(changed.viewVersion,2);
      await assert.rejects(()=>query({cursor:prior.nextCursor}),
        TypedViewCursorChanged);
      const descending=await query();
      assert.deepEqual(descending.rows.map(r=>r.id),[ids.R3]);
      assert.equal(descending.total,2);
    });
    await t.test("C: equal Title sort values use record ID as final tie breaker",async()=>{
      await jazz.db.update(app.typedRecords,ids.R3,{
        cells:{[textFieldId]:"Demo alpha",[lengthFieldId]:10},
        version:8,updatedBy:owner
      }).wait({tier:"global"});
      const expected=[ids.R1,ids.R3].sort();
      const first=await query(),second=await query({cursor:first.nextCursor});
      assert.deepEqual([...first.rows,...second.rows].map(r=>r.id),expected);
      assert.equal(first.total,2);
      assert.equal(second.total,2);
      await jazz.db.update(app.typedRecords,ids.R3,{
        cells:{[textFieldId]:"Demo beta",[lengthFieldId]:9},
        version:9,updatedBy:owner
      }).wait({tier:"global"});
    });
    await t.test("N/R: empty result, reset to Demo and restart persisted Jazz & SQL",async()=>{
      const emptyDef=await changeSavedTypedView(jazz.db,{
        boardId,datasetId,viewId:view.viewId,actorId:owner,
        expectedVersion:2,definition:def("Absent")
      });
      assert.equal(emptyDef.viewVersion,3);
      const empty=await query();
      assert.equal(empty.total,0);
      assert.deepEqual(empty.rows,[]);
      assert.equal(empty.nextCursor,null);
      const reset=await changeSavedTypedView(jazz.db,{
        boardId,datasetId,viewId:view.viewId,actorId:owner,
        expectedVersion:3,definition:def()
      });
      assert.equal(reset.viewVersion,4);
      const cursorBeforeRestart=(await query()).nextCursor;
      await jazz.close();sql.close();
      jazz=await open();
      sql=new DatabaseSync(sqlPath);
      installTypedViewShareLedger(sql);
      const next=await query({cursor:cursorBeforeRestart});
      assert.equal(next.viewVersion,4);
      assert.equal(next.total,2);
      assert.deepEqual(next.rows.map(r=>r.id),[ids.R3]);
      const restored=await jazz.db.all(app.typedRecords.where({datasetId}));
      assert.equal(restored.length,3);
      assert.equal(restored.find(r=>r.id===ids.R2).cells[textFieldId],
        "Internal planning");
      assert.equal(restored.find(r=>r.id===ids.R3).cells[textFieldId],
        "Demo beta");
      assert.equal((await jazz.db.one(app.typedViews.where({
        id:view.viewId
      }))).definitionVersion,4);
      console.log("ACC051_SAVED_VIEW_PERSISTED_UNIT_PASS",JSON.stringify({
        boardId,datasetId,viewId:view.viewId,viewVersion:4,
        page1:[ids.R1],page2:[ids.R3],filteredTotal:2,
        returnedFields:[textFieldId],hiddenFieldId:lengthFieldId,
        shareRevocationDenied:true,oldCursorInvalid:true,
        restartCursorAccepted:true,unrestrictedRecordCount:3
      }));
    });
    await t.test("long legal title yields a usable signed continuation",async()=>{
      const longTitle="Demo "+"\u0001".repeat(1995);
      await jazz.db.update(app.typedRecords,ids.R1,{cells:{[textFieldId]:longTitle,[lengthFieldId]:2000}}).wait({tier:"global"});
      try{
        const first=await query();
        assert.ok(first.nextCursor.length>2048);
        const next=await query({cursor:first.nextCursor});
        assert.deepEqual(next.rows.map(r=>r.id),[ids.R3]);
      }finally{await jazz.db.update(app.typedRecords,ids.R1,{cells:{[textFieldId]:"Demo alpha",[lengthFieldId]:10}}).wait({tier:"global"});}
    });
    await t.test("bounded scan rejects 501 canonical records rather than plausible partial totals",async()=>{
      // Use one atomic fixture insert, no additional typed patch audit rows.
      const make=async(n)=>{
        const tx=await jazz.db.serializableTransaction(async t=>{
          for(let i=0;i<n;i++)t.insert(app.typedRecords,{boardId,datasetId,version:7,updatedBy:owner,
            cells:{[textFieldId]:"Private filler",[lengthFieldId]:14}},{id:randomUUID()});
        });
        await tx.wait({timeoutMs:10000});
      };
      await make(497);
      const atLimit=await query();
      assert.equal(atLimit.total,2);
      await make(1);
      await assert.rejects(()=>query(),error=>error instanceof TypedViewUnsupported && error.code==="VIEW_DATASET_LIMIT_500");
      await assert.rejects(()=>query({recordId:ids.R1}),error=>error instanceof TypedViewUnsupported && error.code==="VIEW_DATASET_LIMIT_500");
      console.log("SAVED_VIEW_DATASET_LIMIT_PASS",JSON.stringify({at500:atLimit.total,at501:"VIEW_DATASET_LIMIT_500"}));
    });
  }finally{
    await jazz.close();sql.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:100});
  }
});
