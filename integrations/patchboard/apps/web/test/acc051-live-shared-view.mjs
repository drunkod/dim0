/**
 * Real Dim0 passkey browsers and independently consented OAuth MCP SDK,
 * exercising a SINGLE SAVED typed grid view. Runs only in disposable CI.
 * Share token stays in this test's memory. Never logs bearer or cookies.
 */
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createRequire} from "node:module";
import {DatabaseSync} from "node:sqlite";
import {join} from "node:path";
import {mkdir,writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {createJazz,sqlite} from "jazz-tools/backend";
import {app} from "@patchboard/jazz-schema";
import permissions from "@patchboard/jazz-schema/private.permissions.json" with {type:"json"};

createRequire(new URL("../../server/package.json",import.meta.url))("tsx/esm/api").register();
process.env.JAZZ_APP_DIR=new URL("../../../packages/jazz-schema",import.meta.url).pathname;
const root=()=>{
  const path=process.env.PATCHBOARD_PRIVATE_ROOT;
  assert.ok(process.env.PATCHBOARD_PRIVATE_DEV==="1" &&
    process.env.PATCHBOARD_OAUTH_CI_RESTART==="1" &&
    path?.startsWith(join(tmpdir(),"patchboard-private-ci-")));
  return path;
};
async function offline(restart,action){
  await restart(async()=>{
    const jazz=await createJazz({app,permissions,
      store:sqlite({path:join(root(),"jazz")}),authenticate:()=>null}).ready();
    try{await action(jazz.db);}
    finally{await jazz.close();}
  });
}
const post=(page,path,data)=>page.evaluate(async({path,data})=>{
  const response=await fetch("/patchboard-private/api/records/"+path,{
    method:"POST",credentials:"same-origin",
    headers:{"content-type":"application/json"},
    body:JSON.stringify(data),cache:"no-store"
  });
  return {status:response.status,body:await response.json()};
},{path,data});
const browserQuery=(page,query)=>post(page,"views/query",query);
const ownerDataset=(page,boardId,datasetId)=>page.evaluate(async args=>{
  const response=await fetch(
    "/patchboard-private/api/records/dataset?"+new URLSearchParams({
      board_id:args.boardId,dataset_id:args.datasetId
    }),{cache:"no-store"});
  return {status:response.status,body:await response.json()};
},{boardId,datasetId});
const ownerMemberIds=(page,boardId)=>page.evaluate(async boardId=>{
  const response=await fetch(
    "/patchboard-private/api/members?board_id="+boardId,{cache:"no-store"});
  if(response.status!==200)throw new Error("OWNER_MEMBERS_UNAVAILABLE");
  return (await response.json()).members.map(m=>m.id).sort();
},boardId);
const mcpQuery=async(client,args)=>{
  const result=await client.callTool({name:"read_typed_view",arguments:args});
  return result.isError?{error:result.content[0].text}:
    {body:JSON.parse(result.content[0].text)};
};
const expectPage=(page,expectedId,expectedValue,fieldId,hiddenId,total=2)=>{
  assert.equal(page.total,total);
  assert.deepEqual(page.fields,[fieldId]);
  assert.deepEqual(page.rows.map(r=>r.id),[expectedId]);
  assert.deepEqual(page.rows[0].cells,{[fieldId]:expectedValue});
  assert.ok(!JSON.stringify(page).includes(hiddenId),"hidden field ID/value must not appear");
};
export async function proveAcc051LiveSharedView({
  boardId,siblingBoardId,ownerPage,viewerPage,editorPage,
  ownerActorId,editorToken,viewerWriteToken,readOnlyToken,
  makeMcp,restart,siblingToken,issueReader
}){
  root();
  const ids={
    datasetId:randomUUID(),titleId:randomUUID(),lengthId:randomUUID(),
    R1:randomUUID(),R2:randomUUID(),R3:randomUUID()
  };
  const ownerIdentity=await ownerPage.evaluate(async()=>(
    await (await fetch("/patchboard-private/api/me",{cache:"no-store"})).json()));
  const viewerIdentity=await viewerPage.evaluate(async()=>(
    await (await fetch("/patchboard-private/api/me",{cache:"no-store"})).json()));
  assert.ok(ownerIdentity.signedIn&&viewerIdentity.signedIn);
  assert.notEqual(ownerIdentity.id,viewerIdentity.id);
  const membersBefore=await ownerMemberIds(ownerPage,boardId);
  const grantsBefore=await ownerPage.evaluate(async()=>(
    await (await fetch("/patchboard-private/api/account/connected-apps")).json()
  ).grants.length);

  // A separate owner-only board is an unrelated scope control; no workspace backfill.
  const createdC=await ownerPage.evaluate(async()=>{
    const response=await fetch("/patchboard-private/api/boards",{
      method:"POST",credentials:"same-origin",
      headers:{"content-type":"application/json"},
      body:JSON.stringify({title:"ACC051 typed view unrelated board"})
    });
    return {status:response.status,body:await response.json()};
  });
  assert.equal(createdC.status,201);
  const otherBoardId=createdC.body.board_id;
  assert.notEqual(otherBoardId,boardId);
  assert.notEqual(otherBoardId,siblingBoardId);
  await offline(restart,async db=>{
    await db.insert(app.typedDatasets,{
      boardId,name:"Demo items dataset",schemaVersion:3,state:"active"
    },{id:ids.datasetId}).wait({tier:"global"});
    await db.insert(app.typedFields,{
      boardId,datasetId:ids.datasetId,name:"Title",kind:"text"
    },{id:ids.titleId}).wait({tier:"global"});
    await db.insert(app.typedFields,{
      boardId,datasetId:ids.datasetId,name:"Title length",
      kind:"computed",computeFromFieldId:ids.titleId
    },{id:ids.lengthId}).wait({tier:"global"});
    for(const [key,title] of [
      ["R1","Demo alpha"],["R2","Internal planning"],["R3","Demo beta"]
    ]){
      await db.insert(app.typedRecords,{
        boardId,datasetId:ids.datasetId,
        version:7,updatedBy:ownerActorId,
        cells:{[ids.titleId]:title,[ids.lengthId]:Array.from(title).length}
      },{id:ids[key]}).wait({tier:"global"});
    }
  });
  await ownerPage.reload();
  await viewerPage.reload();

  const definition=(prefix="Demo",direction="asc")=>({
    name:"Demo items",allowed_field_ids:[ids.titleId],
    filter:{op:"text_prefix",field_id:ids.titleId,value:prefix},
    sort:{field_id:ids.titleId,direction}
  });
  if(process.env.PATCHBOARD_QA_TYPED_RECORD!=="1"){
    const {client,connect}=makeMcp(readOnlyToken);
    try{
      await connect();
      assert.ok(!(await client.listTools()).tools.some(t=>t.name==="read_typed_view"));
      const input={board_id:boardId,dataset_id:ids.datasetId,view_id:randomUUID(),share_token:"a".repeat(43),page_size:1};
      const cached=await client.callTool({name:"read_typed_view",arguments:input}).catch(e=>({rejected:true}));
      assert.ok(cached.isError||cached.rejected);
      const result=await browserQuery(ownerPage,input);
      const create=await post(ownerPage,"views/create",{board_id:boardId,dataset_id:ids.datasetId,definition:definition()});
      assert.equal(result.status,404);assert.equal(create.status,404);
      console.log("QA_SAVED_VIEW_DISABLED_PASS",JSON.stringify({absent:true,cachedCallDenied:true,query:404,create:404}));
      return;
    }finally{await client.close();}
  }
  const viewCreated=await post(ownerPage,"views/create",{
    board_id:boardId,dataset_id:ids.datasetId,definition:definition()
  });
  assert.equal(viewCreated.status,201,JSON.stringify(viewCreated));
  const viewId=viewCreated.body.viewId;
  assert.equal(viewCreated.body.viewVersion,1);
  const ref={board_id:boardId,dataset_id:ids.datasetId,view_id:viewId};
  const shared=await post(ownerPage,"views/share",ref);
  assert.equal(shared.status,201,JSON.stringify({...shared,
    body:{...shared.body,shareToken:"[REDACTED]"}}));
  let share=shared.body;
  assert.match(share.shareToken,/^[A-Za-z0-9_-]{43}$/);
  const query=(overrides={})=>({
    ...ref,share_token:share.shareToken,page_size:1,...overrides
  });
  const {client:editorMcp,connect:connectEditor}=makeMcp(editorToken);
  const {client:viewerMcp,connect:connectViewer}=makeMcp(viewerWriteToken);
  const {client:readerMcp,connect:connectReader}=makeMcp(readOnlyToken);
  let ownerAfterRestartMcp;
  let outsideContext,outsidePage;
  try{
    await Promise.all([connectEditor(),connectViewer(),connectReader()]);
    // A fourth independent virtual-passkey account FOLLOWS the saved view
    // without an invite, a board membership or ANY OAuth grant. Only the
    // explicit revocable share credential authorizes its restricted projection.
    const browser=ownerPage.context().browser();
    assert.ok(browser);
    outsideContext=await browser.newContext();
    outsidePage=await outsideContext.newPage();
    const cdp=await outsideContext.newCDPSession(outsidePage);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{
      protocol:"ctap2",transport:"internal",hasResidentKey:true,
      hasUserVerification:true,isUserVerified:true,
      automaticPresenceSimulation:true
    }});
    await outsidePage.goto(new URL(ownerPage.url()).origin+"/patchboard-private/");
    await outsidePage.getByRole("button",{name:"Create account with passkey"}).click();
    await outsidePage.getByRole("button",{name:/Sign out/})
      .waitFor({state:"visible",timeout:20000});
    const outsideIdentity=await outsidePage.evaluate(async()=>(
      await (await fetch("/patchboard-private/api/me")).json()));
    assert.equal(outsideIdentity.signedIn,true);
    assert.notEqual(outsideIdentity.id,viewerIdentity.id);
    assert.notEqual(outsideIdentity.id,ownerIdentity.id);
    const outsideBoards=await outsidePage.evaluate(async()=>(
      await (await fetch("/patchboard-private/api/boards")).json()));
    assert.deepEqual(outsideBoards.boards,[]);
    const outsideProfile=await outsidePage.evaluate(async()=>(
      await (await fetch("/patchboard-private/api/account/connected-apps")).json()));
    assert.deepEqual(outsideProfile.grants,[]);
    const outsideOwnerDataset=await ownerDataset(
      outsidePage,boardId,ids.datasetId);
    assert.equal(outsideOwnerDataset.status,403);
    const outsideNativeBoard=await outsidePage.evaluate(async id=>(
      await fetch("/patchboard-private/api/board?board_id="+id)).status,boardId);
    assert.equal(outsideNativeBoard,403);
    const outsiderShare=await post(outsidePage,"views/share",ref);
    const outsiderRevise=await post(outsidePage,"views/revise",{
      ...ref,expected_version:1,definition:definition("Private")
    });
    const outsiderRevoke=await post(outsidePage,"views/revoke",{
      ...ref,share_id:share.shareId,expected_version:1
    });
    assert.equal(outsiderShare.status,403);
    assert.equal(outsiderRevise.status,403);
    assert.equal(outsiderRevoke.status,403);

    for(const client of [editorMcp,viewerMcp,readerMcp])
      assert.ok((await client.listTools()).tools.some(tool=>
        tool.name==="read_typed_view"),"read-only grant discovers read-only saved view");
    assert.ok(!(await readerMcp.listTools()).tools.some(tool=>
      tool.name==="patch_typed_record"),
      "a view does not expand the original read-only OAuth scope");
    const readerTool=(await readerMcp.listTools()).tools.find(t=>t.name==="read_typed_view");
    assert.equal(readerTool.annotations.readOnlyHint,true);
    const readerP1=await mcpQuery(readerMcp,query());
    expectPage(readerP1.body,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);
    const readerP2=await mcpQuery(readerMcp,query({cursor:readerP1.body.nextCursor}));
    expectPage(readerP2.body,ids.R3,"Demo beta",ids.titleId,ids.lengthId);
    assert.equal(readerP2.body.nextCursor,null);
    const missing=await mcpQuery(readerMcp,query({share_token:"a".repeat(43)}));
    assert.equal(missing.error,"VIEW_ACCESS_DENIED");
    const sibling=makeMcp(siblingToken);
    try{await sibling.connect();assert.equal((await mcpQuery(sibling.client,query())).error,"BOARD_ACCESS_DENIED");}
    finally{await sibling.client.close();}
    assert.equal(await ownerPage.evaluate(async()=>(await (await fetch("/patchboard-private/api/account/connected-apps")).json()).grants.length),grantsBefore);
    const dedicated=await issueReader();
    const revokedClient=makeMcp(dedicated.token);
    let revokedGrantHttp;
    try{
      await revokedClient.connect();
      const first=await mcpQuery(revokedClient.client,query());
      expectPage(first.body,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);
      const revokeGrant=await ownerPage.evaluate(async clientId=>{
        const grants=(await (await fetch("/patchboard-private/api/account/connected-apps")).json()).grants;
        const grant=grants.find(g=>g.clientId===clientId);
        if(!grant)throw new Error("Missing dedicated reader grant");
        return (await fetch("/patchboard-private/api/account/connected-apps/revoke",{
          method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({
            grant_id:grant.id,client_id:grant.clientId,expected_version:grant.grantVersion,request_id:crypto.randomUUID()
          })
        })).status;
      },dedicated.clientId);
      assert.equal(revokeGrant,200);
      const response=await fetch(new URL(ownerPage.url()).origin+"/patchboard-private-mcp",{
        method:"POST",headers:{Authorization:"Bearer "+dedicated.token,"content-type":"application/json",Accept:"application/json, text/event-stream"},
        body:JSON.stringify({jsonrpc:"2.0",id:1,method:"tools/call",params:{name:"read_typed_view",arguments:query({cursor:first.body.nextCursor})}})
      });
      revokedGrantHttp=response.status;
      assert.equal(revokedGrantHttp,401);
      const denied=await revokedClient.client.callTool({name:"read_typed_view",arguments:query({cursor:first.body.nextCursor})}).catch(()=>({rejected:true}));
      assert.ok(denied.rejected||denied.isError);
    }finally{await revokedClient.client.close();}
    console.log("QA_SAVED_VIEW_GRANT_BOUNDARY_PASS",JSON.stringify({missingShare:"VIEW_ACCESS_DENIED",siblingGrant:"BOARD_ACCESS_DENIED",revokedGrantHttp,readOnly:true}));
    const browserP1=await browserQuery(viewerPage,query());
    const outsideP1=await browserQuery(outsidePage,query());
    const editorP1=await mcpQuery(editorMcp,query());
    const viewerMcpP1=await mcpQuery(viewerMcp,query());
    const ownerP1=await browserQuery(ownerPage,query());
    assert.equal(browserP1.status,200,JSON.stringify(browserP1));
    assert.equal(outsideP1.status,200,JSON.stringify(outsideP1));
    assert.ok(editorP1.body,JSON.stringify(editorP1));
    assert.ok(viewerMcpP1.body,JSON.stringify(viewerMcpP1));
    assert.equal(ownerP1.status,200);
    for(const page of [browserP1.body,outsideP1.body,editorP1.body,
      viewerMcpP1.body,ownerP1.body])
      expectPage(page,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);
    const browserP2=await browserQuery(viewerPage,query({
      cursor:browserP1.body.nextCursor
    }));
    const outsideP2=await browserQuery(outsidePage,query({
      cursor:outsideP1.body.nextCursor
    }));
    const editorP2=await mcpQuery(editorMcp,query({
      cursor:editorP1.body.nextCursor
    }));
    const viewerMcpP2=await mcpQuery(viewerMcp,query({
      cursor:viewerMcpP1.body.nextCursor
    }));
    assert.equal(browserP2.status,200);
    assert.equal(outsideP2.status,200);
    for(const page of [browserP2.body,outsideP2.body,editorP2.body,viewerMcpP2.body])
      expectPage(page,ids.R3,"Demo beta",ids.titleId,ids.lengthId);
    assert.equal(browserP2.body.nextCursor,null);
    assert.equal(editorP2.body.nextCursor,null);
    console.log("ACC051_SAVED_VIEW_EXACT_FIXTURE_IDS_PASS",JSON.stringify({
      boardId,datasetId:ids.datasetId,viewId,viewVersion:1,
      R1:ids.R1,R2:ids.R2,R3:ids.R3,
      titleFieldId:ids.titleId,hiddenComputedFieldId:ids.lengthId
    }));
    console.log("ACC051_SAVED_VIEW_PAGE_IDS_PASS",JSON.stringify({
      viewId,browserPage1:browserP1.body.rows.map(r=>r.id),
      browserPage2:browserP2.body.rows.map(r=>r.id),
      mcpPage1:editorP1.body.rows.map(r=>r.id),
      mcpPage2:editorP2.body.rows.map(r=>r.id),
      filteredTotal:2,returnedFieldIds:[ids.titleId]
    }));
    console.log("ACC051_SHARED_VIEW_FIRST_TWO_PAGES_PASS",JSON.stringify({
      boardId,datasetId:ids.datasetId,viewId,viewVersion:1,
      titleFieldId:ids.titleId,hiddenComputedFieldId:ids.lengthId,
      browser:{page1:[ids.R1],page2:[ids.R3],total:2},
      separateNonMemberPasskey:{page1:[ids.R1],page2:[ids.R3],
        total:2,fullBoardDenied:true,noMembershipOrOauthGrant:true},
      mcpEditor:{page1:[ids.R1],page2:[ids.R3],total:2},
      mcpViewer:{page1:[ids.R1],page2:[ids.R3],total:2},
      returnedFieldIds:[ids.titleId]
    }));

    // Exact IDs through a view cannot reveal filtered-out or unknown rows.
    for(const recordId of [ids.R2,randomUUID()]){
      const hidden=await browserQuery(viewerPage,query({record_id:recordId}));
      assert.equal(hidden.status,404);
      assert.deepEqual(hidden.body,{error:"RECORD_NOT_IN_VIEW"});
      const hiddenMcp=await mcpQuery(editorMcp,query({record_id:recordId}));
      assert.equal(hiddenMcp.error,"RECORD_NOT_IN_VIEW");
    }
    // Even a saved view reader with a valid share credential can never ask
    // for a hidden field, or override filter/sort with that field.
    for(const testCase of [
      {requested_field_ids:[ids.titleId,ids.lengthId]},
      {requested_sort_field_id:ids.lengthId},
      {requested_filter_field_id:ids.lengthId}
    ]){
      const browser=await browserQuery(viewerPage,query(testCase));
      assert.equal(browser.status,400);
      assert.equal(browser.body.error,"VIEW_HIDDEN_FIELD_UNSUPPORTED");
      const mcp=await mcpQuery(editorMcp,query(testCase));
      assert.equal(mcp.error,"VIEW_HIDDEN_FIELD_UNSUPPORTED");
    }
    // Wrong-scope board and unrelated board C cannot be traversed via
    // a share token; the MCP's independent board grant denies it even sooner.
    for(const otherId of [siblingBoardId,otherBoardId]){
      const crossBrowser=await browserQuery(viewerPage,query({
        board_id:otherId
      }));
      assert.equal(crossBrowser.status,403);
      const crossMcp=await mcpQuery(editorMcp,query({board_id:otherId}));
      assert.equal(crossMcp.error,"BOARD_ACCESS_DENIED");
    }
    const wrongDataset=await browserQuery(viewerPage,query({
      dataset_id:randomUUID()
    }));
    assert.equal(wrongDataset.status,403);
    const wrongView=await browserQuery(viewerPage,query({
      view_id:randomUUID()
    }));
    assert.equal(wrongView.status,403);
    // Browser and OAuth cursors are not transferable across subjects or
    // channels. Tampering cannot append a hidden field.
    const crossCursor=await mcpQuery(editorMcp,query({
      cursor:browserP1.body.nextCursor
    }));
    assert.equal(crossCursor.error,"VIEW_CURSOR_INVALID");
    const tampered=await browserQuery(viewerPage,query({
      cursor:browserP1.body.nextCursor+"x"
    }));
    assert.equal(tampered.status,400);
    assert.equal(tampered.body.error,"VIEW_CURSOR_INVALID");

    // Owner opening unrestricted DATASET sees all THREE original records
    // and hidden computed length, proving the view didn't delete/copy rows.
    const canonical=await ownerDataset(ownerPage,boardId,ids.datasetId);
    assert.equal(canonical.status,200);
    assert.deepEqual(canonical.body.records.map(r=>r.id).sort(),
      [ids.R1,ids.R2,ids.R3].sort());
    assert.equal(canonical.body.records.find(r=>r.id===ids.R2)
      .cells[ids.titleId],"Internal planning");
    assert.equal(canonical.body.records.find(r=>r.id===ids.R2)
      .cells[ids.lengthId],Array.from("Internal planning").length);
    const viewerDataset=await ownerDataset(viewerPage,boardId,ids.datasetId);
    assert.equal(viewerDataset.status,403);
    assert.equal((await ownerMemberIds(ownerPage,boardId)).join(),
      membersBefore.join(),"view share must not add board members");
    const grantsNow=await ownerPage.evaluate(async()=>(
      await (await fetch("/patchboard-private/api/account/connected-apps")).json()
    ).grants.length);
    assert.equal(grantsNow,grantsBefore+1,"only the explicit dedicated reader consent adds one grant");

    // REVOCATION after both browser and MCP page 1. Page two must not leak.
    const revoke=await post(ownerPage,"views/revoke",{
      ...ref,share_id:share.shareId,expected_version:1
    });
    assert.equal(revoke.status,200);
    assert.equal(revoke.body.revoked,true);
    assert.equal(revoke.body.shareVersion,2);
    const deniedBrowser=await browserQuery(viewerPage,query({
      cursor:browserP1.body.nextCursor
    }));
    const deniedOutside=await browserQuery(outsidePage,query({
      cursor:outsideP1.body.nextCursor
    }));
    assert.equal(deniedBrowser.status,403);
    assert.equal(deniedOutside.status,403);
    assert.equal(deniedBrowser.body.error,"VIEW_ACCESS_DENIED");
    const deniedMcp=await mcpQuery(editorMcp,query({
      cursor:editorP1.body.nextCursor
    }));
    assert.equal(deniedMcp.error,"VIEW_ACCESS_DENIED");
    const deniedViewerMcp=await mcpQuery(viewerMcp,query({
      cursor:viewerMcpP1.body.nextCursor
    }));
    assert.equal(deniedViewerMcp.error,"VIEW_ACCESS_DENIED");
    const unchangedAfterRevoke=await ownerDataset(ownerPage,boardId,ids.datasetId);
    const byId=rows=>[...rows].sort((a,b)=>a.id.localeCompare(b.id));
    assert.deepEqual(byId(unchangedAfterRevoke.body.records),byId(canonical.body.records));
    console.log("ACC051_SHARED_VIEW_REVOKED_MID_PAGINATION_PASS",JSON.stringify({
      viewId,definitionVersion:1,shareId:share.shareId,shareVersion:2,
      browserPage2Status:deniedBrowser.status,
      nonMemberBrowserPage2Status:deniedOutside.status,
      editorMcpDenied:true,viewerMcpDenied:true,
      preservedOauthGrants:true,preservedMembership:true
    }));

    // A new explicit owner-issued credential has no relationship to the old
    // revoked one. Definition update makes already-issued cursors stale.
    const revokedToken=share.shareToken;
    const newlyShared=await post(ownerPage,"views/share",ref);
    assert.equal(newlyShared.status,201);
    share=newlyShared.body;
    assert.notEqual(share.shareId,revoke.body.shareId);
    const staleBrowserP1=await browserQuery(viewerPage,query());
    const staleMcpP1=await mcpQuery(editorMcp,query());
    assert.equal(staleBrowserP1.status,200);
    assert.ok(staleMcpP1.body);
    const revised=await post(ownerPage,"views/revise",{
      ...ref,expected_version:1,definition:definition("Demo","desc")
    });
    assert.equal(revised.status,200);
    assert.equal(revised.body.viewVersion,2);
    const oldBrowserCursor=await browserQuery(viewerPage,query({
      cursor:staleBrowserP1.body.nextCursor
    }));
    assert.equal(oldBrowserCursor.status,409);
    assert.equal(oldBrowserCursor.body.error,
      "VIEW_CURSOR_REQUIRES_FRESH_QUERY");
    const oldMcpCursor=await mcpQuery(editorMcp,query({
      cursor:staleMcpP1.body.nextCursor
    }));
    assert.equal(oldMcpCursor.error,"VIEW_CURSOR_REQUIRES_FRESH_QUERY");
    const freshV2=await browserQuery(viewerPage,query());
    assert.equal(freshV2.status,200);
    expectPage(freshV2.body,ids.R3,"Demo beta",ids.titleId,ids.lengthId);

    // Real typed CANONICAL patch, not a view-private row edit: make R1/R3
    // Title equal. Descending sort ties must use ascending record UUID.
    const r3Tie=await post(ownerPage,"patch",{
      board_id:boardId,dataset_id:ids.datasetId,record_id:ids.R3,
      schema_version:3,expected_version:7,
      request_id:"view-tie-"+randomUUID(),
      set:{[ids.titleId]:"Demo alpha"}
    });
    assert.equal(r3Tie.status,200,JSON.stringify(r3Tie));
    assert.equal(r3Tie.body.version,8);
    const expectedTies=[ids.R1,ids.R3].sort();
    const tieBrowserP1=await browserQuery(viewerPage,query());
    const tieMcpP1=await mcpQuery(editorMcp,query());
    assert.equal(tieBrowserP1.status,200);
    assert.ok(tieMcpP1.body);
    const tieBrowserP2=await browserQuery(viewerPage,query({
      cursor:tieBrowserP1.body.nextCursor
    }));
    const tieMcpP2=await mcpQuery(editorMcp,query({
      cursor:tieMcpP1.body.nextCursor
    }));
    assert.equal(tieBrowserP2.status,200);
    assert.ok(tieMcpP2.body);
    assert.deepEqual([tieBrowserP1.body.rows[0].id,tieBrowserP2.body.rows[0].id],
      expectedTies);
    assert.deepEqual([tieMcpP1.body.rows[0].id,tieMcpP2.body.rows[0].id],
      expectedTies);
    assert.equal(tieBrowserP1.body.total,2);
    assert.equal(tieMcpP2.body.total,2);
    const r3Restore=await post(ownerPage,"patch",{
      board_id:boardId,dataset_id:ids.datasetId,record_id:ids.R3,
      schema_version:3,expected_version:8,
      request_id:"view-restore-"+randomUUID(),
      set:{[ids.titleId]:"Demo beta"}
    });
    assert.equal(r3Restore.status,200);
    assert.equal(r3Restore.body.version,9);

    // An empty filter returns count=0, rows=[] and no continuation in
    // BOTH transports. Restore saved view version 4 before restart.
    const emptyDef=await post(ownerPage,"views/revise",{
      ...ref,expected_version:2,definition:definition("Absent")
    });
    assert.equal(emptyDef.status,200);
    assert.equal(emptyDef.body.viewVersion,3);
    const emptyBrowser=await browserQuery(viewerPage,query());
    const emptyMcp=await mcpQuery(editorMcp,query());
    assert.equal(emptyBrowser.status,200);
    assert.equal(emptyBrowser.body.total,0);
    assert.deepEqual(emptyBrowser.body.rows,[]);
    assert.equal(emptyBrowser.body.nextCursor,null);
    assert.ok(emptyMcp.body);
    assert.equal(emptyMcp.body.total,0);
    assert.deepEqual(emptyMcp.body.rows,[]);
    assert.equal(emptyMcp.body.nextCursor,null);
    const restored=await post(ownerPage,"views/revise",{
      ...ref,expected_version:3,definition:definition()
    });
    assert.equal(restored.status,200);
    assert.equal(restored.body.viewVersion,4);
    const beforeRestartBrowser=await browserQuery(viewerPage,query());
    const beforeRestartOutside=await browserQuery(outsidePage,query());
    const beforeRestartMcp=await mcpQuery(editorMcp,query());
    expectPage(beforeRestartBrowser.body,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);
    expectPage(beforeRestartOutside.body,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);
    expectPage(beforeRestartMcp.body,ids.R1,"Demo alpha",ids.titleId,ids.lengthId);

    await offline(restart,async db=>{
      const v=await db.one(app.typedViews.where({id:viewId}),{tier:"remote"});
      assert.equal(v?.definitionVersion,4);
      assert.equal(v?.name,"Demo items");
      const data=await db.all(app.typedRecords.where({datasetId:ids.datasetId}),
        {tier:"remote"});
      assert.equal(data.length,3);
      const values=Object.fromEntries(data.map(r=>[r.id,r.cells[ids.titleId]]));
      assert.deepEqual(values,{
        [ids.R1]:"Demo alpha",[ids.R2]:"Internal planning",[ids.R3]:"Demo beta"
      });
      const sql=new DatabaseSync(join(root(),"auth","better-auth.sqlite"));
      try{
        const active=sql.prepare(`SELECT id,version,revoked_at_ms,token_hash
          FROM patchboard_typed_view_share WHERE id=?`)
          .get(share.shareId);
        const revoked=sql.prepare(`SELECT version,revoked_at_ms
          FROM patchboard_typed_view_share WHERE id=?`)
          .get(revoke.body.shareId);
        assert.equal(active.version,1);
        assert.equal(active.revoked_at_ms,null);
        assert.equal(typeof active.token_hash,"string");
        assert.equal(active.token_hash.length,64);
        assert.equal(revoked.version,2);
        assert.ok(revoked.revoked_at_ms);
      }finally{sql.close();}
    });
    await ownerPage.reload();
    await viewerPage.reload();
    await outsidePage.reload();
    const afterRestartOutside=await browserQuery(outsidePage,query({
      cursor:beforeRestartOutside.body.nextCursor
    }));
    assert.equal(afterRestartOutside.status,200);
    expectPage(afterRestartOutside.body,ids.R3,"Demo beta",ids.titleId,ids.lengthId);
    const afterRestartBrowser=await browserQuery(viewerPage,query({
      cursor:beforeRestartBrowser.body.nextCursor
    }));
    assert.equal(afterRestartBrowser.status,200);
    expectPage(afterRestartBrowser.body,ids.R3,"Demo beta",ids.titleId,ids.lengthId);
    const {client:afterRestart,connect:connectAfterRestart}=makeMcp(editorToken);
    ownerAfterRestartMcp=afterRestart;
    await connectAfterRestart();
    const afterRestartMcp=await mcpQuery(afterRestart,query({
      cursor:beforeRestartMcp.body.nextCursor
    }));
    assert.ok(afterRestartMcp.body,JSON.stringify(afterRestartMcp));
    expectPage(afterRestartMcp.body,ids.R3,"Demo beta",ids.titleId,ids.lengthId);
    const revokedAfterRestart=await browserQuery(outsidePage,query({share_token:revokedToken,cursor:outsideP1.body.nextCursor}));
    assert.equal(revokedAfterRestart.status,403);
    const revokedMcpAfterRestart=await mcpQuery(afterRestart,query({share_token:revokedToken,cursor:editorP1.body.nextCursor}));
    assert.equal(revokedMcpAfterRestart.error,"VIEW_ACCESS_DENIED");
    const ownerAll=await ownerDataset(ownerPage,boardId,ids.datasetId);
    assert.equal(ownerAll.status,200);
    assert.deepEqual(ownerAll.body.records.map(r=>r.id).sort(),
      [ids.R1,ids.R2,ids.R3].sort());
    assert.equal(ownerAll.body.records.find(r=>r.id===ids.R3).cells[ids.titleId],
      "Demo beta");
    assert.equal(ownerAll.body.records.find(r=>r.id===ids.R2).cells[ids.titleId],
      "Internal planning");
    assert.equal((await ownerMemberIds(ownerPage,boardId)).join(),
      membersBefore.join());

    console.log("ACC051_SAVED_VIEW_RESTART_PROOF_PASS",JSON.stringify({
      viewId,viewVersion:4,shareId:share.shareId,
      formerShareId:revoke.body.shareId,revokedShareVersion:2,
      browserPage2:afterRestartBrowser.body.rows.map(r=>r.id),
      nonMemberPage2:afterRestartOutside.body.rows.map(r=>r.id),
      mcpPage2:afterRestartMcp.body.rows.map(r=>r.id),
      ownerUnrestrictedRecordIds:ownerAll.body.records.map(r=>r.id),
      total:2,fields:[ids.titleId]
    }));
    const evidence={
      boardId,otherBoardId,siblingBoardId,
      datasetId:ids.datasetId,viewId,viewVersion:4,
      firstShareId:revoke.body.shareId,revokedShareVersion:2,
      currentShareId:share.shareId,currentShareVersion:1,
      R1:ids.R1,R2:ids.R2,R3:ids.R3,
      expectedPage1:[ids.R1],actualBrowserPage1:browserP1.body.rows.map(r=>r.id),
      actualMcpPage1:editorP1.body.rows.map(r=>r.id),
      expectedPage2:[ids.R3],actualBrowserPage2:browserP2.body.rows.map(r=>r.id),
      actualMcpPage2:editorP2.body.rows.map(r=>r.id),
      expectedTotal:2,browserFilteredTotal:browserP1.body.total,
      mcpFilteredTotal:editorP1.body.total,
      expectedFields:[ids.titleId],
      actualBrowserFields:browserP1.body.fields,
      actualMcpFields:editorP1.body.fields,
      hiddenFieldId:ids.lengthId,
      exactHiddenR2Status:404,
      revokedBrowserPage2Status:deniedBrowser.status,
      revokedMcpDenied:true,
      oldDefinitionBrowserStatus:oldBrowserCursor.status,
      oldDefinitionMcpDenied:true,
      emptyBrowserTotal:emptyBrowser.body.total,
      emptyMcpTotal:emptyMcp.body.total,
      tieOrder:expectedTies,tieBrowserPassed:true,tieMcpPassed:true,
      restartBrowserCursorPassed:true,restartMcpCursorPassed:true,
      restartNonMemberPasskeyCursorPassed:true,
      nonMemberPasskeyReadTwoPages:true,
      nonMemberNativeBoardDenied:true,nonMemberDatasetDenied:true,
      nonMemberOauthGrantsMinted:0,
      ownerUnrestrictedRecordCount:ownerAll.body.records.length,
      unchangedOauthGrants:true,unchangedNativeMembership:true,
      inheritedLiveWritesEnabled:false,typedQaOnly:true,
      nonMemberPage1:outsideP1.body.rows.map(r=>r.id),nonMemberPage2:outsideP2.body.rows.map(r=>r.id),
      readerPage1:readerP1.body.rows.map(r=>r.id),readerPage2:readerP2.body.rows.map(r=>r.id),
      readerTotal:readerP1.body.total,readerFields:readerP1.body.fields,
      revokedMcpError:deniedMcp.error,revokedNonMemberStatus:deniedOutside.status,
      revokedAfterRestart:revokedAfterRestart.status,revokedMcpAfterRestart:revokedMcpAfterRestart.error,
      missingShare:missing.error,revokedGrantHttp
    };
    console.log("ACC051_SHARED_VIEW_PERSISTED_BROWSER_MCP_PASS",JSON.stringify(evidence));
    if(process.env.PATCHBOARD_VIEW_EVIDENCE_DIR){
      await mkdir(process.env.PATCHBOARD_VIEW_EVIDENCE_DIR,{recursive:true,mode:0o700});
      await writeFile(join(process.env.PATCHBOARD_VIEW_EVIDENCE_DIR,"view-verification.json"),JSON.stringify(evidence,null,2)+"\n",{mode:0o600});
    }
    return {viewId,viewVersion:4,datasetId:ids.datasetId,...ids};
  }finally{
    await Promise.allSettled([
      editorMcp.close(),viewerMcp.close(),readerMcp.close(),
      ...(ownerAfterRestartMcp?[ownerAfterRestartMcp.close()]:[]),
      ...(outsideContext?[outsideContext.close()]:[])
    ]);
  }
}
