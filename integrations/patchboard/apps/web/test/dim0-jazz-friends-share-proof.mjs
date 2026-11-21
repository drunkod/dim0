import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DIM0_MCP_ORIGIN ??
  "https://barbie-discovery-bingo-system.trycloudflare.com";
const originalBoardId = process.env.DIM0_OWNER_BOARD_ID ??
  "01a1fdec-1b8f-7e30-af11-3a09df695fc5";
const cdp = new URL(process.env.DIM0_CDP_URL ?? "http://127.0.0.1:9222");
assert.ok(["127.0.0.1", "localhost", "[::1]"].includes(cdp.hostname),
  "CDP must stay on loopback; never expose a browser debugging port publicly");
const browser = await chromium.connectOverCDP(cdp.href);
const ownerPage = browser.contexts().flatMap(c => c.pages())
  .find(p => {
    try {
      const url = new URL(p.url());
      return url.origin === origin && url.pathname === "/boards/" + originalBoardId;
    } catch { return false; }
  });
assert.ok(ownerPage, "Authenticated owner board is not open in Helium");
const actors = [];

async function readCanvas(page, boardId) {
  return page.evaluate(async id => {
    const response = await fetch("/patchboard-private/api/canvas?board_id=" + id,
      { credentials: "include", cache: "no-store" });
    const body = await response.json();
    return { status: response.status, body };
  }, boardId);
}
async function api(page, path, payload) {
  return page.evaluate(async ({ path, payload }) => {
    const response = await fetch("/patchboard-private/api/" + path, {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return { status: response.status, body: await response.json() };
  }, { path, payload });
}
async function createBrowserFriend(label, shareLink, role, boardId) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  actors.push(context);
  const page = await context.newPage();
  const exceptions = [];
  page.on("pageerror", e => exceptions.push(String(e)));
  await page.goto(shareLink);
  await expect(page.getByRole("heading", { name: "You've been invited to a board" }))
    .toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Sign in" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(origin + "/signin", { timeout: 20000 });
  await expect(page.getByText("Welcome back!", { exact: true }))
    .toBeVisible({ timeout: 20000 });
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("button", { name: "Create account with passkey" }))
    .toBeVisible({ timeout: 30000 });
  // The virtual device is frame-scoped. Retain its disposable test credential
  // in memory so it can be presented again after the full sign-out navigation.
  let credential;
  const device = await context.newCDPSession(page);
  await device.send("WebAuthn.enable");
  device.on("WebAuthn.credentialAdded", event => { credential = event.credential; });
  await device.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  // Membership is redeemed server-side and Dim0 opens without Patchboard UI.
  assert.ok(!page.url().includes("/patchboard-private/"));
  await expect(page).toHaveURL(origin + "/boards/" + boardId, { timeout: 30000 });
  const snap = await readCanvas(page, boardId);
  assert.equal(snap.status, 200, JSON.stringify(snap));
  assert.equal(snap.body.role, role);
  assert.deepEqual(exceptions, [], "Browser exceptions for " + label);
  console.log("FRIEND_JOINED_CANVAS", label, role);
  return { page, context, credential, exceptions };
}

async function createLink(page, role = "editor") {
  await page.getByRole("button", { name: "Share this board" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Share/ })).toBeVisible();
  await dialog.getByRole("radio", { name: role === "editor" ? "Edit" : "View" }).click();
  await dialog.getByRole("button", { name: "Create link" }).click();
  await expect(dialog.getByLabel("Invitation link")).not.toHaveValue("", { timeout: 12000 });
  const link = await dialog.getByLabel("Invitation link").inputValue();
  const url = new URL(link);
  assert.equal(url.origin, origin);
  assert.match(url.pathname, /^\/share\/join\/[a-f0-9-]{36}$/);
  assert.match(url.hash, /^#invite=[\w-]{43}$/);
  await expect(dialog.getByText(/Reusable/).first()).toBeVisible();
  console.log("SHARE_LINK_CREATED", role, "hash-secret-not-logged");
  await page.keyboard.press("Escape");
  return link;
}

