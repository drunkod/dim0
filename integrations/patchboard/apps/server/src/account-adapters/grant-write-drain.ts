/**
 * SQL/Jazz revocation ordering: two-phase durable write drain, not a
 * cross-database atomic transaction. Reservation and pending-disconnect use
 * one BEGIN IMMEDIATE SQLite serialization point. Disconnection is confirmed
 * only after Jazz-authoritative writes have resolved and released their leases.
 * Unresolved writes never expire by TTL or silently permit confirmation.
 */
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { Db } from "jazz-tools";
import {app} from "@patchboard/jazz-schema";
import type {canvasPatchOperationIdentity} from "../canvas-versioned-patch.ts";
import {
  authorizeProtectedMcpInvocation, GrantDrainPending, GrantOwnerError,
  revokeVerifiedSubjectGrant, type GrantAdmission,
  type GrantRevocation, type VerifiedGrantReference,
} from "./grant-admission.ts";

export type ProtectedMcpWriteLease=Readonly<{
  id:string;grantId:string;admissionId:string;
}>;
export type McpLeaseOperation=Readonly<{
  tool:"create_note"|"create_canvas_entity"|"update_canvas_entity"|
    "patch_canvas_entity"|"delete_canvas_entity"|"update_applet_state";
  identity?:ReturnType<typeof canvasPatchOperationIdentity>;
}>;
function serialized<T>(db:DatabaseSync,action:()=>T):T {
  db.exec("BEGIN IMMEDIATE");
  try {const value=action();db.exec("COMMIT");return value;}
  catch(error){db.exec("ROLLBACK");throw error;}
}
export function beginProtectedMcpWriteLease(
  db:DatabaseSync,admission:GrantAdmission,grant:VerifiedGrantReference,
  operation?:McpLeaseOperation
):ProtectedMcpWriteLease|null {
  return serialized(db,()=>{
    // Admission, current grant version and pending-disconnect gate are checked
    // under the SAME SQL lock that creates the write lease.
    if(!authorizeProtectedMcpInvocation(db,admission,grant,"board:write"))
      return null;
    if(operation?.identity &&
      (operation.tool!=="patch_canvas_entity" ||
        operation.identity.tool!==operation.tool ||
        operation.identity.boardId!==grant.boardId))
      throw new Error("INVALID_SERVER_WRITE_OPERATION_IDENTITY");
    const id=randomUUID();
    db.prepare(`INSERT INTO patchboard_mcp_write_lease(
      id,grant_id,admission_id,opened_at_ms,tool_name,operation_identity,
      verified_subject_id,verified_board_id)
      VALUES(?,?,?,?,?,?,?,?)`).run(id,grant.id,admission.id,Date.now(),
        operation?.tool??"unattributed",
        operation?.identity?JSON.stringify(operation.identity):null,
        admission.subjectId,admission.boardId);
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

/** Decode persisted correlation defensively; invalid or legacy evidence cannot settle a lease. */
function isCanvasLeaseIdentity(value:unknown):value is ReturnType<typeof canvasPatchOperationIdentity>{
  if(!value || typeof value!=="object" || Array.isArray(value))return false;
  const v=value as Record<string,unknown>;
  const uuid=(id:unknown)=>typeof id==="string" &&
    /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id);
  return v.tool==="patch_canvas_entity" &&
    uuid(v.receiptId) && uuid(v.eventId) && uuid(v.entityId) &&
    uuid(v.boardId) && uuid(v.actorId) &&
    typeof v.requestId==="string" && /^[A-Za-z0-9_-]{1,128}$/.test(v.requestId) &&
    typeof v.expectedVersion==="number" && Number.isSafeInteger(v.expectedVersion) &&
    v.expectedVersion>=1 && v.expectedVersion<Number.MAX_SAFE_INTEGER &&
    typeof v.fingerprint==="string" && /^[a-f0-9]{64}$/.test(v.fingerprint);
}

/** Recovery is deliberately server-only. No timer or HTTP caller may invoke it. */
export type LeaseReconciliation=Readonly<{
  status:"WORKER_MAY_STILL_COMMIT"|"UNKNOWN_OPERATION"|"NO_RECEIPT"|
    "RECEIPT_MISMATCH"|"PROVED_COMMITTED"|"ALREADY_SETTLED";
  settled:boolean;
}>;
export async function reconcileTerminatedCanvasWriteLease(
  sql:DatabaseSync,jazz:Db,leaseId:string,
  proof:Readonly<{workerTerminated:boolean}>
):Promise<LeaseReconciliation>{
  const row=sql.prepare(`SELECT id,grant_id,admission_id,
    tool_name,operation_identity,verified_subject_id,verified_board_id
    FROM patchboard_mcp_write_lease WHERE id=?`).get(leaseId) as
    {id:string;grant_id:string;admission_id:string;
      tool_name:string;operation_identity:string|null;
      verified_subject_id:string|null;verified_board_id:string|null}|undefined;
  if(!row)return {status:"ALREADY_SETTLED",settled:true};
  // The proof requires a separately verified dead/fenced worker. A missing
  // Jazz receipt alone says NOTHING about an in-flight worker's future commit.
  if(!proof.workerTerminated)return {status:"WORKER_MAY_STILL_COMMIT",settled:false};
  if(row.tool_name!=="patch_canvas_entity" || !row.operation_identity)
    return {status:"UNKNOWN_OPERATION",settled:false};
  if(!row.verified_subject_id || !row.verified_board_id)
    return {status:"UNKNOWN_OPERATION",settled:false};
  let parsed:unknown;
  try{parsed=JSON.parse(row.operation_identity);}
  catch{return {status:"UNKNOWN_OPERATION",settled:false};}
  if(!isCanvasLeaseIdentity(parsed))
    return {status:"UNKNOWN_OPERATION",settled:false};
  const identity=parsed;
  const admitted=sql.prepare(`SELECT board_id,user_id FROM patchboard_mcp_admission
    WHERE id=? AND grant_id=?`).get(row.admission_id,row.grant_id) as
    {board_id:string;user_id:string}|undefined;
  const grant=sql.prepare(`SELECT board_id,user_id FROM patchboard_oauth_grant
    WHERE id=?`).get(row.grant_id) as
    {board_id:string;user_id:string}|undefined;
  // The short-lived admission ledger may be legitimately pruned before
  // recovery. Trust only the immutable subject/board captured in the LEASE
  // under the original SQL reservation lock, and optionally cross-check
  // an admission row still present.
  if(!grant || !row.verified_subject_id || !row.verified_board_id ||
    row.verified_board_id!==identity.boardId ||
    row.verified_subject_id!==grant.user_id ||
    grant.board_id!==identity.boardId ||
    (admitted && (admitted.board_id!==identity.boardId ||
      admitted.user_id!==grant.user_id)))
    return {status:"RECEIPT_MISMATCH",settled:false};
  const receipt=await jazz.one(
    app.canvasPatchReceipts.where({id:identity.receiptId}),{tier:"remote"});
  if(!receipt)return {status:"NO_RECEIPT",settled:false};
  const event=await jazz.one(
    app.canvasPatchEvents.where({id:identity.eventId}),{tier:"remote"});
  // Both rows were atomically written with the actual canvas patch in Jazz.
  // A mere current entity version, same request ID, or an unrelated event
  // never releases a grant lease.
  if(!event ||
    receipt.boardId!==identity.boardId ||
    receipt.entityId!==identity.entityId ||
    receipt.actorId!==identity.actorId ||
    receipt.requestId!==identity.requestId ||
    receipt.fingerprint!==identity.fingerprint ||
    receipt.previousVersion!==identity.expectedVersion ||
    receipt.committedVersion!==identity.expectedVersion+1 ||
    receipt.eventId!==identity.eventId ||
    event.receiptId!==receipt.id ||
    event.boardId!==identity.boardId ||
    event.entityId!==identity.entityId ||
    event.actorId!==identity.actorId ||
    event.requestId!==identity.requestId ||
    event.previousVersion!==identity.expectedVersion ||
    event.committedVersion!==identity.expectedVersion+1 ||
    event.field!=="label.markdown")
    return {status:"RECEIPT_MISMATCH",settled:false};
  // The worker cannot submit another write (explicit terminated/fenced proof).
  // No SQL/Jazz atomicity is inferred; the authoritative Jazz event+receipt
  // together establish this exact operation completed once.
  settleProtectedMcpWriteLease(sql,{
    id:row.id,grantId:row.grant_id,admissionId:row.admission_id,
  });
  return {status:"PROVED_COMMITTED",settled:true};
}
