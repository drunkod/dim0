/**
 * SQL/Jazz revocation ordering: two-phase durable write drain, not a
 * cross-database atomic transaction. Reservation and pending-disconnect use
 * one BEGIN IMMEDIATE SQLite serialization point. Disconnection is confirmed
 * only after Jazz-authoritative writes have resolved and released their leases.
 * Unresolved writes never expire by TTL or silently permit confirmation.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  authorizeProtectedMcpInvocation, GrantDrainPending, GrantOwnerError,
  revokeVerifiedSubjectGrant, type GrantAdmission,
  type GrantRevocation, type VerifiedGrantReference,
} from "./grant-admission.ts";

export type ProtectedMcpWriteLease=Readonly<{
  id:string;grantId:string;admissionId:string;
}>;
function serialized<T>(db:DatabaseSync,action:()=>T):T {
  db.exec("BEGIN IMMEDIATE");
  try {const value=action();db.exec("COMMIT");return value;}
  catch(error){db.exec("ROLLBACK");throw error;}
}
export function beginProtectedMcpWriteLease(
  db:DatabaseSync,admission:GrantAdmission,grant:VerifiedGrantReference
):ProtectedMcpWriteLease|null {
  return serialized(db,()=>{
    // Admission, current grant version and pending-disconnect gate are checked
    // under the SAME SQL lock that creates the write lease.
    if(!authorizeProtectedMcpInvocation(db,admission,grant,"board:write"))
      return null;
    const id=randomUUID();
    db.prepare("INSERT INTO patchboard_mcp_write_lease(id,grant_id,admission_id,opened_at_ms) VALUES(?,?,?,?)")
      .run(id,grant.id,admission.id,Date.now());
    return {id,grantId:grant.id,admissionId:admission.id};
  });
}
export function settleProtectedMcpWriteLease(
  db:DatabaseSync,lease:ProtectedMcpWriteLease
):void {
  db.prepare("DELETE FROM patchboard_mcp_write_lease WHERE id=? AND grant_id=? AND admission_id=?")
    .run(lease.id,lease.grantId,lease.admissionId);
}
/** Keep the durable lease unless the callback reports a confirmed outcome.
 * Exact, server-generated diagnostics only; unknown or thrown failures retain it. */
export async function runReservedMcpWrite<T>(
  db:DatabaseSync,lease:ProtectedMcpWriteLease,action:()=>Promise<T>
):Promise<T> {
  const reply=await action();
  if(reply && typeof reply==="object" && "content" in reply && Array.isArray(reply.content)){
    const failure="isError" in reply && reply.isError;
    const diagnostic=failure && reply.content.length===1 ? String(reply.content[0]?.text??"") : "";
    const knownFailure=/^(BOARD_ACCESS_DENIED|BOARD_WRITE_DENIED|INSUFFICIENT_SCOPE: board:write required|GRANT_ADMISSION_EXPIRED_OR_INVALID|REQUEST_ID_CONFLICT|VERSION_CONFLICT|INVALID_ENTITY|BOARD_UNAVAILABLE|WRITE_REJECTED)$/.test(diagnostic);
    if(!failure || knownFailure)settleProtectedMcpWriteLease(db,lease);
  }
  return reply;
}

export function outstandingMcpWrites(db:DatabaseSync,grantId:string):number{
  const row=db.prepare("SELECT COUNT(*) AS n FROM patchboard_mcp_write_lease WHERE grant_id=?")
    .get(grantId) as {n:number};
  return row.n;
}

/** Server-owned, session-bound disconnection. POST 200 is the visible boundary. */
export async function disconnectAfterMcpWritesDrain(
  db:DatabaseSync,subjectId:string,
  intent:Readonly<{
    grantId:string;clientId:string;expectedVersion:number;requestId:string
  }>,
  options:Readonly<{maxWaitMs?:number;pollMs?:number}>={}
):Promise<GrantRevocation>{
  if(!subjectId || !intent.clientId || !intent.grantId ||
    !Number.isSafeInteger(intent.expectedVersion) || intent.expectedVersion<1 ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(intent.requestId))
    throw new GrantOwnerError("FORBIDDEN");
  const requestId="self:"+subjectId+":"+intent.requestId;
  serialized(db,()=>{
    const row=db.prepare("SELECT user_id,client_id,grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE id=?")
      .get(intent.grantId) as {user_id:string;client_id:string;
        grant_version:number;revoked_at_ms:number|null}|undefined;
    if(!row || row.user_id!==subjectId || row.client_id!==intent.clientId)
      throw new GrantOwnerError("FORBIDDEN");
    const previous=db.prepare("SELECT request_id,expected_version,subject_id,client_id FROM patchboard_grant_disconnect_pending WHERE grant_id=?")
      .get(intent.grantId) as {request_id:string;expected_version:number;
        subject_id:string;client_id:string}|undefined;
    if(previous){
      if(previous.subject_id!==subjectId ||
        previous.client_id!==intent.clientId ||
        previous.expected_version!==intent.expectedVersion ||
        previous.request_id!==requestId)
        throw new GrantOwnerError("STALE_STATE");
      return;
    }
    if(row.revoked_at_ms!==null)return; // validate original receipt replay below
    if(row.grant_version!==intent.expectedVersion)
      throw new GrantOwnerError("STALE_STATE");
    db.prepare("INSERT INTO patchboard_grant_disconnect_pending(grant_id,subject_id,client_id,expected_version,request_id,started_at_ms) VALUES(?,?,?,?,?,?)")
      .run(intent.grantId,subjectId,intent.clientId,
        intent.expectedVersion,requestId,Date.now());
  });
  const maxWaitMs=options.maxWaitMs??10_000;
  const pollMs=options.pollMs??25;
  const deadline=Date.now()+maxWaitMs;
  // Pending SQL gate already denies any new write lease and MCP callback.
  // The grant's durable revoked_at_ms stays NULL until this drain completes,
  // so a connected-apps refresh cannot falsely display "Disconnected".
  while(outstandingMcpWrites(db,intent.grantId)>0){
    if(Date.now()>=deadline)throw new GrantDrainPending();
    await new Promise(resolve=>setTimeout(resolve,pollMs));
  }
  // No await between this check and the synchronous serialized revoke. The
  // underlying revoke also rechecks active leases while holding the SQL lock.
  const result=revokeVerifiedSubjectGrant(db,subjectId,{
    grantId:intent.grantId,clientId:intent.clientId,
    expectedVersion:intent.expectedVersion,requestId:intent.requestId
  });
  // The revoke transaction also removes the matching pending intent atomically.
  return result;
}
