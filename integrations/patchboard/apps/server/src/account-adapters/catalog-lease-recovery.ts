/**
 * ACC-051 QA: privileged, manual reconciliation of an orphaned MCP table-create
 * lease after the original writer is CONFIRMED terminated and fenced.
 *
 * No HTTP route, background timer or automatic unlock invokes this function.
 * Jazz and grant SQLite are separate stores; a missing receipt proves nothing
 * about an in-flight writer and must NEVER release its SQL drain reservation.
 */
import type {DatabaseSync} from "node:sqlite";
import type {Db} from "jazz-tools";
import {app} from "@patchboard/jazz-schema";
import {textTableOperationIdentity} from "../typed-catalog.ts";
import {settleProtectedMcpWriteLease,type ProtectedMcpWriteLease}
  from "./grant-write-drain.ts";
import type {LeaseReconciliation} from "./grant-write-drain.ts";

type CatalogIdentity=ReturnType<typeof textTableOperationIdentity>;
type DurableLease=Readonly<{
  id:string;grant_id:string;admission_id:string;
  tool_name:string;operation_identity:string|null;
  verified_subject_id:string|null;verified_board_id:string|null;
}>;
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const requestKey=/^[a-zA-Z0-9_-]{1,128}$/;
const keys=[
  "tool","action","boardId","actorId","requestId","datasetId",
  "fieldId","viewId","receiptId","eventId","fingerprint"
].sort();

function parseIdentity(value:string|null):CatalogIdentity|null{
  if(!value)return null;
  try{
    const parsed=JSON.parse(value) as unknown;
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return null;
    const record=parsed as Record<string,unknown>;
    if(JSON.stringify(Object.keys(record).sort())!==JSON.stringify(keys)||
      record.tool!=="call-api-write"||
      record.action!=="dataset.create.v1"||
      typeof record.requestId!=="string"||!requestKey.test(record.requestId)||
      typeof record.fingerprint!=="string"||!/^[a-f0-9]{64}$/.test(record.fingerprint)||
      !["boardId","actorId","datasetId","fieldId","viewId",
        "receiptId","eventId"].every(key=>
          typeof record[key]==="string"&&uuid.test(record[key])))return null;
    return parsed as CatalogIdentity;
  }catch{return null;}
}

/** Only a trusted operator/worker supervisor may assert worker termination.
 * Never use a timeout, missing receipt, old token or client request as proof.
 * A later recovery should use a NEW Jazz connection after the old writer exits.
 */
