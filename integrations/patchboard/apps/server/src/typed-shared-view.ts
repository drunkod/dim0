/**
 * ACC-051: one saved, server-only read-only typed Jazz projection.
 * The canonical records are never copied. Signed-in browsers need only a
 * restricted share credential; OAuth MCP additionally requires its existing
 * board-scoped board:read admission. No membership is minted on share read.
 *
 * QA ONLY: adapters must call typedRecordQaEnabled() before invoking.
 */
import {createHash,createHmac,randomBytes,randomUUID,timingSafeEqual} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {Db,JsonValue} from "jazz-tools";
import {app} from "@patchboard/jazz-schema";
import {privateAuthConfig} from "./private-auth/config.ts";

export class TypedViewAccessDenied extends Error{
  constructor(){super("VIEW_ACCESS_DENIED");this.name="TypedViewAccessDenied";}
}
export class TypedViewUnsupported extends Error{
  constructor(readonly code="VIEW_UNSUPPORTED_QUERY"){super(code);this.name="TypedViewUnsupported";}
}
export class TypedViewCursorChanged extends Error{
  constructor(){super("VIEW_CURSOR_REQUIRES_FRESH_QUERY");this.name="TypedViewCursorChanged";}
}
export class TypedViewNotFound extends Error{
  constructor(){super("RECORD_NOT_IN_VIEW");this.name="TypedViewNotFound";}
}
export class TypedViewVersionConflict extends Error{
  constructor(){super("VIEW_VERSION_CONFLICT");this.name="TypedViewVersionConflict";}
}
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const hash=(value:string)=>createHash("sha256").update(value).digest("hex");
const asObject=(value:unknown):Record<string,JsonValue>=>{
  if(!value || typeof value!=="object" || Array.isArray(value))
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  return value as Record<string,JsonValue>;
};
const parseAllowed=(value:unknown):string[]=>{
  if(!Array.isArray(value)||value.length<1||value.length>20||
    !value.every(x=>typeof x==="string"&&uuid.test(x))||
    new Set(value).size!==value.length)
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  return value;
};
type ViewFilter=Readonly<{op:"text_prefix";fieldId:string;value:string}>;
type ViewSort=Readonly<{fieldId:string;direction:"asc"|"desc"}>;
const parseDefinition=(filterInput:unknown,sortInput:unknown)=>{
  const filter=asObject(filterInput),sort=asObject(sortInput);
  if(Object.keys(filter).sort().join()!=="fieldId,op,value" ||
    filter.op!=="text_prefix" || typeof filter.fieldId!=="string" ||
    !uuid.test(filter.fieldId) || typeof filter.value!=="string" ||
    filter.value.length>80 ||
    Object.keys(sort).sort().join()!=="direction,fieldId" ||
    typeof sort.fieldId!=="string" || !uuid.test(sort.fieldId) ||
    !["asc","desc"].includes(String(sort.direction)))
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  return {filter:filter as unknown as ViewFilter,
    sort:sort as unknown as ViewSort};
};
export type SavedTypedViewDefinition=Readonly<{
  name:string;allowedFieldIds:readonly string[];
  filter:ViewFilter;sort:ViewSort;
}>;
async function ownerOf(db:Pick<Db,"one">,boardId:string,actorId:string){
  const board=await db.one(app.boards.where({id:boardId}));
  if(!board || board.ownerId!==actorId)throw new TypedViewAccessDenied();
}
async function validatedDefinition(
  reader:Pick<Db,"one"|"all">,boardId:string,datasetId:string,
  definition:SavedTypedViewDefinition
){
  const dataset=await reader.one(app.typedDatasets.where({id:datasetId}));
  if(!dataset || dataset.boardId!==boardId)
    throw new TypedViewAccessDenied();
  const name=definition.name?.trim();
  if(typeof name!=="string"||name.length<1||name.length>80)
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  const allowed=parseAllowed(definition.allowedFieldIds);
  const {filter,sort}=parseDefinition(definition.filter,definition.sort);
  if(!allowed.includes(filter.fieldId)||!allowed.includes(sort.fieldId))
    throw new TypedViewUnsupported("VIEW_HIDDEN_FIELD_UNSUPPORTED");
  const fields=await reader.all(app.typedFields.where({datasetId}));
  if(fields.length>100||fields.some(f=>f.boardId!==boardId))
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  for(const id of [...allowed,filter.fieldId,sort.fieldId]){
    if(!fields.some(f=>f.id===id))throw new TypedViewUnsupported("VIEW_INVALID_FIELD");
  }
  if(fields.find(f=>f.id===filter.fieldId)?.kind!=="text"||
    fields.find(f=>f.id===sort.fieldId)?.kind!=="text")
    throw new TypedViewUnsupported("VIEW_UNSUPPORTED_FIELD_TYPE");
  return {name,allowedFieldIds:allowed,filter,sort};
}
export async function createSavedTypedView(
  db:Db,input:Readonly<{boardId:string;datasetId:string;actorId:string;
    definition:SavedTypedViewDefinition}>
){
  const tx=await db.serializableTransaction(async t=>{
    await ownerOf(t,input.boardId,input.actorId);
    const verified=await validatedDefinition(t,input.boardId,input.datasetId,input.definition);
    const id=randomUUID();
    t.insert(app.typedViews,{boardId:input.boardId,datasetId:input.datasetId,
      kind:"grid",definitionVersion:1,...verified},{id});
    return {viewId:id,viewVersion:1,name:verified.name,
      boardId:input.boardId,datasetId:input.datasetId};
  });
  await tx.wait({timeoutMs:10000});return tx.value;
}
export async function changeSavedTypedView(
  db:Db,input:Readonly<{viewId:string;boardId:string;datasetId:string;
    actorId:string;expectedVersion:number;definition:SavedTypedViewDefinition}>
){
  const tx=await db.serializableTransaction(async t=>{
    await ownerOf(t,input.boardId,input.actorId);
    const view=await t.one(app.typedViews.where({id:input.viewId}));
    if(!view||view.boardId!==input.boardId||view.datasetId!==input.datasetId)
      throw new TypedViewAccessDenied();
    if(view.definitionVersion!==input.expectedVersion)
      throw new TypedViewVersionConflict();
    const verified=await validatedDefinition(t,input.boardId,input.datasetId,input.definition);
    t.update(app.typedViews,view.id,{
      definitionVersion:view.definitionVersion+1,...verified
    });
    return {viewId:view.id,viewVersion:view.definitionVersion+1};
  });
  await tx.wait({timeoutMs:10000});return tx.value;
}
export function installTypedViewShareLedger(sql:DatabaseSync){
  sql.exec(`
    CREATE TABLE IF NOT EXISTS patchboard_typed_view_share (
      id TEXT PRIMARY KEY,view_id TEXT NOT NULL,board_id TEXT NOT NULL,
      dataset_id TEXT NOT NULL,creator_subject_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,version INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER
    );
    CREATE INDEX IF NOT EXISTS typed_view_share_view
      ON patchboard_typed_view_share(view_id);
  `);
}
type ShareRow={
  id:string;view_id:string;board_id:string;dataset_id:string;
  creator_subject_id:string;token_hash:string;version:number;
  revoked_at_ms:number|null;
};
const shareByToken=(sql:DatabaseSync,token:string):ShareRow|undefined=>{
  if(!/^[A-Za-z0-9_-]{43}$/.test(token))return undefined;
  return sql.prepare(`SELECT id,view_id,board_id,dataset_id,
    creator_subject_id,token_hash,version,revoked_at_ms
    FROM patchboard_typed_view_share WHERE token_hash=?`)
    .get(hash(token)) as ShareRow|undefined;
};
async function viewOwner(
  db:Db,boardId:string,datasetId:string,viewId:string,actorId:string
){
  await ownerOf(db,boardId,actorId);
  const view=await db.one(app.typedViews.where({id:viewId}));
  if(!view||view.boardId!==boardId||view.datasetId!==datasetId)
    throw new TypedViewAccessDenied();
  return view;
}
export async function issueTypedViewShare(
  db:Db,sql:DatabaseSync,input:Readonly<{boardId:string;datasetId:string;
    viewId:string;actorId:string;verifiedSubjectId:string}>
){
  await viewOwner(db,input.boardId,input.datasetId,input.viewId,input.actorId);
  const token=randomBytes(32).toString("base64url"),id=randomUUID();
  sql.prepare(`INSERT INTO patchboard_typed_view_share
    (id,view_id,board_id,dataset_id,creator_subject_id,token_hash,
      version,created_at_ms) VALUES(?,?,?,?,?,?,?,?)`).run(
    id,input.viewId,input.boardId,input.datasetId,input.verifiedSubjectId,
    hash(token),1,Date.now());
  return {shareId:id,shareVersion:1,shareToken:token,
    viewId:input.viewId};
}
export async function revokeTypedViewShare(
  db:Db,sql:DatabaseSync,input:Readonly<{boardId:string;datasetId:string;
    viewId:string;shareId:string;actorId:string;expectedVersion:number}>
){
  await viewOwner(db,input.boardId,input.datasetId,input.viewId,input.actorId);
  sql.exec("BEGIN IMMEDIATE");
  try{
    const row=sql.prepare(`SELECT * FROM patchboard_typed_view_share
      WHERE id=?`).get(input.shareId) as ShareRow|undefined;
    if(!row||row.board_id!==input.boardId||
      row.dataset_id!==input.datasetId||row.view_id!==input.viewId)
      throw new TypedViewAccessDenied();
    if(row.version!==input.expectedVersion||row.revoked_at_ms!==null)
      throw new TypedViewVersionConflict();
    sql.prepare(`UPDATE patchboard_typed_view_share SET
      version=version+1,revoked_at_ms=? WHERE id=?`).run(Date.now(),row.id);
    sql.exec("COMMIT");
    return {shareId:row.id,shareVersion:row.version+1,revoked:true};
  }catch(error){sql.exec("ROLLBACK");throw error;}
}
type ViewQuery=Readonly<{
  boardId:string;datasetId:string;viewId:string;shareToken?:string|undefined;
  /** Server-injected verified owner actor; never a user input. */
  ownerActorId?:string|undefined;
  verifiedSubjectId:string;channel:"browser"|"mcp";
  pageSize:number;cursor?:string|undefined;recordId?:string|undefined;
  requestedFieldIds?:readonly string[]|undefined;
  requestedSortFieldId?:string|undefined;requestedFilterFieldId?:string|undefined;
}>;
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0;
function encodeCursor(state:Record<string,unknown>):string{
  const payload=Buffer.from(JSON.stringify(state)).toString("base64url");
  const signature=createHmac("sha256",privateAuthConfig().secret)
    .update("dim0:typed-view:cursor:v1\0").update(payload).digest("base64url");
  return payload+"."+signature;
}
function decodeCursor(cursor:string):Record<string,unknown>{
  if(cursor.length>20000||!cursor.includes("."))
    throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");
  const [body,signature,...extra]=cursor.split(".");
  if(!body||!signature||extra.length)
    throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");
  const expected=createHmac("sha256",privateAuthConfig().secret)
    .update("dim0:typed-view:cursor:v1\0").update(body).digest();
  let actual:Buffer;
  try{actual=Buffer.from(signature,"base64url");}
  catch{throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");}
  if(actual.length!==expected.length||!timingSafeEqual(actual,expected))
    throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");
  let parsed:unknown;
  try{parsed=JSON.parse(Buffer.from(body,"base64url").toString("utf8"));}
  catch{throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");}
  return asObject(parsed);
}
export async function querySavedTypedView(
  db:Db,sql:DatabaseSync,input:ViewQuery
){
  if(![input.boardId,input.datasetId,input.viewId,input.verifiedSubjectId]
    .every(id=>uuid.test(id)) ||
    !Number.isInteger(input.pageSize)||input.pageSize<1||input.pageSize>20 ||
    (input.recordId!==undefined&&!uuid.test(input.recordId)))
    throw new TypedViewUnsupported("VIEW_INVALID_QUERY");
  // Do not read a Jazz record, field name, count or even view title until the
  // server-only revocable credential is authenticated and bound to its scope.
  const ownerPreview=input.ownerActorId!==undefined;
  if(ownerPreview){
    if(input.channel!=="browser"||input.shareToken||!uuid.test(input.ownerActorId!))
      throw new TypedViewAccessDenied();
    await ownerOf(db,input.boardId,input.ownerActorId!);
  }
  const share=ownerPreview
    ?{id:"owner:"+input.ownerActorId!,view_id:input.viewId,
      board_id:input.boardId,dataset_id:input.datasetId,
      creator_subject_id:input.verifiedSubjectId,token_hash:"",
      version:0,revoked_at_ms:null}
    :shareByToken(sql,input.shareToken??"");
  if(!share||share.revoked_at_ms!==null||
    share.view_id!==input.viewId||share.board_id!==input.boardId||
    share.dataset_id!==input.datasetId)
    throw new TypedViewAccessDenied();
  const view=await db.one(app.typedViews.where({id:input.viewId}));
  const dataset=await db.one(app.typedDatasets.where({id:input.datasetId}));
  if(!view||view.boardId!==input.boardId||
    view.datasetId!==input.datasetId||
    !dataset||dataset.boardId!==input.boardId)
    throw new TypedViewAccessDenied();
  const allowed=parseAllowed(view.allowedFieldIds);
  const {filter,sort}=parseDefinition(view.filter,view.sort);
  if(!allowed.includes(filter.fieldId)||!allowed.includes(sort.fieldId))
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  const fields=await db.all(app.typedFields.where({datasetId:input.datasetId}));
  if(fields.length>100 || fields.some(f=>f.boardId!==input.boardId)||
    allowed.some(id=>!fields.some(f=>f.id===id))||
    fields.find(f=>f.id===filter.fieldId)?.kind!=="text"||
    fields.find(f=>f.id===sort.fieldId)?.kind!=="text")
    throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
  const selected=input.requestedFieldIds===undefined?allowed:
    parseAllowed(input.requestedFieldIds);
  if(selected.some(id=>!allowed.includes(id)) ||
    (input.requestedSortFieldId!==undefined &&
      !allowed.includes(input.requestedSortFieldId))||
    (input.requestedFilterFieldId!==undefined &&
      !allowed.includes(input.requestedFilterFieldId)))
    throw new TypedViewUnsupported("VIEW_HIDDEN_FIELD_UNSUPPORTED");
  if(input.requestedSortFieldId!==undefined||
    input.requestedFilterFieldId!==undefined)
    throw new TypedViewUnsupported("VIEW_QUERY_OVERRIDE_UNSUPPORTED");
  const columns=selected.map(id=>{
    const field=fields.find(f=>f.id===id);
    if(!field)throw new TypedViewUnsupported("VIEW_INVALID_FIELD");
    return {id,name:field.name};
  });
  const queryHash=hash(JSON.stringify({
    boardId:input.boardId,datasetId:input.datasetId,viewId:input.viewId,
    version:view.definitionVersion,schemaVersion:dataset.schemaVersion,
    selected,filter,sort,pageSize:input.pageSize,recordId:input.recordId??null
  }));
  // Recheck the authoritative definition before returning a projection:
  // an in-flight view edit cannot send the old, now-hidden field set.
  const recheckDefinition=async()=>{
    const [latest,latestDataset]=await Promise.all([
      db.one(app.typedViews.where({id:view.id}),{tier:"remote"}),
      db.one(app.typedDatasets.where({id:dataset.id}),{tier:"remote"})
    ]);
    if(!latest||!latestDataset||
      latest.definitionVersion!==view.definitionVersion||
      latestDataset.schemaVersion!==dataset.schemaVersion||
      hash(JSON.stringify({
        allowedFieldIds:latest.allowedFieldIds,filter:latest.filter,sort:latest.sort
      }))!==hash(JSON.stringify({
        allowedFieldIds:view.allowedFieldIds,filter:view.filter,sort:view.sort
      })))
      throw new TypedViewCursorChanged();
  };
  let last:{key:string;recordId:string}|undefined;
  if(input.cursor){
    const decoded=decodeCursor(input.cursor);
    // Compare the view version before query hash to return an actionable
    // fresh-query response rather than accepting old compiled restrictions.
    if(decoded.viewId!==view.id||decoded.boardId!==input.boardId||
      decoded.datasetId!==input.datasetId ||
      decoded.shareId!==share.id||
      decoded.shareVersion!==share.version||
      decoded.subject!==input.verifiedSubjectId||
      decoded.channel!==input.channel)
      throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");
    if(decoded.viewVersion!==view.definitionVersion||
      decoded.queryHash!==queryHash)
      throw new TypedViewCursorChanged();
    if(typeof decoded.lastKey!=="string" ||
      typeof decoded.lastRecordId!=="string"||
      !uuid.test(decoded.lastRecordId))
      throw new TypedViewUnsupported("VIEW_CURSOR_INVALID");
    last={key:decoded.lastKey,recordId:decoded.lastRecordId};
  }
  // Bounded QA scan, NOT an unbounded production query engine. This runs over
  // canonical typedRecords; the view never materializes a second table.
  const rows=await db.all(app.typedRecords.where({
    datasetId:input.datasetId
  }).limit(501));
  if(rows.length>500)throw new TypedViewUnsupported("VIEW_DATASET_LIMIT_500");
  const matched=rows.filter(row=>{
    if(row.boardId!==input.boardId)
      throw new TypedViewUnsupported("VIEW_RECORD_PARENT_MISMATCH");
    return typeof asObject(row.cells)[filter.fieldId]==="string"&&
      (asObject(row.cells)[filter.fieldId] as string).startsWith(filter.value);
  });
  matched.sort((a,b)=>{
    const av=String(asObject(a.cells)[sort.fieldId]??"");
    const bv=String(asObject(b.cells)[sort.fieldId]??"");
    const primary=cmp(av,bv)*(sort.direction==="asc"?1:-1);
    return primary||cmp(a.id,b.id); // stable last sort key for identical titles
  });
  const total=matched.length;
  if(input.recordId){
    const item=matched.find(row=>row.id===input.recordId);
    if(!item)throw new TypedViewNotFound(); // same for filtered and unknown IDs
    const cells=asObject(item.cells);
    const projected=Object.fromEntries(selected.map(id=>[id,cells[id]??null]));
    await recheckDefinition();
    if(ownerPreview)await ownerOf(db,input.boardId,input.ownerActorId!);
    const current=ownerPreview?share:shareByToken(sql,input.shareToken??"");
    if(!current||current.id!==share.id||current.version!==share.version||
      current.revoked_at_ms!==null)
      throw new TypedViewAccessDenied();
    return {viewId:view.id,viewVersion:view.definitionVersion,
      name:view.name,columns,
      boardId:input.boardId,datasetId:input.datasetId,
      fields:selected,rows:[{id:item.id,version:item.version,cells:projected}],
      total:1,nextCursor:null};
  }
  const later=last?matched.filter(row=>{
    const key=String(asObject(row.cells)[sort.fieldId]??"");
    const compared=cmp(key,last.key)*(sort.direction==="asc"?1:-1);
    return compared>0||(compared===0&&cmp(row.id,last.recordId)>0);
  }):matched;
  const page=later.slice(0,input.pageSize);
  const output=page.map(row=>{
    const cells=asObject(row.cells);
    return {id:row.id,version:row.version,
      cells:Object.fromEntries(selected.map(id=>[id,cells[id]??null]))};
  });
  const lastRow=page.at(-1);
  const nextCursor=later.length>input.pageSize&&lastRow
    ?encodeCursor({
      boardId:input.boardId,datasetId:input.datasetId,
      viewId:view.id,viewVersion:view.definitionVersion,
      shareId:share.id,shareVersion:share.version,
      subject:input.verifiedSubjectId,channel:input.channel,
      queryHash,lastKey:String(asObject(lastRow.cells)[sort.fieldId]??""),
      lastRecordId:lastRow.id
    }):null;
  // If definition or share was changed DURING Jazz reads, do not return
  // a stale projection, count or page under obsolete authorization.
  await recheckDefinition();
  if(ownerPreview)await ownerOf(db,input.boardId,input.ownerActorId!);
  const current=ownerPreview?share:shareByToken(sql,input.shareToken??"");
  if(!current||current.id!==share.id||current.version!==share.version||
    current.revoked_at_ms!==null)
    throw new TypedViewAccessDenied();
  return {viewId:view.id,viewVersion:view.definitionVersion,
    name:view.name,columns,
    boardId:input.boardId,datasetId:input.datasetId,fields:selected,
    total,rows:output,nextCursor};
}


/** Owner-only Data picker; no share secret, row payload or Jazz raw client read. */
export async function listOwnerSavedTypedViews(
  db:Db,input:Readonly<{boardId:string;actorId:string}>
){
  await ownerOf(db,input.boardId,input.actorId);
  const views=await db.all(app.typedViews.where({boardId:input.boardId}).limit(101));
  if(views.length>100)throw new TypedViewUnsupported("VIEW_LIST_LIMIT_100");
  const result=[];
  for(const view of views){
    const dataset=await db.one(app.typedDatasets.where({id:view.datasetId}));
    if(!dataset||dataset.boardId!==input.boardId)
      throw new TypedViewAccessDenied();
    const allowed=parseAllowed(view.allowedFieldIds);
    const {filter,sort}=parseDefinition(view.filter,view.sort);
    if(!allowed.includes(filter.fieldId)||!allowed.includes(sort.fieldId))
      throw new TypedViewUnsupported("VIEW_INVALID_DEFINITION");
    const fields=await db.all(app.typedFields.where({datasetId:view.datasetId}));
    const names=allowed.map(id=>{
      const row=fields.find(f=>f.id===id&&f.boardId===input.boardId);
      if(!row)throw new TypedViewUnsupported("VIEW_INVALID_FIELD");
      return {id:row.id,name:row.name};
    });
    result.push({
      viewId:view.id,boardId:view.boardId,datasetId:view.datasetId,
      viewVersion:view.definitionVersion,name:view.name,
      datasetName:dataset.name,datasetSchemaVersion:dataset.schemaVersion,
      singleTextTable:fields.length===1&&fields[0]?.boardId===input.boardId&&fields[0]?.kind==="text"&&
        fields[0]?.primary===true&&
        fields[0]?.computeFromFieldId==null&&dataset.state==="active",
      fields:names,
      filter:{op:filter.op,fieldId:filter.fieldId,value:filter.value},
      sort:{fieldId:sort.fieldId,direction:sort.direction},
    });
  }
  await ownerOf(db,input.boardId,input.actorId);
  return {views:result.sort((a,b)=>
    a.name.localeCompare(b.name)||a.viewId.localeCompare(b.viewId))};
}
/** Never returns the token hash or bearer URL. Owner can revoke after reload. */
export async function listOwnerTypedViewShares(
  db:Db,sql:DatabaseSync,input:Readonly<{
    boardId:string;datasetId:string;viewId:string;actorId:string
  }>
){
  await viewOwner(db,input.boardId,input.datasetId,input.viewId,input.actorId);
  const rows=sql.prepare(`SELECT id,version,revoked_at_ms
    FROM patchboard_typed_view_share
    WHERE board_id=? AND dataset_id=? AND view_id=?
    ORDER BY created_at_ms DESC LIMIT 101`).all(
      input.boardId,input.datasetId,input.viewId
    ) as {id:string;version:number;revoked_at_ms:number|null}[];
  if(rows.length>100)throw new TypedViewUnsupported("VIEW_SHARE_LIST_LIMIT_100");
  await viewOwner(db,input.boardId,input.datasetId,input.viewId,input.actorId);
  return {shares:rows.map(row=>({
    shareId:row.id,shareVersion:row.version,
    revoked:row.revoked_at_ms!==null
  }))};
}
