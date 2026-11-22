import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Effect } from "effect";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
import {
  changeNativeBoardMemberRole
} from "../src/account-adapters/board-member-role.ts";
import {
  BoardRoleChangeError
} from "@patchboard/account-domain/native-board-member";
import {
  createMcpNote, PrivatePermissionDenied
} from "../src/board-service.ts";

process.env.JAZZ_APP_DIR = new URL("../../../packages/jazz-schema", import.meta.url).pathname;
const path=await mkdtemp(join(tmpdir(),"patchboard-account-member-role-"));
const open=()=>createJazz({
  app,permissions:privatePermissions,store:sqlite({path}),
  authenticate:()=>null
}).ready();
let server=await open();
const owner=randomUUID(), editor=randomUUID(), viewer=randomUUID(),
  outsider=randomUUID(), special=randomUUID();
let boardId, editorMemberId, viewerMemberId;
const cmd=(memberId,assignedRole,expectedVersion,requestId)=>({
  boardId,memberId,assignedRole,expectedVersion,requestId
});
const mutate=(actor,input)=>changeNativeBoardMemberRole(server.db,actor,input);
async function deny(code,action) {
  await assert.rejects(action,error=>{
    assert.ok(error instanceof BoardRoleChangeError);
    assert.equal(error.code,code);
    return true;
  });
}
try {
  const board=server.db.insert(app.boards,{title:"Member role CAS",ownerId:owner});
  await board.wait({tier:"global"});
  boardId=board.value.id;
  const rows=await Promise.all([
    server.db.insert(app.boardMembers,{boardId,userId:editor,role:"editor"}).wait({tier:"global"}),
    server.db.insert(app.boardMembers,{boardId,userId:viewer,role:"viewer"}).wait({tier:"global"}),
    server.db.insert(app.boardMembers,{boardId,userId:special,role:"agent"}).wait({tier:"global"})
  ]);
  const existing=await server.db.all(app.boardMembers.where({boardId}));
  editorMemberId=existing.find(r=>r.userId===editor).id;
  viewerMemberId=existing.find(r=>r.userId===viewer).id;
  assert.equal(rows.length,3);

  await test("old rows and new inserts default member roleVersion to 1",async()=>{
    assert.deepEqual(existing.map(r=>r.roleVersion).sort(),[1,1,1]);
  });

  await test("real native owner upgrades Viewer to Editor with CAS and audit receipt",async()=>{
    await assert.rejects(
      ()=>Effect.runPromise(createMcpNote(server.db,{
        boardId,actorId:viewer,authorName:"Viewer",
        requestId:randomUUID(),text:"Must deny"
      })),PrivatePermissionDenied);
    const response=await mutate(owner,cmd(viewer,"editor",1,"promote-viewer-1"));
    assert.equal(response.previousRole,"viewer");
    assert.equal(response.assignedRole,"editor");
    assert.equal(response.membershipVersion,2);
    assert.equal(response.changed,true);
    assert.ok(response.receiptId);
    const current=await server.db.one(app.boardMembers.where({id:viewerMemberId}));
    assert.equal(current.role,"editor");
    assert.equal(current.roleVersion,2);
    const receipt=await server.db.one(app.boardMemberRoleReceipts.where({id:response.receiptId}));
    assert.equal(receipt.changed,true);
    assert.equal(receipt.actorId,owner);
    assert.equal(receipt.memberId,viewerMemberId);
    const note=await Effect.runPromise(createMcpNote(server.db,{
      boardId,actorId:viewer,authorName:"Promoted",
      requestId:randomUUID(),text:"Allowed after promotion"
    }));
    assert.ok(note.note_id);
  });

  await test("cached MCP write denied after direct-only Editor downgraded to Viewer",async()=>{
    const before=await Effect.runPromise(createMcpNote(server.db,{
      boardId,actorId:editor,authorName:"Editor",
      requestId:randomUUID(),text:"Before demotion"
    }));
    assert.ok(before.note_id);
    const changed=await mutate(owner,cmd(editor,"viewer",1,"downgrade-editor-1"));
    assert.equal(changed.changed,true);
    assert.equal(changed.membershipVersion,2);
    await assert.rejects(
      ()=>Effect.runPromise(createMcpNote(server.db,{
        boardId,actorId:editor,authorName:"Stale editor token",
        requestId:randomUUID(),text:"Must never write"
      })),PrivatePermissionDenied);
    await deny("STALE_MEMBER_VERSION",
      ()=>mutate(owner,cmd(editor,"editor",1,"old-editor-version")));
  });

  await test("same request replay is idempotent, no double audit event",async()=>{
    const same=await mutate(owner,cmd(editor,"viewer",1,"downgrade-editor-1"));
    assert.equal(same.membershipVersion,2);
    assert.equal(same.assignedRole,"viewer");
    assert.equal(same.changed,true);
    const receipts=await server.db.all(app.boardMemberRoleReceipts.where({boardId}));
    assert.equal(receipts.filter(r=>r.requestId==="downgrade-editor-1").length,1);
    await deny("REQUEST_ID_CONFLICT",
      ()=>mutate(owner,cmd(editor,"editor",1,"downgrade-editor-1")));
  });

  await test("same role no-op emits a receipt but no audit change/version bump",async()=>{
    const noop=await mutate(owner,cmd(editor,"viewer",2,"role-noop-1"));
    assert.equal(noop.membershipVersion,2);
    assert.equal(noop.changed,false);
    const current=await server.db.one(app.boardMembers.where({id:editorMemberId}));
    assert.equal(current.roleVersion,2);
    const receipts=await server.db.all(app.boardMemberRoleReceipts.where({boardId}));
    assert.equal(receipts.filter(r=>r.changed && r.requestId==="role-noop-1").length,0);
  });

  await test("wrong board, nonowner and admin/agent target all deny",async()=>{
    await deny("FORBIDDEN",()=>mutate(outsider,cmd(editor,"editor",2,"outsider")));
    await deny("FORBIDDEN",()=>mutate(viewer,cmd(editor,"editor",2,"peer")));
    await deny("FORBIDDEN",()=>mutate(owner,cmd(owner,"editor",1,"owner-mutation")));
    await deny("MEMBER_NOT_FOUND",()=>mutate(owner,cmd(outsider,"viewer",1,"not-member")));
    await deny("ROLE_NOT_SUPPORTED",()=>mutate(owner,cmd(special,"editor",1,"agent-mutation")));
    await deny("FORBIDDEN",()=>mutate(owner,{...cmd(editor,"viewer",2,"wrong-board"),boardId:randomUUID()}));
  });

  await test("two overlapping changed requests with same version admit at most one mutation",async()=>{
    const operations=await Promise.allSettled([
      mutate(owner,cmd(viewer,"viewer",2,"race-A")),
      mutate(owner,cmd(viewer,"viewer",2,"race-B"))
    ]);
    const wins=operations.filter(x=>x.status==="fulfilled");
    assert.equal(wins.length,1);
    assert.equal((await server.db.one(app.boardMembers.where({id:viewerMemberId}))).roleVersion,3);
    const receipts=await server.db.all(app.boardMemberRoleReceipts.where({boardId}));
    assert.equal(receipts.filter(r=>r.requestId==="race-A"||r.requestId==="race-B").length,1);
  });

  await test("a removed member cannot use prior role receipt to regain membership",async()=>{
    await server.db.delete(app.boardMembers,editorMemberId).wait({tier:"global"});
    await deny("MEMBER_NOT_FOUND",
      ()=>mutate(owner,cmd(editor,"viewer",1,"downgrade-editor-1")));
    assert.equal(await server.db.one(app.boardMembers.where({id:editorMemberId})),null);
  });

  await test("membership versions/role receipts survive server restart",async()=>{
    await server.close();
    server=await open();
    const member=await server.db.one(app.boardMembers.where({id:viewerMemberId}));
    assert.equal(member.role,"viewer");
    assert.equal(member.roleVersion,3);
    const receipts=await server.db.all(app.boardMemberRoleReceipts.where({boardId}));
    assert.ok(receipts.length>=3);
    assert.ok(receipts.every(r=>!Object.hasOwn(r,"email")));
  });
} finally {
  await server.close();
  await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
