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
export type AccountGrantSummary = Readonly<{
  id:string; clientId:string; boardId:string;
  grantVersion:number; createdAtMs:number; revokedAtMs:number|null;
  pendingDisconnect:Readonly<{requestId:string;expectedVersion:number}>|null;
}>;
export type VerifiedGrantRevokeIntent = Readonly<{
  subjectId:string; clientId:string; expectedVersion:number;
}>;
export class GrantDrainPending extends Error {
  constructor(){super("WRITE_DRAIN_PENDING");this.name="GrantDrainPending";}
}
export class GrantOwnerError extends Error {
  constructor(readonly code:"FORBIDDEN"|"STALE_STATE"|"REQUEST_ID_CONFLICT") {
    super(code);
    this.name="GrantOwnerError";
  }
}
/** Owner-scoped consent metadata and original retry intent; never a bearer token. */
export function listCurrentSubjectGrants(
  db:DatabaseSync,verifiedSubjectId:string
):{grants:readonly AccountGrantSummary[];hasMore:boolean} {
  if (!verifiedSubjectId) throw new GrantOwnerError("FORBIDDEN");
  const rows=db.prepare(`SELECT g.id,g.client_id,g.board_id,g.grant_version,
    g.created_at_ms,g.revoked_at_ms,p.request_id AS pending_request_id,
    p.expected_version AS pending_expected_version
    FROM patchboard_oauth_grant g
    LEFT JOIN patchboard_grant_disconnect_pending p
      ON p.grant_id=g.id AND p.subject_id=g.user_id AND p.client_id=g.client_id
      AND p.expected_version=g.grant_version AND g.revoked_at_ms IS NULL
    WHERE g.user_id=? ORDER BY g.created_at_ms DESC LIMIT 101`)
    .all(verifiedSubjectId) as {
      id:string;client_id:string;board_id:string;grant_version:number;
      created_at_ms:number;revoked_at_ms:number|null;
      pending_request_id:string|null;pending_expected_version:number|null;
    }[];
  const prefix="self:"+verifiedSubjectId+":";
  return {hasMore:rows.length>100,grants:rows.slice(0,100).map(row=>{
    const requestId=row.pending_request_id?.startsWith(prefix)
      ? row.pending_request_id.slice(prefix.length) : null;
    // Recover the owner's existing command after a reload. Its eventual retry
    // still passes the authenticated version/ownership checks in the writer.
    const pendingDisconnect=requestId && /^[A-Za-z0-9_-]{1,128}$/.test(requestId) &&
      row.pending_expected_version!==null &&
      Number.isSafeInteger(row.pending_expected_version) && row.pending_expected_version>0
      ? {requestId,expectedVersion:row.pending_expected_version} : null;
    return {
      id:row.id,clientId:row.client_id,boardId:row.board_id,
      grantVersion:row.grant_version,createdAtMs:row.created_at_ms,
      revokedAtMs:row.revoked_at_ms,pendingDisconnect
    };
  })};
}

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
  -- Durable cross-store drain fence. NEVER time-expire a possibly committed
  -- Jazz write without authoritative reconciliation.
  CREATE TABLE IF NOT EXISTS patchboard_mcp_write_lease (
    id TEXT PRIMARY KEY, grant_id TEXT NOT NULL,
    admission_id TEXT NOT NULL, opened_at_ms INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS patchboard_mcp_write_lease_grant
    ON patchboard_mcp_write_lease(grant_id);
  CREATE TABLE IF NOT EXISTS patchboard_grant_disconnect_pending (
    grant_id TEXT PRIMARY KEY, subject_id TEXT NOT NULL,
    client_id TEXT NOT NULL, expected_version INTEGER NOT NULL,
    request_id TEXT NOT NULL, started_at_ms INTEGER NOT NULL
  );
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
  // Rehearsed additive upgrade: the earlier sprint's leases have no durable
  // operation identity and MUST remain unresolved, never inferred from version.
  db.exec("BEGIN IMMEDIATE");
  try{
    const writeLeaseCols=new Set((db.prepare(
      "PRAGMA table_info(patchboard_mcp_write_lease)").all() as {name:string}[])
      .map(x=>x.name));
    if(!writeLeaseCols.has("tool_name")) db.exec(
      "ALTER TABLE patchboard_mcp_write_lease ADD COLUMN tool_name TEXT NOT NULL DEFAULT 'unattributed'");
    if(!writeLeaseCols.has("operation_identity")) db.exec(
      "ALTER TABLE patchboard_mcp_write_lease ADD COLUMN operation_identity TEXT");
    if(!writeLeaseCols.has("verified_subject_id")) db.exec(
      "ALTER TABLE patchboard_mcp_write_lease ADD COLUMN verified_subject_id TEXT");
    if(!writeLeaseCols.has("verified_board_id")) db.exec(
      "ALTER TABLE patchboard_mcp_write_lease ADD COLUMN verified_board_id TEXT");
    db.exec("COMMIT");
  }catch(error){db.exec("ROLLBACK");throw error;}
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
        db.prepare("SELECT 1 FROM patchboard_grant_disconnect_pending WHERE grant_id=?").get(row.id) ||
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
 * A callback FIRST entering after durable revoke or grant-version change
 * must be denied, even when its HTTP admission receipt remains within TTL.
 * A read already past this check and the native membership guard may finish.
 * A pending disconnect blocks new callbacks. An exact existing write lease
 * can finish before the disconnect confirms; it never time-expires.
 * No receipt is accepted from an MCP argument, bearer token or browser body.
 */
export function authorizeProtectedMcpInvocation(
  db: DatabaseSync,
  admission: GrantAdmission,
  verified: VerifiedGrantReference,
  scope: "board:read" | "board:write",
  nowEpochMs = Date.now(),
  activeWriteLeaseId?: string,
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
  // Revocation/version is authoritative at callback entry, not HTTP admission.
  // SQLite's synchronous read observes commits made before this call starts.
  const liveGrant = grantRow(db, admission.grantId);
  const activeLease=scope==="board:write" && activeWriteLeaseId && Boolean(db.prepare(
    "SELECT 1 FROM patchboard_mcp_write_lease WHERE id=? AND grant_id=? AND admission_id=?"
  ).get(activeWriteLeaseId,admission.grantId,admission.id));
  const pending=Boolean(db.prepare("SELECT 1 FROM patchboard_grant_disconnect_pending WHERE grant_id=?").get(admission.grantId));
  return Boolean(row && liveGrant && liveGrant.revoked_at_ms === null &&
    (!pending || activeLease) &&
    liveGrant.grant_version === admission.grantVersion &&
    liveGrant.id === verified.id &&
    liveGrant.user_id === verified.userId &&
    liveGrant.client_id === verified.clientId &&
    liveGrant.board_id === verified.boardId &&
    row.grant_id === admission.grantId &&
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
  nowEpochMs=Date.now(),verifiedOwner?:VerifiedGrantRevokeIntent
):GrantRevocation|null {
  if (!id || !requestId || id.length>200 || requestId.length>200)
    throw new Error("INVALID_REVOKE_REQUEST");
  return serialized(db,()=>{
    const row=grantRow(db,id);
    if (!row) {
      if (verifiedOwner) throw new GrantOwnerError("FORBIDDEN");
      return null;
    }
    if (verifiedOwner && (row.user_id!==verifiedOwner.subjectId ||
        row.client_id!==verifiedOwner.clientId))
      throw new GrantOwnerError("FORBIDDEN");
    const fingerprint=createHash("sha256")
      .update(JSON.stringify({
        grantId:id,userId:row.user_id,clientId:row.client_id,
        ...(verifiedOwner ? {expectedVersion:verifiedOwner.expectedVersion} : {})
      })).digest("hex");
    const prior=db.prepare(`SELECT fingerprint,committed_version,revoked_at_ms
      FROM patchboard_grant_revoke_receipt
      WHERE grant_id=? AND request_id=?`).get(id,requestId) as
      ReceiptRow|undefined;
    if (prior) {
      if (prior.fingerprint!==fingerprint) {
        if (verifiedOwner) throw new GrantOwnerError("REQUEST_ID_CONFLICT");
        throw new Error("REQUEST_ID_CONFLICT");
      }
      return {id,committedVersion:prior.committed_version,revokedAtMs:prior.revoked_at_ms};
    }
    // A provider or competing owner request cannot overtake a pending intent.
    // The same SQL lock protects reservation, pending gate, revoke and cleanup.
    if (db.prepare("SELECT 1 FROM patchboard_mcp_write_lease WHERE grant_id=? LIMIT 1").get(id))
      throw new GrantDrainPending();
    const pending = db.prepare("SELECT request_id,subject_id,client_id,expected_version FROM patchboard_grant_disconnect_pending WHERE grant_id=?")
      .get(id) as {request_id:string;subject_id:string;client_id:string;expected_version:number}|undefined;
    if (pending && (!verifiedOwner || pending.request_id!==requestId ||
      pending.subject_id!==verifiedOwner.subjectId || pending.client_id!==verifiedOwner.clientId ||
      pending.expected_version!==verifiedOwner.expectedVersion)) {
      if (!verifiedOwner) throw new GrantDrainPending();
      throw new GrantOwnerError("STALE_STATE");
    }
    // Replay was handled above. Brand-new requests with a stale version fail,
    // including attempts to re-revoke a grant without refreshing the listing.
    if (verifiedOwner && row.grant_version!==verifiedOwner.expectedVersion)
      throw new GrantOwnerError("STALE_STATE");
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
    if (pending) db.prepare("DELETE FROM patchboard_grant_disconnect_pending WHERE grant_id=? AND request_id=?").run(id,requestId);
    return {id,committedVersion,revokedAtMs};
  });
}


/**
 * Current session can revoke ONE selected Board grant with exact expected
 * version. No raw OAuth token, no browser logout, no unrelated client.
 * Same SQL serialized authority as MCP admitIfLive and refresh checks.
 */
export function revokeVerifiedSubjectGrant(
  db:DatabaseSync,subjectId:string,input:{
    grantId:string;clientId:string;expectedVersion:number;requestId:string
  },nowEpochMs=Date.now()
):GrantRevocation {
  if (!subjectId || !input.clientId ||
      !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1 ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId))
    throw new GrantOwnerError("FORBIDDEN");
  const result=revokeGrantWithReceipt(db,input.grantId,
    "self:"+subjectId+":"+input.requestId,nowEpochMs,{
      subjectId,clientId:input.clientId,expectedVersion:input.expectedVersion
    });
  if (!result) throw new GrantOwnerError("FORBIDDEN");
  return result;
}
