import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import guestPermissions from "@patchboard/jazz-schema/jazz.permissions.json" with {type:"json"};
import {
  patchCanvasLabelMarkdown,CanvasPatchRequestConflict
} from "../src/canvas-versioned-patch.ts";
import {
  CanvasPermissionDenied,CanvasConflict
} from "../src/canvas-entity-service.ts";
import {changeNativeBoardMemberRole} from "../src/account-adapters/board-member-role.ts";

process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;

test("ACC-051 persisted canvas receipt/event data are invisible to guest and private Jazz clients",()=>{
  for(const policy of [guestPermissions,privatePermissions]){
    for(const name of ["canvasPatchReceipts","canvasPatchEvents"]){
      assert.deepEqual(policy.tables[name],{
        read:"false",insert:"false",update:"false",delete:"false"
      });
    }
  }
});
test("ACC-051 canvas field patch v7→v8, idempotent, raced, member-checked, persisted",async t=>{
  const root=await mkdtemp(join(tmpdir(),"dim0-acc051-canvas-write-"));
  const open=()=>createJazz({app,permissions:privatePermissions,
    store:sqlite({path:root}),authenticate:()=>null}).ready();
  let server=await open();
  const actor={owner:randomUUID(),editor:randomUUID(),viewer:randomUUID(),
    inherited:randomUUID(),outsider:randomUUID()};
  const boardId=randomUUID(),siblingId=randomUUID();
  const ids={primary:randomUUID(),racer:randomUUID(),queued:randomUUID()};
  const seed=async id=>{
    const payload={id,graphUid:boardId,type:"note",version:7,
      label:{markdown:"at-version-seven"},content:{markdown:"unchanged"},
      properties:{nodePosition:{type:"position",position:{x:7,y:8}}}};
    await server.db.insert(app.canvasEntities,{
      boardId,kind:"node",payload,version:7,updatedBy:actor.owner
    },{id}).wait({tier:"global"});
    return payload;
  };
  const cmd=(id,requestId,label="at-version-eight",actorId=actor.editor,board=boardId)=>({
    boardId:board,actorId,id,requestId,expectedVersion:7,
    patch:{label_markdown:label}
  });
  const receipts=()=>server.db.all(app.canvasPatchReceipts.where({boardId}));
  const events=()=>server.db.all(app.canvasPatchEvents.where({boardId}));
  const row=id=>server.db.one(app.canvasEntities.where({id}));
  try {
    await server.db.insert(app.boards,{title:"ACC051 version 7",ownerId:actor.owner},
      {id:boardId}).wait({tier:"global"});
    await server.db.insert(app.boards,{title:"Sibling",ownerId:actor.owner},
      {id:siblingId}).wait({tier:"global"});
    for(const who of ["editor","viewer"])
      await server.db.insert(app.boardMembers,{
        boardId,userId:actor[who],role:who==="editor"?"editor":"viewer"
      }).wait({tier:"global"});
    const workspaceId=randomUUID();
    await server.db.insert(app.workspaces,{name:"Dormant shadow",createdBy:actor.owner,state:"active"},{id:workspaceId}).wait({tier:"global"});
    await server.db.insert(app.boardWorkspaceBindings,{boardId,workspaceId,version:1},{id:boardId}).wait({tier:"global"});
    await server.db.insert(app.workspaceMemberships,{
      workspaceId,actorId:actor.inherited,role:"editor",state:"active",
      version:1,proof:"verified_better_auth"
    }).wait({tier:"global"});
    for(const id of Object.values(ids))await seed(id);
    let first;
    await t.test("P: editor commits exact field patch v7→v8 with ONE receipt/event/writer",async()=>{
      first=await patchCanvasLabelMarkdown(server.db,cmd(ids.primary,"stable-id"));
      assert.equal(first.version,8);
      assert.equal(first.previousVersion,7);
      assert.equal(first.payload.version,8);
      assert.equal(first.payload.label.markdown,"at-version-eight");
      assert.equal(first.payload.content.markdown,"unchanged");
      assert.equal(first.updatedBy,actor.editor);
      assert.equal(first.replayed,false);
      assert.equal((await row(ids.primary)).version,8);
      const r=await receipts(),e=await events();
      assert.equal(r.length,1);assert.equal(e.length,1);
      assert.equal(r[0].id,first.receiptId);
      assert.equal(e[0].id,first.eventId);
      assert.equal(e[0].actorId,actor.editor);
      assert.equal(e[0].previousVersion,7);
      assert.equal(e[0].committedVersion,8);
    });
    await t.test("R: lost response, same request_id returns original v8 with zero side effects",async()=>{
      const replay=await patchCanvasLabelMarkdown(server.db,cmd(ids.primary,"stable-id"));
      assert.equal(replay.version,8);
      assert.equal(replay.replayed,true);
      assert.equal(replay.receiptId,first.receiptId);
      assert.equal(replay.eventId,first.eventId);
      assert.deepEqual(replay.payload,first.payload);
      assert.equal((await receipts()).length,1);
      assert.equal((await events()).length,1);
    });
    await t.test("N: same request ID different patch conflicts, no update",async()=>{
      await assert.rejects(
        ()=>patchCanvasLabelMarkdown(server.db,cmd(ids.primary,"stable-id","malicious")),
        CanvasPatchRequestConflict);
      assert.equal((await row(ids.primary)).payload.label.markdown,"at-version-eight");
      assert.equal((await events()).length,1);
      await assert.rejects(
        ()=>patchCanvasLabelMarkdown(server.db,cmd(ids.primary,"different-id")),
        CanvasConflict);
    });
    await t.test("C: simultaneous distinct v7 requests yield one v8, one conflict",async()=>{
      const a=cmd(ids.racer,"race-a","race-a-label");
      const b=cmd(ids.racer,"race-b","race-b-label");
      const results=await Promise.allSettled([
        patchCanvasLabelMarkdown(server.db,a),
        patchCanvasLabelMarkdown(server.db,b)
      ]);
      assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
      assert.equal(results.filter(x=>x.status==="rejected" &&
        x.reason instanceof CanvasConflict).length,1);
      assert.equal((await row(ids.racer)).version,8);
      assert.equal((await receipts()).length,2);
      assert.equal((await events()).length,2);
    });
    await t.test("N: Viewer, Space-only Editor, outsider and sibling cannot mutate",async()=>{
      for(const who of ["viewer","inherited","outsider"]){
        await assert.rejects(
          ()=>patchCanvasLabelMarkdown(server.db,
            cmd(ids.queued,"deny-"+who,"denied",actor[who])),CanvasPermissionDenied);
      }
      await assert.rejects(
        ()=>patchCanvasLabelMarkdown(server.db,
          cmd(ids.queued,"wrong-board","denied",actor.editor,siblingId)),
        CanvasPermissionDenied);
      assert.equal((await row(ids.queued)).version,7);
      assert.equal((await events()).length,2);
    });
    await t.test("S/C: already queued v7 edit loses role before in-transaction authorization",async()=>{
      let release,started;
      const arrived=new Promise(resolve=>{started=resolve;});
      const barrier=new Promise(resolve=>{release=resolve;});
      const job=patchCanvasLabelMarkdown(server.db,
        cmd(ids.queued,"queued-before-downgrade"),{
          beforeTransaction:async()=>{started();await barrier;}
        });
      await arrived;
      const changed=await changeNativeBoardMemberRole(server.db,actor.owner,{
        boardId,memberId:actor.editor,expectedVersion:1,
        assignedRole:"viewer",requestId:"downgrade-queued-editor"
      });
      assert.equal(changed.membershipVersion,2);
      release();
      await assert.rejects(()=>job,CanvasPermissionDenied);
      await assert.rejects(
        ()=>patchCanvasLabelMarkdown(server.db,
          cmd(ids.primary,"stable-id")),CanvasPermissionDenied,
        "old v8 receipt does not resurrect downgraded Editor");
      assert.equal((await row(ids.queued)).version,7);
      assert.equal((await receipts()).length,2);
      assert.equal((await events()).length,2);
    });
    await t.test("R: independent owner sees committed version/writer after store restart",async()=>{
      await server.close();server=await open();
      const data=await row(ids.primary);
      assert.equal(data.version,8);
      assert.equal(data.updatedBy,actor.editor);
      assert.equal(data.payload.label.markdown,"at-version-eight");
      const r=await receipts(),e=await events();
      assert.equal(r.length,2);assert.equal(e.length,2);
      assert.equal(r.find(x=>x.id===first.receiptId).committedVersion,8);
      assert.equal(e.find(x=>x.id===first.eventId).actorId,actor.editor);
      console.log("ACC051_CANVAS_V7_V8_JAZZ_PASS",JSON.stringify({
        boardId,entityId:ids.primary,actorId:actor.editor,
        receiptId:first.receiptId,eventId:first.eventId,
        previousVersion:7,committedVersion:8,receipts:2,events:2,
        raceWinnerCount:1,deniedEventCount:0
      }));
    });
  } finally {
    await server.close();
    await rm(root,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
