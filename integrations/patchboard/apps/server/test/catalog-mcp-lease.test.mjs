import test from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {DatabaseSync} from "node:sqlite";
import {installGrantAdmissionLedger,admitVerifiedMcpGrant,authorizeProtectedMcpInvocation,GrantDrainPending} from "../src/account-adapters/grant-admission.ts";
import {beginProtectedMcpWriteLease,runReservedMcpWrite,settleProtectedMcpWriteLease,outstandingMcpWrites,disconnectAfterMcpWritesDrain,reconcileTerminatedCanvasWriteLease} from "../src/account-adapters/grant-write-drain.ts";
import {textTableOperationIdentity} from "../src/typed-catalog.ts";

test("catalog reservation requires both scopes, pending permits only exact catalog lease, unknown retains it",async()=>{
  const db=new DatabaseSync(":memory:");
  db.exec("CREATE TABLE patchboard_oauth_grant(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,client_id TEXT NOT NULL,board_id TEXT NOT NULL,created_at_ms INTEGER NOT NULL,revoked_at_ms INTEGER)");
  installGrantAdmissionLedger(db);
  const grant={id:randomUUID(),userId:randomUUID(),clientId:"client",boardId:randomUUID()};
  db.prepare("INSERT INTO patchboard_oauth_grant(id,user_id,client_id,board_id,created_at_ms) VALUES(?,?,?,?,?)").run(grant.id,grant.userId,grant.clientId,grant.boardId,Date.now());
  const identity=textTableOperationIdentity({boardId:grant.boardId,actorId:randomUUID(),requestId:"catalog",name:"Rehearsal",primaryFieldName:"Title",defaultViewName:"All rows"});
  const op={tool:"call-api-write",identity};
  const admit=(...scopes)=>admitVerifiedMcpGrant(db,grant,new Set(scopes));
  const intent={grantId:grant.id,clientId:grant.clientId,expectedVersion:1,requestId:"same-disconnect"};
  try{
    for(const scopes of [["board:write"],["board:read","table:create"]]){
      assert.equal(beginProtectedMcpWriteLease(db,admit(...scopes),grant,op),null);
    }
    const admission=admit("board:write","table:create");
    assert.throws(()=>beginProtectedMcpWriteLease(db,admission,grant,{tool:"call-api-write"}),/INVALID_SERVER_WRITE_OPERATION_IDENTITY/);
    assert.throws(()=>beginProtectedMcpWriteLease(db,admission,grant,{...op,identity:{...identity,boardId:randomUUID()}}),/INVALID_SERVER_WRITE_OPERATION_IDENTITY/);
    for(const diagnostic of ["CATALOG_INVALID_DEFINITION","CATALOG_REQUEST_ID_CONFLICT"]){
      const lease=beginProtectedMcpWriteLease(db,admission,grant,op);assert.ok(lease);
      await runReservedMcpWrite(db,lease,async()=>({isError:true,content:[{type:"text",text:diagnostic}]}));
      assert.equal(outstandingMcpWrites(db,grant.id),0);
    }
    const unrelated=beginProtectedMcpWriteLease(db,admission,grant,{tool:"create_note"});
    const lease=beginProtectedMcpWriteLease(db,admission,grant,op);assert.ok(lease);
    const observed=db.prepare("SELECT tool_name,operation_identity,verified_board_id FROM patchboard_mcp_write_lease WHERE id=?").get(lease.id);
    assert.equal(observed.tool_name,"call-api-write");
    assert.deepEqual(JSON.parse(observed.operation_identity),identity);
    assert.equal(observed.verified_board_id,grant.boardId);
    await runReservedMcpWrite(db,lease,async()=>({isError:true,content:[{type:"text",text:"CATALOG_COMMIT_OUTCOME_UNKNOWN: retry same request_id"}]}));
    await assert.rejects(()=>disconnectAfterMcpWritesDrain(db,grant.userId,intent,{maxWaitMs:0}),GrantDrainPending);
    assert.equal(outstandingMcpWrites(db,grant.id),2);
    assert.equal(beginProtectedMcpWriteLease(db,admission,grant,op),null);
    for(const scope of ["board:write","table:create"]){
      assert.equal(authorizeProtectedMcpInvocation(db,admission,grant,scope),false);
      assert.equal(authorizeProtectedMcpInvocation(db,admission,grant,scope,Date.now(),lease.id),true);
    }
    assert.equal(authorizeProtectedMcpInvocation(db,admission,grant,"table:create",Date.now(),unrelated.id),false);
    // This is NOT canvas recovery; no Jazz access should be attempted.
    assert.deepEqual(await reconcileTerminatedCanvasWriteLease(db,null,lease.id,{workerTerminated:true}),{status:"UNKNOWN_OPERATION",settled:false});
    settleProtectedMcpWriteLease(db,unrelated);
    await assert.rejects(()=>disconnectAfterMcpWritesDrain(db,grant.userId,intent,{maxWaitMs:0}),GrantDrainPending);
    assert.equal(outstandingMcpWrites(db,grant.id),1);
  }finally{db.close();}
});
