/**
 * Private SQLite grant admission/revocation fence. Production server-only.
 * Verified @better-auth/mcp token claims are required BEFORE this API.
 * The grant row + grant_version is the shared serialized conflict point.
 * No Jazz/SQLite cross-store atomicity is claimed.
 */
import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

export type VerifiedGrantReference = Readonly<{
  id: string; userId: string; clientId: string; boardId: string;
}>;
export type GrantAdmission = Readonly<{
  id:string; grantId:string; subjectId:string; clientId:string; boardId:string;
  grantVersion:number; admittedScopes:readonly ("board:read"|"board:write")[];
  admittedAtMs:number; expiresAtMs:number;
}>;
export type GrantRevocation = Readonly<{
  id:string;committedVersion:number;revokedAtMs:number;
}>;
type Row = {id:string;user_id:string;client_id:string;board_id:string;
  revoked_at_ms:number|null;grant_version:number};
type ReceiptRow = {fingerprint:string;committed_version:number;revoked_at_ms:number};
export function installGrantAdmissionLedger(db:DatabaseSync):void {
  const cols=db.prepare("PRAGMA table_info(patchboard_oauth_grant)").all() as
    {name:string}[];
  if (!cols.some(column=>column.name==="grant_version"))
    db.exec("ALTER TABLE patchboard_oauth_grant ADD COLUMN grant_version INTEGER NOT NULL DEFAULT 1");
  db.exec(`CREATE TABLE IF NOT EXISTS patchboard_mcp_admission (
    id TEXT PRIMARY KEY,
    grant_id TEXT NOT NULL, user_id TEXT NOT NULL, client_id TEXT NOT NULL,
    board_id TEXT NOT NULL, grant_version INTEGER NOT NULL,
    admitted_scope TEXT NOT NULL, admitted_at_ms INTEGER NOT NULL,
    expires_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS patchboard_mcp_admission_expiry
    ON patchboard_mcp_admission(expires_at_ms);
  CREATE TABLE IF NOT EXISTS patchboard_grant_revoke_receipt (
    grant_id TEXT NOT NULL, request_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL, committed_version INTEGER NOT NULL,
    revoked_at_ms INTEGER NOT NULL,
    PRIMARY KEY(grant_id,request_id)
  );
  CREATE TABLE IF NOT EXISTS patchboard_grant_security_event (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL,
    event_type TEXT NOT NULL, occurred_at_ms INTEGER NOT NULL,
    safe_context TEXT NOT NULL
  );`);
}
function grantRow(db:DatabaseSync,id:string):Row|undefined {
  return db.prepare(`SELECT id,user_id,client_id,board_id,
    revoked_at_ms,grant_version FROM patchboard_oauth_grant WHERE id=?`)
    .get(id) as Row|undefined;
}
function serialized<T>(db:DatabaseSync,command:()=>T):T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result=command();
    db.exec("COMMIT");
    return result;
  } catch(error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
/**
 * The subject/client and scopes originate ONLY from requireMcpAuth,
 * NOT a client-supplied body. Each admitted request has a server-owned
 * short-lived receipt; grant version is serialized against revoke.
 */
export function admitVerifiedMcpGrant(
  db:DatabaseSync,verified:VerifiedGrantReference,
  verifiedTokenScopes:ReadonlySet<string>,nowEpochMs=Date.now()
):GrantAdmission|null {
  if (!verified.id || !verified.userId || !verified.clientId || !verified.boardId)
    return null;
  const scopes=(["board:read","board:write"] as const)
    .filter(scope=>verifiedTokenScopes.has(scope));
  if (scopes.length===0) return null;
  return serialized(db,()=>{
    const row=grantRow(db,verified.id);
    if (!row || row.revoked_at_ms!==null ||
        row.user_id!==verified.userId ||
        row.client_id!==verified.clientId ||
        row.board_id!==verified.boardId) return null;
    const receipt:GrantAdmission={
      id:randomUUID(),grantId:row.id,subjectId:row.user_id,
      clientId:row.client_id,boardId:row.board_id,
      grantVersion:row.grant_version,admittedScopes:scopes,
      admittedAtMs:nowEpochMs,expiresAtMs:nowEpochMs+60_000
    };
    db.prepare("DELETE FROM patchboard_mcp_admission WHERE expires_at_ms < ?")
      .run(nowEpochMs-60_000);
    db.prepare(`INSERT INTO patchboard_mcp_admission
      (id,grant_id,user_id,client_id,board_id,grant_version,
       admitted_scope,admitted_at_ms,expires_at_ms)
      VALUES(?,?,?,?,?,?,?,?,?)`).run(
      receipt.id,receipt.grantId,receipt.subjectId,receipt.clientId,
      receipt.boardId,receipt.grantVersion,scopes.join(" "),
      nowEpochMs,receipt.expiresAtMs
    );
    return receipt;
  });
}
/**
 * Check EVERY protected MCP callback before it begins work, not merely once
 * before an HTTP transport handles a possibly batched request. The receipt
 * must be server-minted, bound to the verified subject/client/board/version,
 * present in private SQLite, and younger than its fixed 60-second TTL.
 *
 * Do not check the live revoke bit here: a call already admitted before a
 * durable revoke may finish, subject to current Jazz membership at mutation.
 * It cannot start another protected callback after its admission expires.
 * No receipt is accepted from an MCP argument, bearer token or browser body.
 */
export function authorizeProtectedMcpInvocation(
  db: DatabaseSync,
  admission: GrantAdmission,
  verified: VerifiedGrantReference,
  scope: "board:read" | "board:write",
  nowEpochMs = Date.now(),
): boolean {
  if (!Number.isFinite(nowEpochMs) || nowEpochMs < admission.admittedAtMs ||
      nowEpochMs >= admission.expiresAtMs ||
      admission.expiresAtMs - admission.admittedAtMs !== 60_000 ||
      !admission.admittedScopes.includes(scope) ||
      admission.grantId !== verified.id ||
      admission.subjectId !== verified.userId ||
      admission.clientId !== verified.clientId ||
      admission.boardId !== verified.boardId) return false;
  const row = db.prepare(`SELECT grant_id,user_id,client_id,board_id,
    grant_version,admitted_scope,admitted_at_ms,expires_at_ms
    FROM patchboard_mcp_admission WHERE id=?`).get(admission.id) as {
      grant_id:string;user_id:string;client_id:string;board_id:string;
      grant_version:number;admitted_scope:string;admitted_at_ms:number;
      expires_at_ms:number;
    } | undefined;
  return Boolean(row && row.grant_id === admission.grantId &&
    row.user_id === admission.subjectId &&
    row.client_id === admission.clientId &&
    row.board_id === admission.boardId &&
    row.grant_version === admission.grantVersion &&
    row.admitted_at_ms === admission.admittedAtMs &&
    row.expires_at_ms === admission.expiresAtMs &&
    row.admitted_scope.split(" ").includes(scope));
}

/**
 * Existing revokeBoardGrant delegates here. The SQL revoke version,
 * sanitized event and request receipt commit atomically. Replayed
 * requests preserve the original ordering, never restore authority.
 */
export function revokeGrantWithReceipt(
  db:DatabaseSync,id:string,requestId:string="revoke:"+id,
  nowEpochMs=Date.now()
):GrantRevocation|null {
  if (!id || !requestId || id.length>200 || requestId.length>200)
    throw new Error("INVALID_REVOKE_REQUEST");
  return serialized(db,()=>{
    const row=grantRow(db,id);
    if (!row) return null;
    const fingerprint=createHash("sha256")
      .update(JSON.stringify({
        grantId:id,userId:row.user_id,clientId:row.client_id
      })).digest("hex");
    const prior=db.prepare(`SELECT fingerprint,committed_version,revoked_at_ms
      FROM patchboard_grant_revoke_receipt
      WHERE grant_id=? AND request_id=?`).get(id,requestId) as
      ReceiptRow|undefined;
    if (prior) {
      if (prior.fingerprint!==fingerprint) throw new Error("REQUEST_ID_CONFLICT");
      return {id,committedVersion:prior.committed_version,revokedAtMs:prior.revoked_at_ms};
    }
    const committedVersion=row.revoked_at_ms===null ?
      row.grant_version+1 : row.grant_version;
    const revokedAtMs=row.revoked_at_ms??nowEpochMs;
    if (row.revoked_at_ms===null) {
      const updated=db.prepare(`UPDATE patchboard_oauth_grant
        SET revoked_at_ms=?,grant_version=? WHERE id=?
        AND revoked_at_ms IS NULL AND grant_version=?`)
        .run(revokedAtMs,committedVersion,id,row.grant_version);
      if (updated.changes!==1) throw new Error("STALE_GRANT_VERSION");
      db.prepare(`INSERT INTO patchboard_grant_security_event
        (id,grant_id,event_type,occurred_at_ms,safe_context)
        VALUES(?,?,?,?,?)`).run(
        "revoke:"+id,id,"oauth_grant_revoked",revokedAtMs,
        JSON.stringify({clientId:row.client_id,boardId:row.board_id})
      );
    }
    db.prepare(`INSERT INTO patchboard_grant_revoke_receipt
      (grant_id,request_id,fingerprint,committed_version,revoked_at_ms)
      VALUES(?,?,?,?,?)`).run(
      id,requestId,fingerprint,committedVersion,revokedAtMs
    );
    return {id,committedVersion,revokedAtMs};
  });
}
