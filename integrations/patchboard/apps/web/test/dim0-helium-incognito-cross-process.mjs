import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DIM0_MCP_ORIGIN ?? "https://barbie-discovery-bingo-system.trycloudflare.com";
const boardId = process.env.DIM0_OWNER_BOARD_ID ?? "01a1fdec-1b8f-7e30-af11-3a09df695fc5";
const cdpOrigin = process.env.DIM0_CDP_URL ?? "http://127.0.0.1:9222";
const cdpUrl = new URL(cdpOrigin);
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cdpUrl.hostname), "CDP must stay loopback-only");
const ownerBrowser = await chromium.connectOverCDP(cdpOrigin);
const existing = ownerBrowser.contexts().flatMap(c => c.pages()).find(p => {
  try { const u=new URL(p.url()); return u.origin === origin && u.pathname === "/boards/"+boardId; }
  catch { return false; }
});
assert.ok(existing,"Missing authenticated owner board tab in standard Helium");
let qaPage, privateBrowser, privateContext;
let qaBoard;
const userErrors=[];
try {
  const ownerContext=existing.context();
  qaPage=await ownerContext.newPage();
  qaPage.on("pageerror",e=>userErrors.push("standard Helium: "+String(e)));
  await qaPage.goto(origin+"/boards",{waitUntil:"domcontentloaded",timeout:45000});
  const create=await qaPage.evaluate(async title=>{
    const response=await fetch("/patchboard-private/api/boards",{
      method:"POST",credentials:"include",headers:{"content-type":"application/json"},body:JSON.stringify({title}),
    });return {status:response.status,body:await response.json()};
  },"Browser cross-profile demo QA "+randomUUID().slice(0,7));
  assert.equal(create.status,201,JSON.stringify(create.body));
  qaBoard=create.body.board_id;
  await qaPage.goto(origin+"/boards/"+qaBoard,{waitUntil:"domcontentloaded",timeout:45000});
  await expect(qaPage.getByRole("button",{name:"Share this board"})).toBeVisible({timeout:65000});
  await qaPage.getByRole("button",{name:"Share this board"}).click();
  const dlg=qaPage.getByRole("dialog");
  await dlg.getByRole("radio",{name:"Edit"}).click();
  await dlg.getByRole("button",{name:"Create link"}).click();
  const link=await dlg.getByLabel("Invitation link").inputValue({timeout:25000});
  assert.match(link,/\/share\/join\/[a-f0-9-]{36}#invite=[\w-]{43}$/);
  console.log("STANDARD_HELIUM_OWNER_SHARE_PASS");
  await qaPage.keyboard.press("Escape");

  // A separate executable is launched with a different Chromium user-data directory
  // AND Chromium's --incognito flag, not merely a tab in the owner's session.
  privateBrowser=await chromium.launch({
    executablePath:"/Applications/Helium.app/Contents/MacOS/Helium",
    headless:true,
    args:["--incognito","--no-first-run"],
    timeout:60000,
  });
  privateContext=await privateBrowser.newContext({viewport:{width:1280,height:850}});
  const guest=await privateContext.newPage();
  guest.on("pageerror",e=>userErrors.push("Helium incognito: "+String(e)));
  const cdp=await privateContext.newCDPSession(guest);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator",{options:{
    protocol:"ctap2",transport:"internal",hasResidentKey:true,hasUserVerification:true,
    isUserVerified:true,automaticPresenceSimulation:true
  }});
  await guest.goto(link,{waitUntil:"domcontentloaded",timeout:50000});
  await expect(guest.getByRole("button",{name:"Sign in"})).toBeVisible({timeout:55000});
  await guest.getByRole("button",{name:"Sign in"}).click();
  await guest.getByRole("link",{name:"Create an account"}).click();
  await expect(guest.getByRole("button",{name:"Create account with passkey"})).toBeVisible({timeout:55000});
  await guest.bringToFront();
  await guest.getByRole("button",{name:"Create account with passkey"}).click();
  await expect.poll(()=>new URL(guest.url()).pathname,{timeout:65000,intervals:[1000,1500,2500]})
    .toBe("/boards/"+qaBoard);
  const accounts=await Promise.all([qaPage,guest].map(p=>p.evaluate(async()=>{
    const data=await(await fetch("/patchboard-private/api/me",{credentials:"include"})).json();
    return data.accountId;
  })));
  assert.ok(accounts[0]&&accounts[1]&&accounts[0]!==accounts[1]);
  console.log("SEPARATE_HELIUM_INCOGNITO_PASS distinct_accounts=true");

  const id=randomUUID();
  const note={id,type:"note",version:1,graphUid:qaBoard,
    label:{markdown:"Incognito account created card"},content:{markdown:"Cross-profile edit smoke test"},
    properties:{nodePosition:{type:"position",position:{x:250,y:225}},
      nodeSize:{type:"size",size:{width:420,height:180}},
      nodeZIndex:{type:"number",number:1}},style:{type:"rectangle"}};
  const write=await guest.evaluate(async({board,note})=>{
    const r=await fetch("/patchboard-private/api/canvas/create",{
      method:"POST",credentials:"include",headers:{"content-type":"application/json"},
      body:JSON.stringify({board_id:board,kind:"node",payload:note})});
    return {status:r.status,body:await r.json()};
  },{board:qaBoard,note});
  assert.equal(write.status,201,JSON.stringify(write.body));
  await expect.poll(async()=>qaPage.evaluate(async({board,id})=>{
    const r=await fetch("/patchboard-private/api/canvas?board_id="+board,{credentials:"include"});
    const d=await r.json();
    return d.entities?.some(e=>e.id===id && e.version===1);
  },{board:qaBoard,id}),{timeout:25000}).toBe(true);
  console.log("INCOGNITO_WRITE_OWNER_READ_PASS");
  assert.deepEqual(userErrors,[],"Browser exceptions: "+userErrors.join(";"));
  console.log("NO_BROWSER_PAGE_ERRORS_PASS");
  console.log("QA_BOARD_ID",qaBoard);
  console.log("INCOGNITO_BROWSER_ENGINE",await guest.evaluate(()=>navigator.userAgent));
} finally {
  if(privateBrowser) await privateBrowser.close().catch(()=>{});
  if(qaPage) await qaPage.close().catch(()=>{});
  await ownerBrowser.close();
}