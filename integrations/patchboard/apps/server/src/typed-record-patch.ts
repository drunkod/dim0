/**
 * ACC-051 first QA-only TYPED record edit. Browser and OAuth MCP use this
 * SAME command; neither JSON transport can provide actorId or grant scopes.
 * Strongly scoped direct native Owner/Editor, dataset, record, schema and
 * field provenance are re-evaluated in ONE Jazz serializable transaction.
 *
 * Only text updates and a deterministic text-codepoint-length computed cell
 * are supported. No Teable multi-table/view/commercial parity is implied.
 */
import {createHash} from "node:crypto";
import {PersistedWriteRejectedError,WriteWaitTimeoutError,type Db,type JsonValue} from "jazz-tools";
import {app} from "@patchboard/jazz-schema";

export type TypedRecordSet=Readonly<Record<string,string|number|boolean|null>>;
export type TypedRecordPatchInput=Readonly<{
  boardId:string;datasetId:string;recordId:string;actorId:string;
  schemaVersion:number;expectedVersion:number;requestId:string;
  set:TypedRecordSet;
}>;
export type TypedRecordPatchResult=Readonly<{
  boardId:string;datasetId:string;recordId:string;schemaVersion:number;
  version:number;previousVersion:number;updatedBy:string;
  cells:Readonly<Record<string,unknown>>;
  receiptId:string;eventId:string;replayed:boolean;
}>;
export class TypedRecordPermissionDenied extends Error {
  constructor(){super("TYPED_RECORD_ACCESS_DENIED");this.name="TypedRecordPermissionDenied";}
}
export class TypedRecordGuardDenied extends Error {
  constructor(){super("SERVICE_GUARD_DENIED");this.name="TypedRecordGuardDenied";}
}
export class TypedRecordFieldInvalid extends Error {
  constructor(){super("TYPED_FIELD_NOT_WRITABLE_OR_INVALID");this.name="TypedRecordFieldInvalid";}
}
export class TypedRecordSchemaConflict extends Error {
  constructor(){super("SCHEMA_VERSION_CONFLICT");this.name="TypedRecordSchemaConflict";}
}
export class TypedRecordVersionConflict extends Error {
  constructor(){super("VERSION_CONFLICT");this.name="TypedRecordVersionConflict";}
}
export class TypedRecordRequestConflict extends Error {
  constructor(){super("REQUEST_ID_CONFLICT");this.name="TypedRecordRequestConflict";}
}
export class TypedRecordCommitUnknown extends Error {
  constructor(readonly requestId:string){
    super("COMMIT_OUTCOME_UNKNOWN");this.name="TypedRecordCommitUnknown";
  }
}
const uuidPattern=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
function derivedUuid(namespace:string,...parts:string[]):string{
  const bytes=createHash("sha256").update(namespace).update("\0")
    .update(parts.join("\0")).digest().subarray(0,16);
  bytes[6]=(bytes[6]!&15)|0x50;
  bytes[8]=(bytes[8]!&63)|0x80;
  const v=bytes.toString("hex");
  return [v.slice(0,8),v.slice(8,12),v.slice(12,16),
    v.slice(16,20),v.slice(20)].join("-");
}
function validatedSet(input:TypedRecordPatchInput):[string,string]{
  if(!uuidPattern.test(input.boardId) || !uuidPattern.test(input.datasetId) ||
    !uuidPattern.test(input.recordId) || !uuidPattern.test(input.actorId) ||
    !Number.isSafeInteger(input.schemaVersion) || input.schemaVersion<1 ||
    !Number.isSafeInteger(input.expectedVersion) || input.expectedVersion<1 || input.expectedVersion>=Number.MAX_SAFE_INTEGER ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(input.requestId) ||
    !input.set || typeof input.set!=="object" || Array.isArray(input.set))
    throw new TypedRecordFieldInvalid();
  const keys=Object.keys(input.set);
  if(keys.length!==1 || !uuidPattern.test(keys[0]!) ||
    typeof input.set[keys[0]!]!=="string" ||
    (input.set[keys[0]!] as string).length>2000)
    throw new TypedRecordFieldInvalid();
  return [keys[0]!,input.set[keys[0]!] as string];
}
function operationIdentity(input:TypedRecordPatchInput){
  const [fieldId,value]=validatedSet(input);
  const receiptId=derivedUuid("dim0:typed-record:receipt:v1",
    input.boardId,input.datasetId,input.actorId,input.requestId);
  const eventId=derivedUuid("dim0:typed-record:event:v1",receiptId);
  const fingerprint=createHash("sha256").update(JSON.stringify({
    boardId:input.boardId,datasetId:input.datasetId,recordId:input.recordId,
    schemaVersion:input.schemaVersion,expectedVersion:input.expectedVersion,
    set:[[fieldId,value]]
  })).digest("hex");
  return {fieldId,value,receiptId,eventId,fingerprint};
}
export function typedRecordOperationIdentity(input:TypedRecordPatchInput){
  const {fieldId,receiptId,eventId,fingerprint}=operationIdentity(input);
  return {
    tool:"patch_typed_record" as const,receiptId,eventId,fingerprint,
    boardId:input.boardId,datasetId:input.datasetId,recordId:input.recordId,
    actorId:input.actorId,requestId:input.requestId,
    expectedVersion:input.expectedVersion,schemaVersion:input.schemaVersion,
    fieldId,
  };
}
function cellsObject(value:unknown):Record<string,JsonValue>{
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw new TypedRecordFieldInvalid();
  return value as Record<string,JsonValue>;
}
async function currentMember(
  reader:Pick<Db,"one">,boardId:string,actorId:string,write:boolean
):Promise<void>{
  const board=await reader.one(app.boards.where({id:boardId}));
  if(!board)throw new TypedRecordPermissionDenied();
  if(board.ownerId===actorId)return;
  const member=await reader.one(app.boardMembers.where({boardId,userId:actorId}));
  if(!member || !["editor","viewer"].includes(member.role) ||
    (write && member.role!=="editor"))
    throw new TypedRecordPermissionDenied();
}
type Receipt=Readonly<{
  id:string;boardId:string;datasetId:string;recordId:string;
  actorId:string;requestId:string;fingerprint:string;
  schemaVersion:number;previousVersion:number;committedVersion:number;
  committedCells:unknown;eventId:string;
}>;
function fromReceipt(row:Receipt):TypedRecordPatchResult{
  return {
    boardId:row.boardId,datasetId:row.datasetId,
    recordId:row.recordId,schemaVersion:row.schemaVersion,
    version:row.committedVersion,previousVersion:row.previousVersion,
    updatedBy:row.actorId,cells:cellsObject(row.committedCells),
    receiptId:row.id,eventId:row.eventId,replayed:true,
  };
}

