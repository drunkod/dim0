import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createJazz, sqlite } from "jazz-tools/backend";
import { app } from "@patchboard/jazz-schema";
import privatePermissions from "@patchboard/jazz-schema/private.permissions.json" with { type: "json" };
import { claimBearerInvitation } from "../src/account-adapters/bearer-invitation-claim.ts";
import { changeNativeBoardMemberRole } from "../src/account-adapters/board-member-role.ts";
import { BoardRoleChangeError } from "@patchboard/account-domain/native-board-member";

process.env.JAZZ_APP_DIR = new URL("../../../packages/jazz-schema", import.meta.url).pathname;

test("reusable bearer-link upgrade and owner-role CAS share one Jazz membership revision", async (t) => {
  const path = await mkdtemp(join(tmpdir(), "dim0-invite-role-cas-"));
  const server = await createJazz({
    app, permissions: privatePermissions, store: sqlite({ path }),
    authenticate: () => null, // private backend tests use server-only administrator operations
  }).ready();
  async function fixture({ memberRole = "viewer", inviteRole = "editor", singleUse = false } = {}) {
    const owner = randomUUID(), member = randomUUID(), boardId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    const digest = createHash("sha256").update(token).digest("hex");
    const boardWrite = server.db.insert(app.boards, {
      ownerId: owner, title: "Revision contract",
    }, { id: boardId });
    await boardWrite.wait({tier:"global"});
    const memberWrite = server.db.insert(app.boardMembers, {
      boardId, userId: member, role: memberRole,
    });
    await memberWrite.wait({tier:"global"});
    const inviteWrite = server.db.insert(app.boardInvites, {
      boardId, token: digest, role: inviteRole, singleUse,
      expiresAtEpochMs: singleUse ? Date.now() + 7 * 86_400_000 : null,
    });
    await inviteWrite.wait({tier:"global"});
    const current = () => server.db.one(app.boardMembers.where({id:memberWrite.value.id}));
    return {owner,member,boardId,token,digest,current,inviteId:inviteWrite.value.id,
      memberRowId:memberWrite.value.id};
  }
  const role = (f, assignedRole, expectedVersion, requestId) =>
    changeNativeBoardMemberRole(server.db,f.owner,{
      boardId:f.boardId,memberId:f.member,assignedRole,expectedVersion,requestId
    });
  async function mustReject(code, action) {
    await assert.rejects(action, error => {
      assert.ok(error instanceof BoardRoleChangeError, String(error));
      assert.equal(error.code,code);
      return true;
    });
  }
  try {
    await t.test("invite first: Viewer→Editor increments version and stale owner command is refused",async()=>{
      const f=await fixture();
      const preUpgradeVersion=(await f.current()).roleVersion;
      assert.equal(preUpgradeVersion,1);
      const accepted=await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      assert.equal(accepted.role,"editor");
      const member=await f.current();
      assert.equal(member.role,"editor");
      assert.equal(member.roleVersion,2,
        "the same roleVersion changed by the owner CAS must also advance through bearer upgrades");
      await mustReject("STALE_MEMBER_VERSION",()=>role(f,"viewer",preUpgradeVersion,"owner-captured-before-invite"));
      assert.equal((await f.current()).role,"editor");
      assert.equal((await f.current()).roleVersion,2);
      assert.equal((await server.db.one(app.boardInvites.where({id:f.inviteId})))?.singleUse,false,
        "reusable link remains available");
      const second=await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      assert.equal(second.role,"editor");
      assert.equal((await f.current()).roleVersion,2,"already Editor must not bump again");
    });

    await t.test("owner first: role update wins, invitation no-op cannot overwrite or bump it",async()=>{
      const f=await fixture();
      const ownerChange=await role(f,"editor",1,"owner-first");
      assert.equal(ownerChange.membershipVersion,2);
      await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      assert.equal((await f.current()).role,"editor");
      assert.equal((await f.current()).roleVersion,2,
        "replaying a reusable Editor invite after owner promotion is a no-op");
      const replay=await role(f,"editor",1,"owner-first");
      assert.equal(replay.receiptId,ownerChange.receiptId);
      assert.equal((await f.current()).roleVersion,2);
    });

    await t.test("viewer link cannot downgrade an Editor or increment the revision",async()=>{
      const f=await fixture({memberRole:"editor",inviteRole:"viewer"});
      await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      assert.equal((await f.current()).role,"editor");
      assert.equal((await f.current()).roleVersion,1);
    });

    await t.test("unchanged Viewer role does not increment the revision",async()=>{
      const f=await fixture({memberRole:"viewer",inviteRole:"viewer"});
      await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      assert.equal((await f.current()).role,"viewer");
      assert.equal((await f.current()).roleVersion,1);
    });

    await t.test("prior owner no-op receipt becomes stale after a reusable link upgrade",async()=>{
      const f=await fixture();
      const receipt=await role(f,"viewer",1,"before-invite-noop");
      assert.equal(receipt.changed,false);
      await claimBearerInvitation(server.db,f.boardId,f.digest,f.member);
      await mustReject("RECEIPT_STALE",()=>role(f,"viewer",1,"before-invite-noop"));
      const rows=await server.db.all(app.boardMemberRoleReceipts.where({boardId:f.boardId}));
      assert.equal(rows.filter(r=>r.requestId==="before-invite-noop").length,1);
      assert.equal((await f.current()).roleVersion,2);
    });

    await t.test("existing member cannot consume single-use invitation",async()=>{
      const f=await fixture({singleUse:true});
      await assert.rejects(()=>claimBearerInvitation(server.db,f.boardId,f.digest,f.member),/INVITE_INVALID/);
      assert.equal((await f.current()).roleVersion,1);
      assert.ok(await server.db.one(app.boardInvites.where({id:f.inviteId})),
        "unsuccessful acceptance cannot consume a single-use link");
    });

    await t.test("new member consumes a single-use link, cannot claim it twice",async()=>{
      const f=await fixture({singleUse:true});
      const newcomer=randomUUID();
      const result=await claimBearerInvitation(server.db,f.boardId,f.digest,newcomer);
      assert.equal(result.role,"editor");
      assert.equal((await server.db.one(app.boardMembers.where({
        boardId:f.boardId,userId:newcomer
      }))).roleVersion,1);
      assert.equal(await server.db.one(app.boardInvites.where({id:f.inviteId})),null);
      await assert.rejects(()=>claimBearerInvitation(server.db,f.boardId,f.digest,randomUUID()),/INVITE_INVALID/);
    });

    await t.test("overlapping owner promotion and reusable claim serialize to one version increment",async()=>{
      const f=await fixture();
      const prepared=1; // Owner saw this committed revision before both operations.
      const results=await Promise.allSettled([
        claimBearerInvitation(server.db,f.boardId,f.digest,f.member),
        role(f,"editor",prepared,"owner-invite-same-role-race"),
      ]);
      assert.ok(results.some(result=>result.status==="fulfilled"),
        "at least the legitimate upgrade must eventually commit");
      const member=await f.current();
      assert.equal(member.role,"editor");
      assert.equal(member.roleVersion,2,
        "both paths must not independently increment the same revision");
      for (const result of results) {
        if (result.status==="rejected") {
          assert.match(String(result.reason),
            /STALE_MEMBER_VERSION|serializ|transaction_conflict|not_observed/i);
        }
      }
      const receipts=await server.db.all(
        app.boardMemberRoleReceipts.where({boardId:f.boardId}));
      assert.ok(receipts.length<=1, "only an actually committed owner change may leave a receipt");
      assert.equal((await server.db.one(app.boardInvites.where({id:f.inviteId})))?.singleUse,false);
    });

    await t.test("revoke-first prevents claim; claim-first membership survives link revocation",async()=>{
      const f=await fixture();
      await server.db.delete(app.boardInvites,f.inviteId).wait({tier:"global"});
      await assert.rejects(()=>claimBearerInvitation(server.db,f.boardId,f.digest,f.member),/INVITE_INVALID/);
      assert.equal((await f.current()).roleVersion,1);
      const f2=await fixture();
      await claimBearerInvitation(server.db,f2.boardId,f2.digest,f2.member);
      await server.db.delete(app.boardInvites,f2.inviteId).wait({tier:"global"});
      assert.equal((await f2.current()).role,"editor");
      assert.equal((await f2.current()).roleVersion,2);
    });
  } finally {
    await server.close();
    await rm(path,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});
