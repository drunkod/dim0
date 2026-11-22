import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app as legacy } from "./fixtures/pre-account-role-schema/jazz.generated.ts";
import legacyPermissions from "./fixtures/pre-account-role-schema/private.permissions.json" with { type: "json" };
import { app } from "@patchboard/jazz-schema";
import currentPermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
const currentSchemaDir=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const legacySchemaDir=new URL("./fixtures/pre-account-role-schema",import.meta.url).pathname;
process.env.JAZZ_APP_DIR=legacySchemaDir;

test("existing board membership migrates to roleVersion=1 without changing grants",async()=>{
  const path=await mkdtemp(join(tmpdir(),"dim0-legacy-board-role-migration-"));
  const owner=randomUUID(),memberId=randomUUID();
  let boardId,legacyMember;
  try {
    const oldServer=await createJazz({
      app:legacy,permissions:legacyPermissions,store:sqlite({path}),
      authenticate:()=>null
    }).ready();
    try {
      const board=oldServer.db.insert(legacy.boards,{title:"Old privately shared board",ownerId:owner});
      await board.wait({tier:"global"});
      boardId=board.value.id;
      const member=oldServer.db.insert(legacy.boardMembers,{
        boardId,userId:memberId,role:"editor"
      });
      await member.wait({tier:"global"});
      legacyMember=member.value.id;
      assert.ok(!Object.hasOwn(member.value,"roleVersion"));
    } finally {await oldServer.close();}
    process.env.JAZZ_APP_DIR=currentSchemaDir;
    const server=await createJazz({
      app,permissions:currentPermissions,store:sqlite({path}),
      authenticate:()=>null
    }).ready();
    try {
      const preserved=await server.db.one(app.boards.where({id:boardId}));
      const member=await server.db.one(app.boardMembers.where({id:legacyMember}));
      assert.equal(preserved?.ownerId,owner);
      assert.equal(member?.userId,memberId);
      assert.equal(member?.role,"editor");
      assert.equal(member?.roleVersion,1);
      assert.deepEqual(await server.db.all(app.boardMemberRoleReceipts.where({boardId})),[]);
      console.log("ACC_ROLE_LEGACY_MIGRATION_PASS",{boardId,legacyMember});
    } finally {await server.close();}
  } finally {
    await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:250});
  }
});
