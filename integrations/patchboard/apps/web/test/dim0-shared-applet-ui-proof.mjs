import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DIM0_SHARED_APPLET_QA_ORIGIN ?? "http://localhost:5185";
assert.ok(origin.startsWith("http://localhost:") || (
  process.env.DIM0_ALLOW_PUBLIC_QA === "1" &&
  origin === "https://barbie-discovery-bingo-system.trycloudflare.com"
), "QA requires a loopback server or an explicitly authorized demo origin");
const browser = await chromium.launch({ headless: true });
const contexts = [];
const errors = [];
async function actor(label) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  contexts.push(context);
  const page = await context.newPage();
  page.on("pageerror", e => errors.push(label + ": " + String(e)));
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  }});
  await page.goto(origin + "/jazz-signin", { waitUntil: "domcontentloaded", timeout: 65000 });
  await expect(page.getByRole("button", { name: "Create account with passkey" })).toBeVisible({ timeout: 85000 });
  await page.bringToFront();
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.getByRole("button", { name: "Create Jazz board" })).toBeVisible({ timeout: 55000 });
  return page;
}
async function call(page, route, data) {
  return page.evaluate(async ({route,data}) => {
    const res=await fetch("/patchboard-private/api/" + route, {
      ...(data ? {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data)}:{}),
      cache:"no-store",credentials:"include",
    });
    return {status:res.status,body:await res.json()};
  }, {route,data});
}
async function waitApplet(page, id, count) {
  const root=page.locator('[data-node-id="' + id + '"] .applet-root');
  await expect(root).toBeVisible({ timeout: 90000 });
  await expect(root.getByTestId("jazz-shared-count")).toHaveText(String(count), { timeout: 40000 });
  return root;
}
try {
  const owner=await actor("owner");
  const editor=await actor("editor");
  const newBoard=await call(owner,"boards",{title:"2-browser Jazz applet state QA"});
  assert.equal(newBoard.status,201,JSON.stringify(newBoard.body));
  const boardId=newBoard.body.board_id;
  const invite=await call(owner,"invite",{board_id:boardId,role:"editor"});
  assert.equal(invite.status,201);
  const token=new URL(invite.body.invite_url).searchParams.get("invite");
  assert.equal((await call(editor,"join",{board_id:boardId,token})).status,200);
  const nodeId=randomUUID();
  const counterSource=`<Widget state={{ count: 0 }} persist><div><button onClick={set("count", count + 1)}>Increment</button><span data-testid="jazz-shared-count">{count}</span></div></Widget>`;
  const entity={id:nodeId,graphUid:boardId,type:"note",version:1,
    label:{markdown:"2-Browser Jazz Counter"},content:{markdown:counterSource},
    style:{type:"applet"},properties:{
      nodePosition:{type:"position",position:{x:160,y:140}},
      nodeSize:{type:"size",size:{width:480,height:300}},
      nodeZIndex:{type:"number",number:1},
    }};
  assert.equal((await call(owner,"canvas/create",{board_id:boardId,kind:"node",payload:entity})).status,201);
  for(const p of [owner,editor]) await p.goto(origin+"/boards/"+boardId,{waitUntil:"domcontentloaded",timeout:85000});
  const ownerRoot=await waitApplet(owner,nodeId,0);
  const editorRoot=await waitApplet(editor,nodeId,0);
  console.log("JAZZ_SHARED_APPLET_TWO_BROWSERS_RENDER_ZERO_PASS");
  await ownerRoot.getByText("Increment").evaluate(el=>el.click());
  await expect(ownerRoot.getByTestId("jazz-shared-count")).toHaveText("1");
  await expect(editorRoot.getByTestId("jazz-shared-count")).toHaveText("1",{timeout:30000});
  console.log("JAZZ_SHARED_APPLET_CROSS_BROWSER_INCREMENT_PASS");
  await editor.reload({waitUntil:"domcontentloaded"});
  const editorReloaded=await waitApplet(editor,nodeId,1);
  console.log("JAZZ_SHARED_APPLET_RELOAD_PERSISTENCE_PASS");
  await editorReloaded.getByText("Increment").evaluate(el=>el.click());
  await expect(ownerRoot.getByTestId("jazz-shared-count")).toHaveText("2",{timeout:30000});
  const state=await call(owner,"applet-state?board_id="+boardId+"&note_id="+nodeId);
  assert.equal(state.status,200);
  assert.deepEqual(state.body.value,{count:2});
  assert.equal(state.body.version,2);
  assert.deepEqual(errors,[]);
  console.log("JAZZ_SHARED_APPLET_UI_ACCEPTANCE_PASS",JSON.stringify({boardId,nodeId,count:2,version:2}));
} finally {
  await Promise.all(contexts.map(c=>c.close().catch(()=>{})));
  await browser.close();
}