try {
  const create = await api(ownerPage, "boards", { title: "Friends collaboration QA · " + randomUUID().slice(0, 8) });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const boardId = create.body.board_id;
  await ownerPage.goto(origin + "/boards/" + boardId);
  await expect(ownerPage.getByRole("button", { name: "Share this board" }))
    .toBeVisible({ timeout: 25000 });
  const shareLink = await createLink(ownerPage);
  const A = await createBrowserFriend("A", shareLink, "member", boardId);
  const B = await createBrowserFriend("B", shareLink, "member", boardId);
  assert.notEqual((await A.page.evaluate(async()=> (await(await fetch("/patchboard-private/api/me")).json()).accountId)),
    (await B.page.evaluate(async()=> (await(await fetch("/patchboard-private/api/me")).json()).accountId)));
  console.log("REUSABLE_LINK_TWO_INDEPENDENT_ACCOUNTS_PASS");

  const marker = "Friend A created " + randomUUID().slice(0, 8);
  const entityId = randomUUID();
  const payload = {
    id: entityId, type: "note", version: 1, graphUid: boardId,
    label: { markdown: marker }, content: { markdown: "Shared via Jazz" },
    properties: {
      nodePosition: { type: "position", position: { x: 160, y: 140 } },
      nodeSize: { type: "size", size: { width: 380, height: 180 } },
      nodeZIndex: { type: "number", number: 1 },
    },
    style: { type: "rectangle" },
  };
  const note = await api(A.page, "canvas/create", {
    board_id: boardId, kind: "node", payload,
  });
  assert.equal(note.status, 201, JSON.stringify(note.body));
  await expect.poll(async () => {
    const view = await readCanvas(ownerPage, boardId);
    return view.body?.entities?.some(e => e.id === entityId && e.version === 1);
  }, { timeout: 20000, intervals: [400, 900, 1200] }).toBe(true);
  console.log("FRIEND_EDITOR_CREATE_OWNER_SEES_PASS");

  const updated = await api(B.page, "canvas/update", {
    board_id: boardId, entity_id: entityId, expected_version: 1,
    payload: { ...payload, version: 2, content: { markdown: "Friend B edited live" } },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  await expect.poll(async () => {
    const view = await readCanvas(A.page, boardId);
    return view.body.entities?.find(e => e.id === entityId)?.payload?.content?.markdown;
  }, { timeout: 20000, intervals: [400, 900, 1200] }).toBe("Friend B edited live");
  console.log("SECOND_EDITOR_UPDATE_FIRST_EDITOR_SEES_PASS");

  // Simulate simultaneous edits: the second writer sends an old CAS version.
  const conflict = await api(A.page, "canvas/update", {
    board_id: boardId, entity_id: entityId, expected_version: 1,
    payload: { ...payload, version: 2, content: { markdown: "Stale edit must not overwrite" } },
  });
  assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
  await A.page.reload();
  const afterReload = await readCanvas(A.page, boardId);
  assert.equal(afterReload.body.entities.find(e => e.id === entityId)?.payload?.content?.markdown,
    "Friend B edited live");
  console.log("STALE_WRITER_409_SURVIVES_RELOAD_PASS");

  const viewerLink = await createLink(ownerPage, "viewer");
  const V = await createBrowserFriend("V", viewerLink, "viewer", boardId);
  const denied = await api(V.page, "canvas/create", {
    board_id: boardId, kind: "node", payload: { ...payload, id: randomUUID() },
  });
  assert.equal(denied.status, 403);
  console.log("VIEWER_CAN_READ_CANNOT_WRITE_PASS");

  const members = await ownerPage.evaluate(async id =>
    (await (await fetch("/patchboard-private/api/members?board_id=" + id)).json()).members, boardId);
  assert.equal(members.length, 4, JSON.stringify(members));
  const aIdentity = await A.page.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me")).json()).accountId);
  const removed = await api(ownerPage, "members/remove", {
    board_id: boardId, user_id: aIdentity,
  });
  assert.equal(removed.status, 200);
  const afterRemove = await readCanvas(A.page, boardId);
  assert.equal(afterRemove.status, 403);
  console.log("MEMBER_REMOVAL_BLOCKS_READ_PASS");

  // Revoking the editor link blocks a newcomer but preserves existing B.
  const editorLinks = await ownerPage.evaluate(async id =>
    (await (await fetch("/patchboard-private/api/invites?board_id=" + id)).json()).invites, boardId);
  const editorLink = editorLinks.find(i => i.role === "editor" && i.reusable);
  assert.ok(editorLink);
  const revoked = await api(ownerPage, "invites/revoke", {
    board_id: boardId, invite_id: editorLink.id,
  });
  assert.equal(revoked.status, 200);
  const stillIn = await readCanvas(B.page, boardId);
  assert.equal(stillIn.status, 200);
  // Reusing its token as an already-authorized editor must now fail too.
  const code = new URLSearchParams(new URL(shareLink).hash.slice(1)).get("invite");
  const replay = await api(B.page, "join", { board_id: boardId, token: code });
  assert.equal(replay.status, 404);
  console.log("REVOKE_LINK_STOPS_NEW_GRANTS_PASS");

  const viewerToken = new URLSearchParams(new URL(viewerLink).hash.slice(1)).get("invite");
  const preview = await api(B.page, "invites/preview", { board_id: boardId, token: viewerToken });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.role, "viewer");
  assert.equal((await readCanvas(B.page, boardId)).body.role, "member");
  const deniedDisable = await api(B.page, "invites/revoke-all", { board_id: boardId });
  assert.equal(deniedDisable.status, 403);
  await ownerPage.getByRole("button", { name: "Share this board" }).click();
  ownerPage.once("dialog", prompt => prompt.accept());
  await ownerPage.getByRole("button", { name: "Disable sharing" }).click();
  await expect(ownerPage.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);

  assert.equal((await api(V.page, "join", { board_id: boardId, token: viewerToken })).status, 404);
  assert.equal((await readCanvas(V.page, boardId)).status, 200);
  await ownerPage.keyboard.press("Escape");
  console.log("DISABLE_SHARING_PRESERVES_MEMBERSHIP_PASS");

  // A completely new friend can register after following a revoked link;
  // the invalid link must not trap them or silently sign them out.
  const newcomer = await browser.newContext({ viewport: { width: 1280, height: 850 } });
  actors.push(newcomer);
  const newPage = await newcomer.newPage();
  const newCDP = await newcomer.newCDPSession(newPage);
  await newCDP.send("WebAuthn.enable");
  await newCDP.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true,
  } });
  await newPage.goto(shareLink);
  await newPage.getByRole("button", { name: "Sign in" }).click();
  await newPage.getByRole("link", { name: "Create an account" }).click();
  await newPage.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(newPage.getByText(/Invitation expired or revoked/))
    .toBeVisible({ timeout: 30000 });
  await expect(newPage.getByRole("button", { name: "Create board" }))
    .toBeVisible({ timeout: 20000 });
  const signedIn = await newPage.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me", { credentials: "include" })).json()).signedIn);
  assert.equal(signedIn, true);
  assert.equal(await newPage.evaluate(() => sessionStorage.getItem("dim0:jazz:pendingInvite")), null);
  console.log("NEW_FRIEND_REVOKED_INVITE_SIGNED_IN_DASHBOARD_PASS");

  // A verified owner with a stale link must not be portrayed as logged out.
  const staleTab = await ownerPage.context().newPage();
  try {
    await staleTab.goto(origin + "/boards");
    await staleTab.evaluate(({ boardId, code }) => sessionStorage.setItem(
      "dim0:jazz:pendingInvite", JSON.stringify({ boardId, token: code }),
    ), { boardId, code });
    await staleTab.reload();
    await expect(staleTab.getByText(/Invitation expired or revoked/))
      .toBeVisible({ timeout: 20000 });
    await expect(staleTab.getByRole("heading", { name: "Your boards" }))
      .toBeVisible({ timeout: 20000 });
    assert.equal(await staleTab.evaluate(() => sessionStorage.getItem("dim0:jazz:pendingInvite")), null);
    console.log("STALE_INVITE_404_AUTHENTICATED_DASHBOARD_PASS");

    // Network/server failures preserve the invite and expose Retry/Cancel.
    await staleTab.evaluate(({ boardId, code }) => sessionStorage.setItem(
      "dim0:jazz:pendingInvite", JSON.stringify({ boardId, token: code }),
    ), { boardId, code });
    await staleTab.route("**/patchboard-private/api/join", async route => {
      await route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    });
    await staleTab.reload();
    await expect(staleTab.getByRole("button", { name: "Retry invitation" }))
      .toBeVisible({ timeout: 20000 });
    assert.ok(await staleTab.evaluate(() => sessionStorage.getItem("dim0:jazz:pendingInvite")));
    await staleTab.unroute("**/patchboard-private/api/join");
    await staleTab.getByRole("button", { name: "Retry invitation" }).click();
    await expect(staleTab.getByText(/Invitation expired or revoked/))
      .toBeVisible({ timeout: 20000 });
    assert.equal(await staleTab.evaluate(() => sessionStorage.getItem("dim0:jazz:pendingInvite")), null);
    console.log("TRANSIENT_INVITE_RETRY_AND_CLEAR_PASS");
  } finally { await staleTab.close(); }

  await B.page.getByRole("button", { name: "Sign out" }).click();
  await expect(B.page).toHaveURL(origin + "/signin");
  assert.equal((await readCanvas(B.page, boardId)).status, 401);
  const returning = await B.context.newPage();
  await returning.goto(origin + "/boards/" + boardId);
  await expect(returning.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  assert.ok(B.credential, "Missing test passkey from verified friend registration");
  const loginDevice = await B.context.newCDPSession(returning);
  await loginDevice.send("WebAuthn.enable");
  const authenticator = await loginDevice.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await loginDevice.send("WebAuthn.addCredential", { ...authenticator, credential: B.credential });
  await returning.bringToFront();
  await returning.getByRole("button", { name: "Sign in with passkey" }).click();
  await expect(returning).toHaveURL(origin + "/boards/" + boardId, { timeout: 30000 });
  assert.equal((await readCanvas(returning, boardId)).body.role, "member");
  console.log("RETURNING_EDITOR_SIGNOUT_SIGNIN_DEEP_LINK_PASS");

  console.log("FRIENDS_SHARE_UI_ACCEPTANCE_PASS", JSON.stringify({
    boardId, roles: ["owner", "member", "member", "viewer"],
    sameReusableLinkRedemptions: 2, canvasLive: true,
  }));
} finally {
  await Promise.all(actors.map(c => c.close().catch(() => {})));
  await ownerPage.goto(origin + "/boards/" + originalBoardId).catch(() => {});
  await browser.close();
}
