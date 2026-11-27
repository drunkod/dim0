/** Stopped-store operator audit. Never opens Jazz when backend is running. */
import assert from "node:assert/strict";
import {DatabaseSync} from "node:sqlite";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {qaHttpsCatalogProfile} from "../src/qa-https-catalog-profile.ts";
import {join} from "node:path";
const profile=qaHttpsCatalogProfile();assert.ok(profile,"valid sealed QA profile required");
const port=Number(process.env.PATCHBOARD_PRIVATE_PORT);assert.ok(Number.isInteger(port));
const {createConnection}=await import("node:net");
await new Promise((yes,no)=>{
  const conn=createConnection({host:"127.0.0.1",port});
  conn.once("connect",()=>{conn.destroy();no(Error("Stop the isolated backend before audit"));});
  conn.once("error",e=>e.code==="ECONNREFUSED"?yes():no(e));
  conn.setTimeout(2000,()=>{conn.destroy();no(Error("Cannot establish stopped backend"));});
});
const sql=new DatabaseSync(join(profile.root,"auth","better-auth.sqlite"),{readOnly:true});
try{
  process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
  const jazz=await createJazz({app,permissions,store:sqlite({path:join(profile.root,"jazz")}),authenticate:()=>null}).ready();
  try{
    const tables={datasets:app.typedDatasets,fields:app.typedFields,views:app.typedViews,receipts:app.typedCatalogReceipts,events:app.typedCatalogEvents,records:app.typedRecords};
    const rows=Object.fromEntries(await Promise.all(Object.entries(tables).map(async([k,t])=>[k,await jazz.db.all(t.where({boardId:profile.boardId}),{tier:"remote"})])));
    const counts=Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length]));
    // IDs and counts only; no token, payload, account name or credential.
    const ids=Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.map(r=>r.id).sort()]));
    const grants=sql.prepare("SELECT id,user_id,client_id,grant_version,revoked_at_ms FROM patchboard_oauth_grant WHERE board_id=?").all(profile.boardId).map(r=>{
      const consent=sql.prepare("SELECT scopes FROM oauthConsent WHERE referenceId=? AND userId=? AND clientId=?").all(r.id,r.user_id,r.client_id);
      const scopes=consent.length===1?JSON.parse(consent[0].scopes):null;
      assert.ok(scopes===null||Array.isArray(scopes)&&scopes.every(x=>typeof x==="string"));
      return {id:r.id,clientId:r.client_id,version:r.grant_version,revoked:r.revoked_at_ms!==null,scopes};
    });
    console.log("HTTPS_QA_STOPPED_AUDIT",JSON.stringify({boardId:profile.boardId,counts,ids,grants}));
  }finally{await jazz.close();}
}finally{sql.close();}
