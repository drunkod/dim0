/**
 * Typed text catalog and row creation (explicitly gated by each adapter). This is the ONE
 * authoritative server command path. No client-selected IDs or principals.
 * Existing typed-record patch and shared view projection stay independent.
 */
import {createHash} from "node:crypto";
import {PersistedWriteRejectedError,WriteWaitTimeoutError,type Db} from "jazz-tools";
import {app} from "@patchboard/jazz-schema";
import {TypedRecordPermissionDenied,TypedRecordGuardDenied,
  TypedRecordFieldInvalid,TypedRecordSchemaConflict,
  TypedRecordRequestConflict,TypedRecordCommitUnknown} from "./typed-record-patch.ts";

const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const req=/^[A-Za-z0-9_-]{1,128}$/;
function stableId(namespace:string,...parts:string[]):string{
  const bytes=createHash("sha256").update(namespace).update("\0")
    .update(parts.join("\0")).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&15)|0x50;
  bytes[8]=(bytes[8]!&63)|0x80;
  const h=bytes.toString("hex");
  return [h.slice(0,8),h.slice(8,12),h.slice(12,16),
    h.slice(16,20),h.slice(20)].join("-");
}
const fingerprint=(value:unknown)=>createHash("sha256")
  .update(JSON.stringify(value)).digest("hex");
export class TypedCatalogInvalid extends Error{
  constructor(){super("CATALOG_INVALID_DEFINITION");this.name="TypedCatalogInvalid";}
}
export class TypedCatalogConflict extends Error{
  constructor(){super("CATALOG_REQUEST_ID_CONFLICT");this.name="TypedCatalogConflict";}
}
export class TypedCatalogLimit extends Error{
  constructor(){super("CATALOG_ROW_LIMIT_500");this.name="TypedCatalogLimit";}
}
export class TypedCatalogCommitUnknown extends Error{
  constructor(readonly requestId:string){super("CATALOG_COMMIT_OUTCOME_UNKNOWN");}
}
const name=(value:string)=>{
  if(typeof value!=="string"||value!==value.trim()||value.length<1||
    value.length>80||Array.from(value).some(char=>{
      const cp=char.codePointAt(0)??0;
      return cp<32||cp===127;
    }))throw new TypedCatalogInvalid();
  return value;
};
async function owner(tx:Pick<Db,"one">,boardId:string,actorId:string){
  const board=await tx.one(app.boards.where({id:boardId}));
  if(!board||board.ownerId!==actorId)throw new TypedRecordPermissionDenied();
}
export type CreateTextTableInput=Readonly<{
  boardId:string;actorId:string;requestId:string;
  name:string;primaryFieldName:string;defaultViewName:string;
}>;
/** Exact, immutable operation identity for the SQL grant write lease.
 * This does not authorize anything, allocate a new ID or create a table. */
