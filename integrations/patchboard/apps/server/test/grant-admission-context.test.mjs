import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  installGrantAdmissionLedger, admitVerifiedMcpGrant, revokeGrantWithReceipt,
  authorizeProtectedMcpInvocation,
} from "../src/account-adapters/grant-admission.ts";

const fixture = () => {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE patchboard_oauth_grant(
    id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,
    board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,
    revoked_at_ms INTEGER
  )`);
  installGrantAdmissionLedger(db);
  const reference={id:randomUUID(),userId:randomUUID(),clientId:randomUUID(),boardId:randomUUID()};
  db.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)")
    .run(reference.id,reference.userId,reference.clientId,reference.boardId,100);
  return {db,reference};
};
const scopes=new Set(["board:read","board:write"]);
test("each protected callback validates its own durable server admission scope and board",()=>{
  const {db,reference}=fixture();
  try {
    const receipt=admitVerifiedMcpGrant(db,reference,scopes,1000);
    assert.ok(receipt);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",1001),true);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:read",1001),true);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,{...reference,boardId:randomUUID()},"board:read",1001),false);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,{...reference,userId:randomUUID()},"board:read",1001),false);
    assert.equal(authorizeProtectedMcpInvocation(db,{...receipt,grantVersion:receipt.grantVersion+1},reference,"board:write",1001),false);
    assert.equal(authorizeProtectedMcpInvocation(db,{...receipt,id:randomUUID()},reference,"board:write",1001),false);
    assert.equal(authorizeProtectedMcpInvocation(db,{...receipt,expiresAtMs:receipt.expiresAtMs+5000},reference,"board:write",1001),false);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",receipt.expiresAtMs),false,
      "a queued or delayed callback cannot start after the receipt expires");
  } finally {db.close();}
});
test("read-scope callback cannot mutate; delayed batch callback checked separately",()=>{
  const {db,reference}=fixture();
  try {
    const receipt=admitVerifiedMcpGrant(db,reference,new Set(["board:read"]),1000);
    assert.ok(receipt);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:read",1001),true);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",1001),false);
    let writes=0;
    const executeAt=(now)=>{if(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",now)) writes++;};
    executeAt(1002);
    executeAt(60_999);
    assert.equal(writes,0);
  } finally {db.close();}
});
test("revoke first denies admission; earlier admitted callback may enter before TTL, but not after",()=>{
  const {db,reference}=fixture();
  try {
    const receipt=admitVerifiedMcpGrant(db,reference,scopes,1000);
    assert.ok(receipt);
    revokeGrantWithReceipt(db,reference.id,"revoke",2000);
    assert.equal(admitVerifiedMcpGrant(db,reference,scopes,2001),null);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",2001),true,
      "approved pre-revoke admission may finish under current Jazz policy");
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:write",61_000),false);
  } finally {db.close();}
});
test("an unknown or pruned persisted admission receipt denies even with a copied in-memory object",()=>{
  const {db,reference}=fixture();
  try {
    const receipt=admitVerifiedMcpGrant(db,reference,scopes,1000);
    assert.ok(receipt);
    db.prepare("DELETE FROM patchboard_mcp_admission WHERE id=?").run(receipt.id);
    assert.equal(authorizeProtectedMcpInvocation(db,receipt,reference,"board:read",1001),false);
  } finally {db.close();}
});