export async function reconcileTerminatedCatalogWriteLease(
  sql:DatabaseSync,jazz:Db,leaseId:string,
  proof:Readonly<{workerTerminated:boolean}>
):Promise<LeaseReconciliation>{
  const readLease=()=>sql.prepare(`SELECT id,grant_id,admission_id,tool_name,
    operation_identity,verified_subject_id,verified_board_id
    FROM patchboard_mcp_write_lease WHERE id=?`
  ).get(leaseId) as DurableLease|undefined;
  const lease=readLease();
  if(!lease)return {status:"ALREADY_SETTLED",settled:true};
  if(proof.workerTerminated!==true)
    return {status:"WORKER_MAY_STILL_COMMIT",settled:false};
  if(lease.tool_name!=="call-api-write")
    return {status:"UNKNOWN_OPERATION",settled:false};
  const identity=parseIdentity(lease.operation_identity);
  if(!identity)return {status:"UNKNOWN_OPERATION",settled:false};

  function authorityMatches(lease:DurableLease,identity:CatalogIdentity):boolean {
    // A lease's verified subject and selected board are written under the same
    // SQL lock as grant admission. Check them against the ORIGINAL grant row.
    // The identity mapping is server-confirmed Better Auth -> Jazz, not any
    // client-supplied actor. Missing mappings fail closed for manual review.
    const grant=sql.prepare(`SELECT id,user_id,client_id,board_id
      FROM patchboard_oauth_grant WHERE id=?`
    ).get(lease.grant_id) as {
      id:string;user_id:string;client_id:string;board_id:string
    }|undefined;
    const admission=sql.prepare(`SELECT grant_id,user_id,client_id,board_id,
      admitted_scope FROM patchboard_mcp_admission WHERE id=?`
    ).get(lease.admission_id) as {
      grant_id:string;user_id:string;client_id:string;board_id:string;
      admitted_scope:string
    }|undefined;
    let mapped:{jazz_account_id:string}|undefined;
    try{
      mapped=sql.prepare(`SELECT jazz_account_id FROM patchboard_jazz_identity
        WHERE auth_user_id=?`).get(grant?.user_id??"") as
        {jazz_account_id:string}|undefined;
    }catch{return false;}
    return !(!grant||!mapped||
      lease.verified_subject_id!==grant.user_id||
      lease.verified_board_id!==grant.board_id||
      identity.boardId!==grant.board_id||
      identity.actorId!==mapped.jazz_account_id||
      (admission&&(
        admission.grant_id!==grant.id||
        admission.user_id!==grant.user_id||
        admission.client_id!==grant.client_id||
        admission.board_id!==grant.board_id||
        !admission.admitted_scope.split(" ").includes("board:write")||
        !admission.admitted_scope.split(" ").includes("table:create")
      )));
  }
  if(!authorityMatches(lease,identity))return {status:"RECEIPT_MISMATCH",settled:false};

  const receipt=await jazz.one(app.typedCatalogReceipts.where({
    id:identity.receiptId
  }),{tier:"remote"});
  if(!receipt)return {status:"NO_RECEIPT",settled:false};

  const [event,dataset,field,view]=await Promise.all([
    jazz.one(app.typedCatalogEvents.where({id:identity.eventId}),{
      tier:"remote"
    }),
    jazz.one(app.typedDatasets.where({id:identity.datasetId}),{
      tier:"remote"
    }),
    jazz.one(app.typedFields.where({id:identity.fieldId}),{
      tier:"remote"
    }),
    jazz.one(app.typedViews.where({id:identity.viewId}),{
      tier:"remote"
    })
  ]);
  if(!event||!dataset||!field||!view)
    return {status:"RECEIPT_MISMATCH",settled:false};

  // Recompute the exact original canonical payload fingerprint AND all five
  // deterministic object IDs from the CURRENT persisted catalog definition.
  // If the catalog has since changed, fail closed rather than infer a result.
  // In particular a legitimate Owner view edit must never be reverted to make
  // the recovery proof pass. This helper does not mutate Jazz.
  let computed:CatalogIdentity;
  try{
    computed=textTableOperationIdentity({
      boardId:identity.boardId,actorId:identity.actorId,
      requestId:identity.requestId,name:dataset.name,
      primaryFieldName:field.name,defaultViewName:view.name
    });
  }catch{return {status:"RECEIPT_MISMATCH",settled:false};}
  const idMatches=keys.every(key=>computed[key as keyof CatalogIdentity]===
    identity[key as keyof CatalogIdentity]);
  const receiptMatches=receipt.id===identity.receiptId&&
    receipt.boardId===identity.boardId&&
    receipt.actorId===identity.actorId&&
    receipt.requestId===identity.requestId&&
    receipt.fingerprint===identity.fingerprint&&
    receipt.datasetId===identity.datasetId&&
    receipt.fieldId===identity.fieldId&&
    receipt.viewId===identity.viewId&&
    receipt.eventId===identity.eventId;
  const eventMatches=event.id===identity.eventId&&
    event.receiptId===identity.receiptId&&
    event.boardId===identity.boardId&&
    event.actorId===identity.actorId&&
    event.requestId===identity.requestId&&
    event.datasetId===identity.datasetId&&
    event.fieldId===identity.fieldId&&
    event.viewId===identity.viewId;
  const schemaMatches=dataset.id===identity.datasetId&&
    dataset.boardId===identity.boardId&&
    dataset.schemaVersion===1&&dataset.state==="active"&&
    field.id===identity.fieldId&&
    field.boardId===identity.boardId&&
    field.datasetId===identity.datasetId&&field.kind==="text"&&
    field.primary===true&&field.computeFromFieldId==null&&view.id===identity.viewId&&
    view.boardId===identity.boardId&&
    view.datasetId===identity.datasetId&&
    view.kind==="grid"&&view.definitionVersion===1&&
    Array.isArray(view.allowedFieldIds)&&
    view.allowedFieldIds.length===1&&
    view.allowedFieldIds[0]===identity.fieldId&&
    view.filter!==null&&typeof view.filter==="object"&&
    !Array.isArray(view.filter)&&
    Object.keys(view.filter).sort().join()==="fieldId,op,value"&&
    view.filter.op==="text_prefix"&&
    view.filter.fieldId===identity.fieldId&&
    view.filter.value===""&&
    view.sort!==null&&typeof view.sort==="object"&&
    !Array.isArray(view.sort)&&
    Object.keys(view.sort).sort().join()==="direction,fieldId"&&
    view.sort.fieldId===identity.fieldId&&
    view.sort.direction==="asc";
  if(!idMatches||!receiptMatches||!eventMatches||!schemaMatches)
    return {status:"RECEIPT_MISMATCH",settled:false};

  // Serialize the final compare-and-settle against SQL grant/disconnect work.
  // No SQL transaction is held across the remote Jazz reads. The supervisor
  // must provide a fenced writer and a quiescent authoritative Jazz store.
  sql.exec("BEGIN IMMEDIATE");
  try {
    const current=readLease();
    let result:LeaseReconciliation;
    if(!current)result={status:"ALREADY_SETTLED",settled:true};
    else if(JSON.stringify(current)!==JSON.stringify(lease)||!authorityMatches(current,identity))
      result={status:"RECEIPT_MISMATCH",settled:false};
    else {
      const release:ProtectedMcpWriteLease={
        id:lease.id,grantId:lease.grant_id,admissionId:lease.admission_id
      };
      settleProtectedMcpWriteLease(sql,release);
      result={status:"PROVED_COMMITTED",settled:true};
    }
    sql.exec("COMMIT");
    return result;
  }catch(error){sql.exec("ROLLBACK");throw error;}
}