export function textTableOperationIdentity(input:CreateTextTableInput){
  // Validate the entire bounded catalog definition BEFORE writing any row.
  if(!uuid.test(input.boardId)||!uuid.test(input.actorId)||
    !req.test(input.requestId))throw new TypedCatalogInvalid();
  const datasetName=name(input.name),fieldName=name(input.primaryFieldName),
    viewName=name(input.defaultViewName);
  const ids=[input.boardId,input.actorId,input.requestId];
  const datasetId=stableId("dim0:catalog:dataset:v1",...ids);
  const fieldId=stableId("dim0:catalog:field:v1",...ids);
  const viewId=stableId("dim0:catalog:view:v1",...ids);
  const receiptId=stableId("dim0:catalog:receipt:v1",...ids);
  const eventId=stableId("dim0:catalog:event:v1",receiptId);
  const fp=fingerprint({boardId:input.boardId,name:datasetName,
    primaryFieldName:fieldName,defaultViewName:viewName,kind:"text",primary:true});
  return {tool:"call-api-write" as const,action:"dataset.create.v1" as const,
    boardId:input.boardId,actorId:input.actorId,requestId:input.requestId,
    datasetId,fieldId,viewId,receiptId,eventId,fingerprint:fp};
}
export async function createTextTable(db:Db,input:CreateTextTableInput,
  options:Readonly<{beforeWriteSubmit?:()=>void}>={}){
  const op=textTableOperationIdentity(input);
  const {datasetId,fieldId,viewId,receiptId,eventId}=op;
  const fp=op.fingerprint;
  const datasetName=input.name,fieldName=input.primaryFieldName,
    viewName=input.defaultViewName;
  options.beforeWriteSubmit?.();
  const tx=await db.serializableTransaction(async t=>{
    await owner(t,input.boardId,input.actorId);
    options.beforeWriteSubmit?.();
    const prior=await t.one(app.typedCatalogReceipts.where({id:receiptId}));
    if(prior){
      if(prior.fingerprint!==fp||prior.datasetId!==datasetId||
        prior.fieldId!==fieldId||prior.viewId!==viewId||
        prior.actorId!==input.actorId||prior.requestId!==input.requestId)
        throw new TypedCatalogConflict();
      const [dataset,field,view,event]=await Promise.all([
        t.one(app.typedDatasets.where({id:datasetId})),
        t.one(app.typedFields.where({id:fieldId})),
        t.one(app.typedViews.where({id:viewId})),
        t.one(app.typedCatalogEvents.where({id:eventId}))
      ]);
      if(!dataset||!field||!view||!event||
        dataset.boardId!==input.boardId||field.datasetId!==datasetId||
        view.datasetId!==datasetId||event.receiptId!==receiptId)
        throw new TypedCatalogConflict();
      options.beforeWriteSubmit?.();
      return {boardId:input.boardId,datasetId,fieldId,defaultViewId:viewId,
        schemaVersion:dataset.schemaVersion,receiptId,eventId,replayed:true};
    }
    options.beforeWriteSubmit?.();
    t.insert(app.typedDatasets,{
      boardId:input.boardId,name:datasetName,schemaVersion:1,state:"active"
    },{id:datasetId});
    t.insert(app.typedFields,{
      boardId:input.boardId,datasetId,name:fieldName,kind:"text",
      primary:true
    },{id:fieldId});
    t.insert(app.typedViews,{
      boardId:input.boardId,datasetId,name:viewName,
      kind:"grid",definitionVersion:1,
      allowedFieldIds:[fieldId],
      filter:{op:"text_prefix",fieldId,value:""},
      sort:{fieldId,direction:"asc"}
    },{id:viewId});
    t.insert(app.typedCatalogReceipts,{
      boardId:input.boardId,actorId:input.actorId,requestId:input.requestId,
      fingerprint:fp,datasetId,fieldId,viewId,eventId
    },{id:receiptId});
    t.insert(app.typedCatalogEvents,{
      boardId:input.boardId,actorId:input.actorId,requestId:input.requestId,
      receiptId,datasetId,fieldId,viewId
    },{id:eventId});
    return {boardId:input.boardId,datasetId,fieldId,defaultViewId:viewId,
      schemaVersion:1,receiptId,eventId,replayed:false};
  });
  try{await tx.wait({timeoutMs:10000});return tx.value;}
  catch(error){
    if(error instanceof WriteWaitTimeoutError)
      throw new TypedCatalogCommitUnknown(input.requestId);
    throw error;
  }
}
export type AddTextRowInput=Readonly<{
  boardId:string;datasetId:string;actorId:string;requestId:string;
  schemaVersion:number;fieldId:string;value:string
}>;
export async function addTextRow(db:Db,input:AddTextRowInput){
  if(![input.boardId,input.datasetId,input.actorId,input.fieldId]
    .every(id=>uuid.test(id))||!req.test(input.requestId)||
    !Number.isSafeInteger(input.schemaVersion)||input.schemaVersion<1||
    typeof input.value!=="string"||input.value.length>2000)
    throw new TypedRecordFieldInvalid();
  const parts=[input.boardId,input.datasetId,input.actorId,input.requestId];
  const recordId=stableId("dim0:typed-row:record:v1",...parts);
  const receiptId=stableId("dim0:typed-row:receipt:v1",...parts);
  const eventId=stableId("dim0:typed-row:event:v1",receiptId);
  const fp=fingerprint({boardId:input.boardId,datasetId:input.datasetId,
    fieldId:input.fieldId,value:input.value,schemaVersion:input.schemaVersion});
  const tx=await db.serializableTransaction(async t=>{
    await owner(t,input.boardId,input.actorId);
    const dataset=await t.one(app.typedDatasets.where({id:input.datasetId}));
    if(!dataset||dataset.boardId!==input.boardId)
      throw new TypedRecordPermissionDenied();
    if(dataset.state!=="active")throw new TypedRecordGuardDenied();
    const prior=await t.one(app.typedPatchReceipts.where({id:receiptId}));
    if(prior){
      if(prior.fingerprint!==fp||prior.recordId!==recordId||
        prior.actorId!==input.actorId||prior.requestId!==input.requestId||
        prior.datasetId!==input.datasetId)
        throw new TypedRecordRequestConflict();
      const existing=await t.one(app.typedRecords.where({id:recordId}));
      const event=await t.one(app.typedPatchEvents.where({id:eventId}));
      if(!existing||!event||event.receiptId!==receiptId)
        throw new TypedRecordRequestConflict();
      return {recordId,datasetId:input.datasetId,
        fieldId:input.fieldId,version:prior.committedVersion,
        schemaVersion:prior.schemaVersion,receiptId,eventId,
        updatedBy:input.actorId,replayed:true};
    }
    if(dataset.schemaVersion!==input.schemaVersion)
      throw new TypedRecordSchemaConflict();
    const fields=await t.all(app.typedFields.where({datasetId:input.datasetId}));
    if(fields.length!==1||fields[0]?.boardId!==input.boardId||
      fields[0]?.id!==input.fieldId||fields[0]?.kind!=="text"||
      fields[0]?.primary!==true||
      fields[0]?.computeFromFieldId!=null)
      throw new TypedRecordFieldInvalid();
    // Guard the same bounded dataset scan used by saved-view query.
    const existing=await t.all(app.typedRecords.where({datasetId:input.datasetId}).limit(500));
    if(existing.length>=500)throw new TypedCatalogLimit();
    const cells={[input.fieldId]:input.value};
    t.insert(app.typedRecords,{
      boardId:input.boardId,datasetId:input.datasetId,
      cells,version:1,updatedBy:input.actorId
    },{id:recordId});
    t.insert(app.typedPatchReceipts,{
      boardId:input.boardId,datasetId:input.datasetId,recordId,
      actorId:input.actorId,requestId:input.requestId,
      fingerprint:fp,schemaVersion:dataset.schemaVersion,
      previousVersion:0,committedVersion:1,
      committedCells:cells,eventId
    },{id:receiptId});
    t.insert(app.typedPatchEvents,{
      boardId:input.boardId,datasetId:input.datasetId,recordId,
      actorId:input.actorId,requestId:input.requestId,receiptId,
      previousVersion:0,committedVersion:1,
      fieldIds:[input.fieldId]
    },{id:eventId});
    return {recordId,datasetId:input.datasetId,fieldId:input.fieldId,
      version:1,schemaVersion:dataset.schemaVersion,updatedBy:input.actorId,
      receiptId,eventId,replayed:false};
  });
  try{await tx.wait({timeoutMs:10000});return tx.value;}
  catch(error){
    if(error instanceof PersistedWriteRejectedError){
      const actual=await db.one(app.typedPatchReceipts.where({id:receiptId}),
        {tier:"remote"});
      if(actual&&actual.fingerprint===fp&&actual.recordId===recordId)
        return {recordId,datasetId:input.datasetId,fieldId:input.fieldId,
          version:actual.committedVersion,schemaVersion:actual.schemaVersion,
          updatedBy:input.actorId,receiptId,eventId,replayed:true};
    }
    if(error instanceof WriteWaitTimeoutError)
      throw new TypedRecordCommitUnknown(input.requestId);
    throw error;
  }
}
