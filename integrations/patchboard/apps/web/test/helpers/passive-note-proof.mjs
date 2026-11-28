import assert from "node:assert/strict";
import {join} from "node:path";
import {expect} from "@playwright/test";

// Three independently authenticated browser contexts, one genuine editor.
// Requests are recorded without credentials, invitation links or headers.
export async function runPassiveNoteProof({owner,editor,viewer,board,origin,api,save,evidence,browser}) {
  const people={owner,editor,viewer};
  const op=owner.page,ep=editor.page,vp=viewer.page;
  const url=origin+"/boards/"+board;
  const options={timeout:30000};
  const title="Editor closeout note",body="Edited by Helium Editor - closeout body";
  const trace=[],callbacks=[],requests=new Map();
  let stage="invite",noteId,baseline,result="FAIL";
  assert.equal(new Set(Object.values(people).map(p=>p.identity.accountId)).size,3);
  for(const [who,{page}] of Object.entries(people)){
    page.on("request",r=>{
      const path=new URL(r.url()).pathname;
      if(r.method()!=="POST"||!/^\/patchboard-private\/api\/canvas\/(create|update|delete|patch)$/.test(path))return;
      const data=r.postDataJSON();
      const entry={who,stage,path,at:new Date().toISOString(),id:data.entity_id??data.payload?.id,expectedVersion:data.expected_version,body:data.payload?.content?.markdown};
      requests.set(r,entry);trace.push(entry);
    });
    page.on("response",r=>{const entry=requests.get(r.request());if(entry)entry.status=r.status();});
    // Optional source-level diagnostics during the red reproduction.
    page.on("console",msg=>{
      if(msg.text().startsWith("SHEET_UPDATE_TRACE "))callbacks.push({who,stage,at:new Date().toISOString(),...JSON.parse(msg.text().slice(19))});
    });
  }
  const canvas=async page=>{
    const r=await api(page,"canvas?board_id="+board);assert.equal(r.status,200);return r.body;
  };
  const read=async page=>(await canvas(page)).entities.find(e=>e.id===noteId);
  const open=async page=>{await page.goto(url);await page.bringToFront();};
  const snap=(page,name)=>page.screenshot({path:join(evidence,name+".png")});
  const visible=async page=>{
    await expect(page.getByRole("button",{name:title,exact:true})).toBeVisible(options);
    await expect(page.locator(".ProseMirror").getByText(body,{exact:true})).toBeVisible(options);
  };
  async function invite(person,role){
    await open(op);
    await op.getByRole("button",{name:"Share this board"}).click();
    const dlg=op.getByRole("dialog");
    await dlg.getByRole("radio",{name:role==="editor"?"Edit":"View",exact:true}).click();
    await dlg.getByRole("button",{name:"Create link",exact:true}).click();
    const link=await dlg.getByLabel("Invitation link").inputValue();
    assert.equal(new URL(link).origin,origin);
    await dlg.getByRole("button",{name:"Close",exact:true}).click();
    assert.equal((await api(person.page,"canvas?board_id="+board)).status,403);
    await person.page.goto(link);
    const review=person.page.getByRole("button",{name:"Review invitation",exact:true});
    if(await review.isVisible())await review.click();
    await person.page.getByRole("button",{name:"Accept invitation",exact:true}).click();
    await expect(person.page).toHaveURL(url,options);
    assert.equal((await canvas(person.page)).role,role==="editor"?"member":"viewer");
  }
  const settle=async()=>{
    let last="",since=0;
    await expect.poll(async()=>{
      const next=JSON.stringify(await read(op));
      if(next!==last){last=next;since=Date.now();}
      return Date.now()-since>=3300;
    },{timeout:20000,intervals:[300,500]}).toBe(true);
    return read(op);
  };
  try{
    await invite(editor,"editor");await invite(viewer,"viewer");
    stage="owner creates empty note";
    await open(op);
    await op.getByRole("button",{name:"Note",exact:true}).click();
    const created=op.waitForResponse(r=>r.url().endsWith("/canvas/create")&&r.request().method()==="POST");
    await op.mouse.move(580,310);await op.mouse.down();await op.mouse.move(920,540,{steps:14});await op.mouse.up();
    const response=await created;assert.equal(response.status(),201);
    const note=await response.json();noteId=note.id;
    stage="passive clients remain open";
    await open(vp);await open(ep);
    for(const {page} of Object.values(people))await expect(page.getByRole("button",{name:"Untitled",exact:true})).toBeVisible(options);
    stage="editor renames and edits note";
    await ep.bringToFront();
    await ep.getByRole("button",{name:"Untitled",exact:true}).click();
    const titleInput=ep.getByPlaceholder("Untitled",{exact:true});
    await titleInput.fill(title);await titleInput.press("Enter");
    await expect.poll(async()=>(await read(ep))?.payload.label?.markdown,options).toBe(title);
    await ep.getByTitle("Double-click to edit",{exact:true}).dblclick();
    const editable=ep.locator(".ProseMirror[contenteditable=true]");
    await editable.fill(body);await editable.press("Escape");
    await expect(editable).toHaveCount(0,options);
    const settled=await settle();
    baseline=settled;
    assert.deepEqual(trace.filter(r=>r.stage!=="owner creates empty note"&&r.who!=="editor"),[],"Passive clients emitted canvas mutations");
    assert.equal(settled.payload.content.markdown,body);
    assert.equal(settled.payload.label.markdown,title);
    assert.equal(settled.updatedBy,editor.identity.accountId);
    assert.ok(settled.version>note.version);
    stage="passive clients see remote edit and reload";
    for(const person of Object.values(people)){
      await visible(person.page);
      await open(person.page);
      await visible(person.page);
      assert.deepEqual(await read(person.page),baseline);
    }
    await settle();
    assert.deepEqual(await read(op),baseline);
    assert.deepEqual(trace.filter(r=>r.stage!=="owner creates empty note"&&r.who!=="editor"),[]);
    assert.deepEqual(trace.filter(r=>r.stage==="passive clients see remote edit and reload"),[]);
    await snap(op,"owner-note");await snap(vp,"viewer-note");
    stage="deliberate stale control";
    const attempt={board_id:board,entity_id:noteId,expected_version:baseline.version,payload:{...baseline.payload,label:{markdown:"Forbidden synthetic edit"}}};
    assert.equal((await api(ep,"canvas/update",{...attempt,expected_version:note.version})).status,409);
    assert.deepEqual(await read(op),baseline);
    stage="downgrade editor";
    await op.bringToFront();
    await op.getByRole("button",{name:"Share this board"}).click();
    const select=op.getByRole("dialog").getByRole("listitem").filter({hasText:editor.identity.accountId.slice(0,8)}).getByRole("combobox");
    await expect(select).toHaveValue("member",options);
    op.once("dialog",x=>x.accept());
    const changed=op.waitForResponse(r=>r.url().endsWith("/members/role")&&r.request().method()==="POST");
    await select.selectOption("viewer");
    assert.equal((await changed).status(),200);
    await expect.poll(async()=>(await canvas(ep)).role,options).toBe("viewer");
    await op.getByRole("dialog").getByRole("button",{name:"Close",exact:true}).click();
    await open(ep);await visible(ep);
    await expect(ep.getByRole("status",{name:"Board is read-only"})).toBeVisible(options);
    await ep.getByRole("button",{name:title,exact:true}).click();
    await expect(ep.getByPlaceholder("Untitled",{exact:true})).toHaveCount(0);
    await ep.locator(".ProseMirror").dblclick({force:true});
    await expect(ep.locator(".ProseMirror[contenteditable=true]")).toHaveCount(0);
    stage="deliberate denied control";
    assert.equal((await api(ep,"canvas/update",attempt)).status,403);
    await settle();
    for(const {page} of Object.values(people))assert.deepEqual(await read(page),baseline);
    assert.deepEqual(trace.filter(r=>r.stage!=="owner creates empty note"&&r.who!=="editor"),[]);
    assert.deepEqual(trace.filter(r=>r.stage==="downgrade editor"),[]);
    await snap(ep,"downgraded-editor");
    result="PASS";
    console.log("PASSIVE_NOTE_PROOF_PASS",JSON.stringify({noteId,version:baseline.version,writer:baseline.updatedBy,stale:409,denied:403}));
  }finally{
    await save("passive-note-trace",{result,stage,browser,method:"automated visible browser controls; virtual passkeys",actors:Object.fromEntries(Object.entries(people).map(([who,p])=>[who,p.identity.accountId])),noteId,baseline,trace,callbacks});
    console.log("PASSIVE_NOTE_TRACE",JSON.stringify({result,stage,trace,callbacks}));
  }
}
