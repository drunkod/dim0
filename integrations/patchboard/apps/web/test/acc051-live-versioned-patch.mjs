/**
 * ACC-051 canvas-only write QA: real three virtual-passkey browser profiles,
 * Better Auth same-origin PATCH, current Jazz editor, SDK OAuth MCP and CAS.
 * Not typed relational-record acceptance.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {join} from "node:path";
import {tmpdir} from "node:os";

function requireDisposable() {
  const root=process.env.PATCHBOARD_PRIVATE_ROOT;
  assert.ok(process.env.PATCHBOARD_PRIVATE_DEV==="1" &&
    process.env.PATCHBOARD_OAUTH_CI_RESTART==="1" &&
    root?.startsWith(join(tmpdir(),"patchboard-private-ci-")),
    "ACC051 canvas write harness requires disposable local CI");
}

export async function proveAcc051LiveCanvasPatch({
  boardId,siblingBoardId,ownerPage,editorPage,viewerPage,
  editorMcp,viewerMcp,readOnlyToken,makeMcp,editorActorId
}) {
  requireDisposable();
  const entityIds={primary:randomUUID(),racer:randomUUID(),untouched:randomUUID()};
  const stableRequestId="acc051-browser-response-lost-"+randomUUID();
  const initialLabel="label-v7-"+randomUUID().slice(0,8);
  // A server-owned native write exists at version 7 before any ACC051 patch.
  // Seeding uses only the owner Better Auth browser APIs, never direct data
  // mutation or a forged actor in browser/MCP JSON.
  const seeds=await ownerPage.evaluate(async({boardId,entityIds,initialLabel})=>{
    const api=async(path,body)=>{
      const response=await fetch("/patchboard-private/api/canvas/"+path,{
        method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(body)
      });
      return {status:response.status,body:await response.json()};
    };
    const results=[];
    for(const entityId of Object.values(entityIds)){
      let payload={
        id:entityId,graphUid:boardId,type:"note",version:1,
        label:{markdown:"initial"},content:{markdown:"preserved-content"},
        properties:{nodePosition:{type:"position",position:{x:7,y:8}}},
        style:{type:"qa-entity"}
      };
      const created=await api("create",{board_id:boardId,kind:"node",payload});
      if(created.status!==201)throw new Error("SEED_CREATE_FAILED:"+JSON.stringify(created));
      for(let version=2;version<=7;version++){
        payload={...payload,version,label:{
          markdown:version===7?initialLabel:"seed-v"+version
        }};
        const changed=await api("update",{
          board_id:boardId,entity_id:entityId,
          expected_version:version-1,payload
        });
        if(changed.status!==200 || changed.body.version!==version)
          throw new Error("SEED_VERSION_FAILED:"+JSON.stringify(changed));
      }
      results.push({id:entityId,version:7});
    }
    return results;
  },{boardId,entityIds,initialLabel});
  assert.deepEqual(seeds.map(x=>x.version),[7,7,7]);

  const change={board_id:boardId,entity_id:entityIds.primary,
    expected_version:7,request_id:stableRequestId,
    field_patch:{label_markdown:"committed-v8-"+randomUUID().slice(0,8)}};
  let intercepted=0,committedResponse;
  const url="**/patchboard-private/api/canvas/patch";
  const dropResponse=async route=>{
    intercepted++;
    const original=await route.fetch();
    assert.equal(original.status(),200,"server must have committed before dropping response");
    committedResponse=await original.json();
    await route.abort("failed"); // browser never sees committed v8
  };
  await editorPage.route(url,dropResponse);
  let failedBrowser;
  try {
    failedBrowser=await editorPage.evaluate(async request=>{
      try {
        const response=await fetch("/patchboard-private/api/canvas/patch",{
          method:"POST",credentials:"same-origin",
          headers:{"content-type":"application/json"},
          body:JSON.stringify(request)
        });
        return {failed:false,status:response.status};
      } catch {return {failed:true};}
    },change);
  } finally {await editorPage.unroute(url,dropResponse);}
  assert.equal(intercepted,1);
  assert.equal(failedBrowser.failed,true);
  assert.equal(committedResponse.version,8);
  assert.equal(committedResponse.replayed,false);
  assert.equal(committedResponse.updatedBy,editorActorId);
  assert.equal(committedResponse.previousVersion,7);

  // Exact same request and field patch via the independently authenticated
  // OAuth SDK must recover the original v8, not run another mutation.
  const recovered=await editorMcp.callTool({
    name:"patch_canvas_entity",arguments:change
  });
  assert.equal(recovered.isError,undefined,JSON.stringify(recovered));
  const original=JSON.parse(recovered.content[0].text);
  assert.equal(original.replayed,true);
  assert.equal(original.id,change.entity_id);
  assert.equal(original.updatedBy,editorActorId);
  assert.equal(original.previousVersion,7);
  assert.equal(original.version,8);
  assert.equal(original.receiptId,committedResponse.receiptId);
  assert.equal(original.eventId,committedResponse.eventId);
  assert.deepEqual(original.payload,committedResponse.payload);

  const mismatched=await editorMcp.callTool({
    name:"patch_canvas_entity",
    arguments:{...change,field_patch:{label_markdown:"NOT-THE-SAME-PATCH"}}
  });
  assert.equal(mismatched.isError,true);
  assert.match(mismatched.content[0].text,/REQUEST_ID_CONFLICT/);
  const stale=await editorMcp.callTool({
    name:"patch_canvas_entity",
    arguments:{...change,request_id:"stale-"+randomUUID()}
  });
  assert.equal(stale.isError,true);
  assert.match(stale.content[0].text,/VERSION_CONFLICT/);

  // Independent owner reads the v8 value + writer from the original board
  // after a hard page reload, not from the editor's local cache.
  await ownerPage.reload();
  const persisted=await ownerPage.evaluate(async({boardId,id})=>{
    const response=await fetch("/patchboard-private/api/canvas/entity?"+
      new URLSearchParams({board_id:boardId,entity_id:id}),{cache:"no-store"});
    return {status:response.status,body:await response.json()};
  },{boardId,id:entityIds.primary});
  assert.equal(persisted.status,200);
  assert.equal(persisted.body.id,entityIds.primary);
  assert.equal(persisted.body.version,8);
  assert.equal(persisted.body.updatedBy,editorActorId);
  assert.equal(persisted.body.payload.label.markdown,change.field_patch.label_markdown);
  assert.equal(persisted.body.payload.content.markdown,"preserved-content");
  assert.deepEqual(persisted.body.payload.properties.nodePosition.position,{x:7,y:8});

  // RACE: two different v7 requests target a *different* seeded node.
  // They use two authenticated channels, not two in-memory service calls.
  const raceBase={board_id:boardId,entity_id:entityIds.racer,expected_version:7};
  const raceBrowser={...raceBase,request_id:"race-browser-"+randomUUID(),
    field_patch:{label_markdown:"race-browser"}};
  const raceMcp={...raceBase,request_id:"race-mcp-"+randomUUID(),
    field_patch:{label_markdown:"race-mcp"}};
  const [raceHttp,raceSdk]=await Promise.all([
    editorPage.evaluate(async request=>{
      const response=await fetch("/patchboard-private/api/canvas/patch",{
        method:"POST",credentials:"same-origin",
        headers:{"content-type":"application/json"},body:JSON.stringify(request)
      });
      return {status:response.status,body:await response.json()};
    },raceBrowser),
    editorMcp.callTool({name:"patch_canvas_entity",arguments:raceMcp})
  ]);
  const httpWin=raceHttp.status===200;
  const sdkWin=raceSdk.isError===undefined;
  assert.notEqual(httpWin,sdkWin,
    "exactly one independent browser/MCP CAS request must commit");
  if(!httpWin)assert.equal(raceHttp.status,409);
  if(!sdkWin)assert.match(raceSdk.content[0].text,/VERSION_CONFLICT/);

  // Negative real transport checks: Viewer, consent-only reader and sibling.
  const viewerDenied=await viewerPage.evaluate(async request=>{
    const response=await fetch("/patchboard-private/api/canvas/patch",{
      method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},body:JSON.stringify(request)
    });
    return response.status;
  },{...change,entity_id:entityIds.untouched,
    request_id:"viewer-deny-"+randomUUID()});
  assert.equal(viewerDenied,403);
  const viewerMcpDenied=await viewerMcp.callTool({
    name:"patch_canvas_entity",
    arguments:{...change,entity_id:entityIds.untouched,
      request_id:"viewer-mcp-deny-"+randomUUID()}
  });
  assert.equal(viewerMcpDenied.isError,true);
  assert.match(viewerMcpDenied.content[0].text,/BOARD_ACCESS_DENIED/);
  const wrongBoard=await editorMcp.callTool({
    name:"patch_canvas_entity",
    arguments:{...change,board_id:siblingBoardId,entity_id:entityIds.untouched,
      request_id:"wrong-board-"+randomUUID()}
  });
  assert.equal(wrongBoard.isError,true);
  assert.match(wrongBoard.content[0].text,/BOARD_ACCESS_DENIED/);
  const {client:readClient,connect:connectRead}=makeMcp(readOnlyToken);
  try {
    await connectRead();
    assert.equal((await readClient.listTools()).tools.some(t=>t.name==="patch_canvas_entity"),false);
    const denied=await readClient.callTool({name:"patch_canvas_entity",arguments:change})
      .catch(error=>({rejected:String(error)}));
    assert.ok(denied.isError || denied.rejected);
  } finally {await readClient.close();}

  const report={boardId,entityIds,editorActorId,stableRequestId,
    fieldPatch:change.field_patch,receiptId:original.receiptId,
    eventId:original.eventId,raceBrowserId:raceBrowser.request_id,
    raceMcpId:raceMcp.request_id,raceWinner:httpWin?"browser":"mcp",
    versions:{before:7,after:8},expectedReceipts:2,expectedEvents:2};
  console.log("ACC051_PASSKEY_BROWSER_MCP_V7_V8_PASS",JSON.stringify({
    boardId,entityIds,editorActorId,receiptId:report.receiptId,
    eventId:report.eventId,raceWinner:report.raceWinner,
    lostHttpResponse:true,replayedByMcp:true,
    httpViewerDenied:true,mcpViewerDenied:true,readOnlyGrantDenied:true,
    siblingDenied:true,ownerReloadObservedV8:true,receiptReplayed:true,conflictingReplayDenied:true,oneRaceWinner:true
  }));
  return report;
}