export async function patchTypedRecord(
  db:Db,input:TypedRecordPatchInput,
  options:Readonly<{beforeTransaction?:()=>Promise<void>;
    beforeWriteSubmit?:()=>void}>={}
):Promise<TypedRecordPatchResult>{
  const operation=operationIdentity(input);
  await options.beforeTransaction?.();
  options.beforeWriteSubmit?.();
  const result=await db.serializableTransaction(async tx=>{
    await currentMember(tx,input.boardId,input.actorId,true);
    const dataset=await tx.one(app.typedDatasets.where({id:input.datasetId}));
    const record=await tx.one(app.typedRecords.where({id:input.recordId}));
    if(!dataset || dataset.boardId!==input.boardId ||
      !record || record.boardId!==input.boardId ||
      record.datasetId!==dataset.id)
      throw new TypedRecordPermissionDenied();
    // The dataset's separate business state is a SERVICE guard, not a role.
    if(dataset.state!=="active")throw new TypedRecordGuardDenied();
    const prior=await tx.one(app.typedPatchReceipts.where({id:operation.receiptId}));
    if(prior){
      if(prior.fingerprint!==operation.fingerprint ||
        prior.boardId!==input.boardId ||
        prior.datasetId!==input.datasetId ||
        prior.recordId!==input.recordId ||
        prior.actorId!==input.actorId ||
        prior.requestId!==input.requestId)
        throw new TypedRecordRequestConflict();
      // Current writer and service guard were rechecked BEFORE replay.
      return fromReceipt(prior);
    }
    if(dataset.schemaVersion!==input.schemaVersion)
      throw new TypedRecordSchemaConflict();
    if(record.version!==input.expectedVersion)
      throw new TypedRecordVersionConflict();
    const fields=await tx.all(app.typedFields.where({datasetId:input.datasetId}));
    if(fields.length!==2 || fields.some(f=>f.boardId!==input.boardId))
      throw new TypedRecordFieldInvalid();
    const writeField=fields.find(f=>f.id===operation.fieldId);
    const computed=fields.find(f=>f.kind==="computed");
    if(!writeField || writeField.kind!=="text" ||
      writeField.computeFromFieldId!=null ||
      !computed || computed.computeFromFieldId!==writeField.id ||
      fields.some(f=>f.id!==writeField.id && f.id!==computed.id))
      throw new TypedRecordFieldInvalid();
    const cells={...cellsObject(record.cells),
      [writeField.id]:operation.value,
      [computed.id]:Array.from(operation.value).length};
    tx.update(app.typedRecords,record.id,{
      cells,version:record.version+1,updatedBy:input.actorId
    });
    tx.insert(app.typedPatchReceipts,{
      boardId:input.boardId,datasetId:dataset.id,recordId:record.id,
      actorId:input.actorId,requestId:input.requestId,
      fingerprint:operation.fingerprint,schemaVersion:dataset.schemaVersion,
      previousVersion:record.version,committedVersion:record.version+1,
      committedCells:cells,eventId:operation.eventId,
    },{id:operation.receiptId});
    tx.insert(app.typedPatchEvents,{
      boardId:input.boardId,datasetId:dataset.id,recordId:record.id,
      actorId:input.actorId,requestId:input.requestId,
      receiptId:operation.receiptId,
      previousVersion:record.version,committedVersion:record.version+1,
      fieldIds:[writeField.id],
    },{id:operation.eventId});
    return {
      boardId:input.boardId,datasetId:dataset.id,recordId:record.id,
      schemaVersion:dataset.schemaVersion,version:record.version+1,
      previousVersion:record.version,updatedBy:input.actorId,cells,
      receiptId:operation.receiptId,eventId:operation.eventId,replayed:false,
    };
  });
  try{
    await result.wait({timeoutMs:10000});
    return result.value;
  }catch(error){
    if(error instanceof PersistedWriteRejectedError){
      const current=await db.one(app.typedRecords.where({id:input.recordId}),
        {tier:"remote"});
      if(current?.boardId===input.boardId &&
        current.version!==input.expectedVersion)
        throw new TypedRecordVersionConflict();
    }
    if(error instanceof WriteWaitTimeoutError)
      throw new TypedRecordCommitUnknown(input.requestId);
    throw error;
  }
}

