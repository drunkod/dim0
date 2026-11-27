/**
 * Test-only separate process using REAL SQLite ledger + optionally Jazz.
 * All config files live under mkdtemp with mode 0600; no bearer credentials.
 */
import {readFile,writeFile,access} from "node:fs/promises";
import {DatabaseSync} from "node:sqlite";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};
import {installGrantAdmissionLedger,GrantDrainPending,admitVerifiedMcpGrant,authorizeProtectedMcpInvocation} from
  "../src/account-adapters/grant-admission.ts";
import {
  beginProtectedMcpWriteLease,settleProtectedMcpWriteLease,
  disconnectAfterMcpWritesDrain,reconcileTerminatedCanvasWriteLease,
} from "../src/account-adapters/grant-write-drain.ts";

import {reconcileTerminatedCatalogWriteLease} from "../src/account-adapters/catalog-lease-recovery.ts";
import {createTextTable,textTableOperationIdentity} from "../src/typed-catalog.ts";
import {listOwnerSavedTypedViews,querySavedTypedView} from "../src/typed-shared-view.ts";
import assert from "node:assert/strict";
import {patchCanvasLabelMarkdown} from "../src/canvas-versioned-patch.ts";

const config=JSON.parse(await readFile(process.argv[2],"utf8"));
const mode=process.argv[3];
const db=new DatabaseSync(config.sqlFile);
db.exec("PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000");
installGrantAdmissionLedger(db);
const write=async(name,value)=>writeFile(
  config.root+"/"+config.label+"."+name,JSON.stringify(value),{mode:0o600});
const marker=name=>config.root+"/"+config.label+"."+name;
async function waitFor(path){
  const until=Date.now()+10000;
  while(Date.now()<until){
    try{await access(path);return;}
    catch{await new Promise(resolve=>setTimeout(resolve,20));}
  }
  throw new Error("CROSS_PROCESS_TIMEOUT");
}
try{
  if(mode==="reserve"){
    const lease=beginProtectedMcpWriteLease(
      db,config.admission,config.grant,config.operation);
    await write("ready",{lease});
    if(!lease)throw new Error("EXPECTED_WRITE_LEASE");
    if(config.command){
      process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
      const jazz=await createJazz({app,permissions,
        store:sqlite({path:config.jazzDir}),authenticate:()=>null}).ready();
      try{
        const result=await patchCanvasLabelMarkdown(jazz.db,config.command);
        // Signal only after the authoritative wait succeeds, while the SQL lease remains held.
        await write("committed",result);
        await write("unfenced",await reconcileTerminatedCanvasWriteLease(
          db,jazz.db,lease.id,{workerTerminated:false}));
        await waitFor(marker("release"));
      }finally{await jazz.close();}
    }else await waitFor(marker("release"));
    settleProtectedMcpWriteLease(db,lease);
    await write("settled",{settled:true});
  }else if(mode==="catalogWriter"){
    // The same child owns the SQL lease AND performs the authoritative Jazz
    // transaction. Parent has closed its Jazz authority before this child.
    assert.deepEqual(config.operation.identity,textTableOperationIdentity(config.command));
    const lease=beginProtectedMcpWriteLease(db,config.admission,config.grant,config.operation);
    assert.ok(lease);
    await write("ready",{lease,pid:process.pid});
    await waitFor(marker("submit"));
    process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
    const jazz=await createJazz({app,permissions,store:sqlite({path:config.jazzDir}),authenticate:()=>null}).ready();
    try{
      const result=await createTextTable(jazz.db,config.command,{beforeWriteSubmit:()=>{
        for(const scope of ["board:write","table:create"])
          assert.ok(authorizeProtectedMcpInvocation(db,config.admission,config.grant,scope,Date.now(),lease.id));
      }});
      await write("committed",{...result,pid:process.pid,leaseId:lease.id});
      // Matching evidence while the writer is actually alive: no recovery.
      const unfenced=await reconcileTerminatedCatalogWriteLease(db,jazz.db,lease.id,{workerTerminated:false});
      await write("unfenced",unfenced);
      // The supervisor kills this exact child after observing committed.
      await waitFor(marker("release"));
    }finally{await jazz.close();}
    settleProtectedMcpWriteLease(db,lease);
    await write("settled",{settled:true});
  }else if(mode==="catalogOwnerReadback"){
    // Separate process and independent client for the same verified Owner.
    const admission=admitVerifiedMcpGrant(db,config.grant,new Set(["board:read"]));
    assert.ok(admission);
    assert.ok(authorizeProtectedMcpInvocation(db,admission,config.grant,"board:read"));
    const mapped=db.prepare("SELECT jazz_account_id FROM patchboard_jazz_identity WHERE auth_user_id=?").get(admission.subjectId);
    assert.ok(mapped);
    process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
    const jazz=await createJazz({app,permissions,store:sqlite({path:config.jazzDir}),authenticate:()=>null}).ready();
    try{
      const {views}=await listOwnerSavedTypedViews(jazz.db,{boardId:admission.boardId,actorId:mapped.jazz_account_id});
      assert.equal(views.length,1);
      const view=views[0];
      const grid=await querySavedTypedView(jazz.db,db,{boardId:admission.boardId,datasetId:view.datasetId,
        viewId:view.viewId,verifiedSubjectId:admission.subjectId,ownerActorId:mapped.jazz_account_id,
        channel:"browser",pageSize:20});
      await write("result",{pid:process.pid,view,grid,independentAdmission:true});
    }finally{await jazz.close();}
  }else if(mode==="reserveOnce"){
    const lease=beginProtectedMcpWriteLease(
      db,config.admission,config.grant,config.operation);
    await write("result",{lease});
  }else if(mode==="disconnect"){
    try{
      const receipt=await disconnectAfterMcpWritesDrain(db,config.grant.userId,{
        grantId:config.grant.id,clientId:config.grant.clientId,
        expectedVersion:1,requestId:config.requestId,
      },{maxWaitMs:config.maxWaitMs??5000,pollMs:10});
      await write("result",{status:200,receipt});
    }catch(error){
      if(!(error instanceof GrantDrainPending))throw error;
      await write("result",{status:503,error:error.message});
    }
  }else if(mode==="reconcile"||mode==="reconcileCatalog"){
    process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
    const jazz=await createJazz({app,permissions,
      store:sqlite({path:config.jazzDir}),authenticate:()=>null}).ready();
    try{
      const reconcile=mode==="reconcileCatalog"?reconcileTerminatedCatalogWriteLease:reconcileTerminatedCanvasWriteLease;
      const outcome=await reconcile(
        db,jazz.db,config.leaseId,
        {workerTerminated:config.workerTerminated===true});
      await write("result",outcome);
    }finally{await jazz.close();}
  }else throw new Error("UNKNOWN_QA_WORKER_MODE");
}finally{db.close();}
