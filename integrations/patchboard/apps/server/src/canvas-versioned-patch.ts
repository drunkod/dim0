/**
 * ACC-051 canvas-only, single-field versioned mutation. Typed Teable record
 * parity is OUT OF SCOPE. Both private HTTP and MCP route to this command.
 *
 * Only the authenticated issuer passes actorId. The callback's current Jazz
 * board/editor role and target board are re-read INSIDE the serializable
 * transaction before even inspecting the deterministic request receipt.
 */
import { createHash } from "node:crypto";
import { PersistedWriteRejectedError, WriteWaitTimeoutError, type Db } from "jazz-tools";
import { app } from "@patchboard/jazz-schema";
import {
  checkAccess, jazzCanvasStorageId, projectCanvasEntity, validateCanvasPayload,
  CanvasPermissionDenied, CanvasConflict, CanvasInvalid,
  type CanvasEntity,
} from "./canvas-entity-service.ts";

export type CanvasFieldPatch = Readonly<{ label_markdown: string }>;
export type CanvasVersionedPatchInput = Readonly<{
  boardId: string;
  actorId: string;
  id: string;
  expectedVersion: number;
  requestId: string;
  patch: CanvasFieldPatch;
}>;
export type CanvasPatchResult = CanvasEntity & Readonly<{
  receiptId: string;
  eventId: string;
  previousVersion: number;
  replayed: boolean;
}>;
export class CanvasPatchRequestConflict extends Error {
  constructor() { super("REQUEST_ID_CONFLICT"); this.name="CanvasPatchRequestConflict"; }
}
export class CanvasPatchCommitUnknown extends Error {
  constructor(readonly requestId:string,readonly receiptId:string) {
    super("COMMIT_OUTCOME_UNKNOWN"); this.name="CanvasPatchCommitUnknown";
  }
}
const uuidFromHash=(namespace:string,...parts:string[])=>{
  const bytes=createHash("sha256").update(namespace).update("\0")
    .update(parts.join("\0")).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&0x0f)|0x50;
  bytes[8]=(bytes[8]!&0x3f)|0x80;
  const h=bytes.toString("hex");
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),
    h.slice(16,20),h.slice(20)].join("-");
};
function ids(input:CanvasVersionedPatchInput) {
  const receiptId=uuidFromHash("dim0:canvas-patch:receipt:v1",
    input.boardId,input.actorId,input.requestId);
  return {receiptId,eventId:uuidFromHash("dim0:canvas-patch:event:v1",receiptId)};
}
const fingerprint=(input:CanvasVersionedPatchInput)=>createHash("sha256")
  .update(JSON.stringify({
    boardId:input.boardId,entityId:jazzCanvasStorageId(input.id),
    expectedVersion:input.expectedVersion,patch:input.patch
  })).digest("hex");

/**
 * Server-only opaque durable correlation for a recovered MCP grant lease.
 * This contains IDs, versions and SHA-256; never stores a note label in SQL.
 * It is the SAME identity function used by the Jazz mutation itself.
 */
export function canvasPatchOperationIdentity(input:CanvasVersionedPatchInput){
  validateInput(input);
  return {
    tool:"patch_canvas_entity" as const,
    boardId:input.boardId,actorId:input.actorId,
    entityId:jazzCanvasStorageId(input.id),requestId:input.requestId,
    expectedVersion:input.expectedVersion,
    ...ids(input),fingerprint:fingerprint(input),
  };
}

function validateInput(input:CanvasVersionedPatchInput):void {
  if(!input.actorId || !Number.isSafeInteger(input.expectedVersion) ||
    input.expectedVersion<1 || !/^[a-zA-Z0-9_-]{1,128}$/.test(input.requestId) ||
    typeof input.patch?.label_markdown!=="string" ||
    input.patch.label_markdown.length>2000)
    throw new CanvasInvalid("Invalid canvas patch request");
  jazzCanvasStorageId(input.id);
}