/** This is a server-authorized DTO, not a direct Jazz shared-view endpoint. */
export async function readTypedRecord(
  db:Db,input:Readonly<{boardId:string;datasetId:string;
    recordId:string;actorId:string}>
){
  if(![input.boardId,input.datasetId,input.recordId,input.actorId]
    .every(id=>uuidPattern.test(id)))throw new TypedRecordFieldInvalid();
  await currentMember(db,input.boardId,input.actorId,false);
  const dataset=await db.one(app.typedDatasets.where({id:input.datasetId}));
  const record=await db.one(app.typedRecords.where({id:input.recordId}));
  if(!dataset || dataset.boardId!==input.boardId ||
    !record || record.boardId!==input.boardId ||
    record.datasetId!==input.datasetId)
    throw new TypedRecordPermissionDenied();
  const fields=await db.all(app.typedFields.where({datasetId:dataset.id}));
  if(fields.some(field=>field.boardId!==input.boardId))
    throw new TypedRecordPermissionDenied();
  return {
    boardId:input.boardId,datasetId:dataset.id,recordId:record.id,
    schemaVersion:dataset.schemaVersion,version:record.version,
    updatedBy:record.updatedBy,cells:cellsObject(record.cells),
    fields:fields.map(field=>({id:field.id,name:field.name,kind:field.kind})),
  };
}
