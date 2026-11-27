/** Persisted review-base and historical workspace fixtures advance along the
 * original schema chain without enabling any workspace authorization. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import guestPermissions from "@patchboard/jazz-schema/jazz.permissions.json" with {type:"json"};
import { app as reviewBase } from "./fixtures/pre-workspace-schema/jazz.generated.ts";
import basePermissions from "./fixtures/pre-workspace-schema/private.permissions.json" with {type:"json"};
import { app as historicalWorkspace } from "./fixtures/pre-base-provenance-schema/jazz.generated.ts";
import workspacePermissions from "./fixtures/pre-base-provenance-schema/private.permissions.json" with {type:"json"};
import { requirePrivateBoardAccess } from "../src/board-service.ts";

const currentDir=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const fixtures=[
  {hash:"9d49ba9e8ab9",dir:"pre-workspace-schema",app:reviewBase,permissions:basePermissions},
  {hash:"039361478a64",dir:"pre-base-provenance-schema",app:historicalWorkspace,permissions:workspacePermissions},
];
const names=["workspaces","boardWorkspaceBindings","workspaceMemberships","baseMemberships","workspaceOwnerSets","workspaceAccountReceipts"];
test("new workspace storage is server-only under both policies",()=>{
  for(const policy of [privatePermissions,guestPermissions])for(const name of names)
    assert.deepEqual(policy.tables[name],{read:"false",insert:"false",update:"false",delete:"false"});
});
for(const fixture of fixtures)test("preserve persisted "+fixture.hash+" through provenance and restart",async()=>{
  const path=await mkdtemp(join(tmpdir(),"dim0-canvas-ancestry-"));
  const boardId=randomUUID(),memberId=randomUUID(),entityId=randomUUID(),owner=randomUUID(),editor=randomUUID(),outsider=randomUUID(),workspaceId=randomUUID(),baseId=randomUUID();
  const payload={id:entityId,graphUid:boardId,type:"note",version:7,label:{markdown:"Historical v7"},content:{markdown:"Preserve this content"}};
  let server;
  const open=(model,permissions)=>createJazz({app:model,permissions,store:sqlite({path}),authenticate:()=>null}).ready();
  try {
    process.env.JAZZ_APP_DIR=new URL("./fixtures/"+fixture.dir,import.meta.url).pathname;
    server=await open(fixture.app,fixture.permissions);
    const db=server.db,old=fixture.app;
    await db.insert(old.boards,{title:"Preserved board",ownerId:owner},{id:boardId}).wait({tier:"global"});
    await db.insert(old.boardMembers,{boardId,userId:editor,role:"editor",roleVersion:2},{id:memberId}).wait({tier:"global"});
    await db.insert(old.canvasEntities,{boardId,kind:"node",payload,version:7,updatedBy:owner},{id:entityId}).wait({tier:"global"});
    if(fixture.hash==="039361478a64"){
      await db.insert(old.workspaces,{name:"Historical workspace",createdBy:owner,state:"active"},{id:workspaceId}).wait({tier:"global"});
      await db.insert(old.boardWorkspaceBindings,{boardId,workspaceId,version:1},{id:boardId}).wait({tier:"global"});
      await db.insert(old.workspaceMemberships,{workspaceId,actorId:outsider,role:"editor",state:"active",version:1,proof:"verified_better_auth"}).wait({tier:"global"});
      await db.insert(old.baseMemberships,{workspaceId,boardId,actorId:editor,role:"editor",state:"active",version:2},{id:baseId}).wait({tier:"global"});
    }
    await server.close();server=null;
    process.env.JAZZ_APP_DIR=currentDir;
    for(let reopen=0;reopen<2;reopen++){
      server=await open(app,privatePermissions);
      const db=server.db;
      const board=await db.one(app.boards.where({id:boardId}));
      const member=await db.one(app.boardMembers.where({id:memberId}));
      const entity=await db.one(app.canvasEntities.where({id:entityId}));
      assert.equal(board.id,boardId);assert.equal(board.ownerId,owner);
      assert.equal(member.id,memberId);assert.equal(member.userId,editor);
      assert.equal(member.role,"editor");assert.equal(member.roleVersion,2);
      assert.equal(entity.id,entityId);assert.deepEqual(entity.payload,payload);
      assert.equal(entity.version,7);assert.equal(entity.updatedBy,owner);
      if(fixture.hash==="039361478a64"){
        const base=await db.one(app.baseMemberships.where({id:baseId}));
        assert.equal(base.actorId,editor);assert.equal(base.version,2);
        assert.equal(base.legacyMemberId??null,null,"No manufactured lineage");
        assert.equal((await db.one(app.workspaces.where({id:workspaceId}))).name,"Historical workspace");
        assert.equal((await db.one(app.boardWorkspaceBindings.where({id:boardId}))).workspaceId,workspaceId);
      }else assert.deepEqual(await db.all(app.workspaces),[]);
      await requirePrivateBoardAccess(db,boardId,editor,true);
      await assert.rejects(()=>requirePrivateBoardAccess(db,boardId,outsider,true));
      await server.close();server=null;
    }
    console.log("CANVAS_ANCESTRY_MIGRATION_PASS",JSON.stringify({from:fixture.hash,to:"8d726a3304d2",reopened:true,boardAndMemberIdsPreserved:true,entityIdPreserved:true,version:7,writerPreserved:true,inheritedDenied:true}));
  }finally{
    await server?.close();process.env.JAZZ_APP_DIR=currentDir;
    await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