function receiptResult(row:{
  entityId:string;boardId:string;actorId:string;committedPayload:unknown;
  committedVersion:number;previousVersion:number;eventId:string;id:string
},originalId:string):CanvasPatchResult {
  const payload=row.committedPayload;
  if(!payload || typeof payload!=="object" || Array.isArray(payload))
    throw new CanvasInvalid("Invalid committed canvas receipt");
  // Only the previously committed sanitized snapshot can be replayed, never
  // an optimistic local entity value or a replaced different entity ID.
  const entity=projectCanvasEntity({
    id:row.entityId,boardId:row.boardId,kind:"node",
    payload,version:row.committedVersion,updatedBy:row.actorId
  });
  if(entity.id!==originalId)throw new CanvasInvalid("Receipt entity mismatch");
  return {...entity,previousVersion:row.previousVersion,
    receiptId:row.id,eventId:row.eventId,replayed:true};
}

/**
 * Server-only scheduling seam for a deterministic *queued-before-transaction*
 * race test; not a client input, flag, or claim. Authorization is performed
 * after this seam and cannot be skipped by it.
 */
export async function patchCanvasLabelMarkdown(
  db:Db,input:CanvasVersionedPatchInput,
  options:Readonly<{
    beforeTransaction?:()=>Promise<void>;
    beforeWriteSubmit?:()=>void;
  }>={}
):Promise<CanvasPatchResult> {
  const {entityId:storageId,receiptId,eventId,fingerprint:inputHash}=canvasPatchOperationIdentity(input);
  await options.beforeTransaction?.();
  options.beforeWriteSubmit?.();
  const result=await db.serializableTransaction(async tx=>{
    // No stored receipt can revive a demoted or removed member.
    await checkAccess(tx,input.boardId,input.actorId,true);
    const entity=await tx.one(app.canvasEntities.where({id:storageId}));
    if(!entity || entity.boardId!==input.boardId)
      throw new CanvasPermissionDenied();
    const prior=await tx.one(app.canvasPatchReceipts.where({id:receiptId}));
    if(prior){
      if(prior.fingerprint!==inputHash ||
        prior.entityId!==storageId || prior.actorId!==input.actorId ||
        prior.boardId!==input.boardId)
        throw new CanvasPatchRequestConflict();
      return receiptResult(prior,input.id);
    }
    if(entity.version!==input.expectedVersion)throw new CanvasConflict();
    if(entity.kind!=="node")throw new CanvasInvalid("Only canvas nodes can be patched");
    const old=projectCanvasEntity(entity);
    const label=old.payload.label;
    if(!label || typeof label!=="object" || Array.isArray(label))
      throw new CanvasInvalid("Canvas node has no label object");
    const nextVersion=entity.version+1;
    const payload={...old.payload,
      version:nextVersion,
      label:{...label,markdown:input.patch.label_markdown}
    };
    validateCanvasPayload(input.boardId,"node",payload);
    // Entire content, geometry, graph, kind and ID are preserved; only
    // label.markdown and synchronized payload.version are changed.
    tx.update(app.canvasEntities,storageId,{
      payload,version:nextVersion,updatedBy:input.actorId
    });
    tx.insert(app.canvasPatchReceipts,{
      boardId:input.boardId,entityId:storageId,actorId:input.actorId,
      requestId:input.requestId,fingerprint:inputHash,
      previousVersion:entity.version,committedVersion:nextVersion,
      committedPayload:payload,eventId
    },{id:receiptId});
    tx.insert(app.canvasPatchEvents,{
      boardId:input.boardId,entityId:storageId,actorId:input.actorId,
      requestId:input.requestId,receiptId,
      previousVersion:entity.version,committedVersion:nextVersion,
      field:"label.markdown"
    },{id:eventId});
    return {...old,payload,version:nextVersion,updatedBy:input.actorId,
      previousVersion:entity.version,receiptId,eventId,replayed:false};
  });
  try {
    await result.wait({timeoutMs:10000});
    return result.value;
  } catch(error) {
    if(error instanceof PersistedWriteRejectedError){
      // Two concurrent v7 writes can both read version seven, but the losing
      // transaction is rejected at Jazz authority after its sibling commits.
      // Normalize only a *confirmed* changed remote version to API conflict.
      const current=await db.one(app.canvasEntities.where({id:storageId}),
        {tier:"remote"});
      if(current?.boardId===input.boardId &&
        current.version!==input.expectedVersion)throw new CanvasConflict();
    }
    if(!(error instanceof WriteWaitTimeoutError))throw error;
    // Commit outcome is UNKNOWN. Do not issue a new key; a deliberate retry
    // must reauthorize and reconcile the SAME receipt ID.
    throw new CanvasPatchCommitUnknown(input.requestId,receiptId);
  }
}
