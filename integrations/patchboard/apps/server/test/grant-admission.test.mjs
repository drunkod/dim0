import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import {
  installGrantAdmissionLedger, admitVerifiedMcpGrant, revokeGrantWithReceipt,
  listCurrentSubjectGrants, revokeVerifiedSubjectGrant, GrantOwnerError,
} from "../src/account-adapters/grant-admission.ts";

const root = mkdtempSync(join(tmpdir(),"patchboard-acc-grant-fence-"));
const file=join(root,"grant.sqlite");
const db=new DatabaseSync(file);
const other=new DatabaseSync(file);
for(const conn of [db,other]) {
  conn.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=5000");
}
db.exec(`CREATE TABLE patchboard_oauth_grant (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
  board_id TEXT NOT NULL, created_at_ms INTEGER NOT NULL,
  revoked_at_ms INTEGER
);`);
installGrantAdmissionLedger(db);
installGrantAdmissionLedger(other);
const subj=randomUUID();
const board=randomUUID();
const board2=randomUUID();
const grantA={id:randomUUID(),userId:subj,clientId:"client-A",boardId:board};
const grantB={id:randomUUID(),userId:subj,clientId:"client-B",boardId:board2};
for(const grant of [grantA,grantB]) db.prepare(
 "INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)"
).run(grant.id,grant.userId,grant.clientId,grant.boardId,1000);
const scopes=new Set(["board:read","board:write"]);
const read=new Set(["board:read"]);
test("historical grant schema migrates version to 1 without invalidating consent",()=>{
  const row=db.prepare("SELECT grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?")
    .get(grantA.id);
  assert.equal(row.grant_version,1);
  assert.equal(row.revoked_at_ms,null);
  assert.equal(db.prepare("PRAGMA table_info(patchboard_oauth_grant)").all()
    .filter(x=>x.name==="grant_version").length,1);
});
test("verified token scope/client/board/subject is bound to single grant",()=>{
  assert.equal(admitVerifiedMcpGrant(db,{...grantA,userId:"spoof"},scopes),null);
  assert.equal(admitVerifiedMcpGrant(db,{...grantA,clientId:"client-B"},scopes),null);
  assert.equal(admitVerifiedMcpGrant(db,{...grantA,boardId:board2},scopes),null);
  assert.equal(admitVerifiedMcpGrant(db,grantA,new Set()),null);
  const admission=admitVerifiedMcpGrant(db,grantA,read,3000);
  assert.ok(admission);
  assert.equal(admission.subjectId,subj);
  assert.equal(admission.clientId,grantA.clientId);
  assert.equal(admission.grantId,grantA.id);
  assert.deepEqual(admission.admittedScopes,["board:read"]);
  assert.equal(admission.grantVersion,1);
  assert.equal(admission.expiresAtMs,63_000);
});
test("revocation first denies ALL future grants and cannot fallback with cached descriptor",()=>{
  const fence=revokeGrantWithReceipt(db,grantA.id,"revoke-A",4500);
  assert.deepEqual(fence,{
    id:grantA.id,committedVersion:2,revokedAtMs:4500
  });
  assert.equal(admitVerifiedMcpGrant(other,grantA,scopes,4501),null);
  assert.equal(admitVerifiedMcpGrant(other,grantA,read,4501),null);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM patchboard_grant_security_event").get().n,1);
});
test("pre-commit admission may finish under separate CURRENT Jazz membership policy",()=>{
  const admit=admitVerifiedMcpGrant(other,grantB,scopes,6000);
  assert.ok(admit);
  const fence=revokeGrantWithReceipt(db,grantB.id,"revoke-B",6001);
  assert.ok(fence);
  assert.equal(admit.grantVersion,1);
  assert.equal(db.prepare("SELECT grant_version FROM patchboard_oauth_grant WHERE id=?")
    .get(grantB.id).grant_version,2);
  assert.equal(admitVerifiedMcpGrant(other,grantB,scopes,6002),null);
  // The admission record cannot itself prove that Jazz membership survived.
  assert.ok(admit.expiresAtMs > fence.revokedAtMs);
});
test("same revoke idempotency receipt preserves version and avoids duplicate event",()=>{
  const before=db.prepare("SELECT COUNT(*) n FROM patchboard_grant_security_event").get().n;
  assert.deepEqual(revokeGrantWithReceipt(other,grantA.id,"revoke-A",9000),{
    id:grantA.id,committedVersion:2,revokedAtMs:4500
  });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM patchboard_grant_security_event").get().n,before);
  assert.equal(revokeGrantWithReceipt(other,grantA.id,"new-replay",9000).committedVersion,2);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM patchboard_grant_security_event").get().n,before);
});
test("two SQLite connections serialize admission/revoke through one write lock",()=>{
  other.exec("PRAGMA busy_timeout=1");
  db.exec("BEGIN IMMEDIATE");
  try {
    assert.throws(()=>admitVerifiedMcpGrant(other,grantA,scopes,9001),
      /locked|SQLITE_BUSY|database is locked/i);
  } finally { db.exec("ROLLBACK"); }
  assert.equal(admitVerifiedMcpGrant(other,grantA,scopes,9001),null);
});
test("invalid/unrecognized grant IDs deny and no principal data or email stored",()=>{
  assert.equal(admitVerifiedMcpGrant(db,{...grantA,id:randomUUID()},scopes),null);
  assert.equal(revokeGrantWithReceipt(db,randomUUID(),"unknown"),null);
  const row=db.prepare("SELECT admitted_scope FROM patchboard_mcp_admission LIMIT 1").get();
  assert.ok(row);
  const columns=db.prepare("PRAGMA table_info(patchboard_mcp_admission)").all().map(x=>x.name);
  assert.ok(!columns.includes("email"));
  assert.ok(!columns.includes("access_token"));
});
test("account owner can list and revoke exactly ONE client with versioned SQL receipt",()=>{
  const third={id:randomUUID(),userId:subj,clientId:"client-C",boardId:board};
  const foreign={id:randomUUID(),userId:randomUUID(),clientId:"client-X",boardId:board2};
  for(const grant of [third,foreign]) db.prepare(
    "INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)"
  ).run(grant.id,grant.userId,grant.clientId,grant.boardId,2000);
  const own=listCurrentSubjectGrants(db,subj);
  assert.ok(own.grants.some(grant=>grant.id===third.id));
  assert.ok(own.grants.every(grant=>grant.id!==foreign.id));
  assert.ok(listCurrentSubjectGrants(db,foreign.userId).grants.every(grant=>grant.id!==third.id));
  assert.throws(()=>revokeVerifiedSubjectGrant(db,foreign.userId,{
    grantId:third.id,clientId:third.clientId,expectedVersion:1,requestId:"other-user"
  }),error=>error instanceof GrantOwnerError && error.code==="FORBIDDEN");
  assert.throws(()=>revokeVerifiedSubjectGrant(db,subj,{
    grantId:third.id,clientId:"client-wrong",expectedVersion:1,requestId:"wrong-client"
  }),error=>error instanceof GrantOwnerError && error.code==="FORBIDDEN");
  assert.throws(()=>revokeVerifiedSubjectGrant(db,subj,{
    grantId:third.id,clientId:third.clientId,expectedVersion:5,requestId:"stale"
  }),error=>error instanceof GrantOwnerError && error.code==="STALE_STATE");
  const revoked=revokeVerifiedSubjectGrant(db,subj,{
    grantId:third.id,clientId:third.clientId,expectedVersion:1,requestId:"disconnect-C"
  },8500);
  assert.equal(revoked.committedVersion,2);
  assert.equal(revoked.revokedAtMs,8500);
  assert.equal(admitVerifiedMcpGrant(other,third,scopes,8501),null);
  assert.ok(admitVerifiedMcpGrant(other,foreign,read,8501));
  assert.deepEqual(revokeVerifiedSubjectGrant(other,subj,{
    grantId:third.id,clientId:third.clientId,expectedVersion:1,requestId:"disconnect-C"
  },9000),revoked,"identical request replay must return durable receipt");
  assert.throws(()=>revokeVerifiedSubjectGrant(db,subj,{
    grantId:third.id,clientId:third.clientId,expectedVersion:2,requestId:"disconnect-C"
  }),error=>error instanceof GrantOwnerError && error.code==="REQUEST_ID_CONFLICT");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM patchboard_grant_security_event WHERE grant_id=?").get(third.id).n,1);
});
test("historical provider revoke fingerprint remains replayable after Settings support",()=>{
  const historical={id:randomUUID(),userId:subj,clientId:"historical-provider",boardId:board};
  db.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms,revoked_at_ms,grant_version) VALUES(?,?,?,?,?,?,?)")
    .run(historical.id,historical.userId,historical.clientId,historical.boardId,1000,4500,2);
  const fingerprint=createHash("sha256").update(JSON.stringify({
    grantId:historical.id,userId:historical.userId,clientId:historical.clientId
  })).digest("hex");
  const requestId="revoke:"+historical.id;
  db.prepare("INSERT INTO patchboard_grant_revoke_receipt(grant_id,request_id,fingerprint,committed_version,revoked_at_ms) VALUES(?,?,?,?,?)")
    .run(historical.id,requestId,fingerprint,2,4500);
  assert.deepEqual(revokeGrantWithReceipt(db,historical.id,requestId,9000),{
    id:historical.id,committedVersion:2,revokedAtMs:4500
  });
});
test.after(()=>{
  db.close();other.close();
  rmSync(root,{recursive:true,force:true});
});
