import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DIM0_MCP_ORIGIN ??
  "https://barbie-discovery-bingo-system.trycloudflare.com";
const originalBoardId = "01a1fdec-1b8f-7e30-af11-3a09df695fc5";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ownerPage = browser.contexts().flatMap(c => c.pages())
  .find(p => p.url().includes("/boards/" + originalBoardId));
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
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true,
  } });
  await page.goto(shareLink);
  await expect(page.getByRole("heading", { name: "You've been invited to a board" }))
    .toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Sign in or create a passkey to join" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Sign in or create a passkey to join" }).click();
  await expect(page).toHaveURL(origin + "/jazz-signin", { timeout: 20000 });
  await expect(page.getByRole("heading", { name: "Your collaborative canvas" }))
    .toBeVisible({ timeout: 20000 });
  await expect(page.getByRole("button", { name: "Create account with passkey" }))
    .toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  // Membership is redeemed server-side and Dim0 opens without Patchboard UI.
  assert.ok(!page.url().includes("/patchboard-private/"));
  await expect(page).toHaveURL(origin + "/boards/" + boardId, { timeout: 30000 });
  const snap = await readCanvas(page, boardId);
  assert.equal(snap.status, 200, JSON.stringify(snap));
  assert.equal(snap.body.role, role);
  assert.deepEqual(exceptions, [], "Browser exceptions for " + label);
  console.log("FRIEND_JOINED_CANVAS", label, role);
  return { page, context, exceptions };
}

async function createLink(page, role = "editor") {
  await page.getByRole("button", { name: "Share this board" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: /Share/ })).toBeVisible();
  await dialog.locator("#jazz-invite-role").selectOption(role);
  await dialog.getByRole("button", { name: "Create share link for multiple friends" }).click();
  await expect(dialog.locator("#jazz-invite-link")).not.toHaveValue("", { timeout: 12000 });
  const link = await dialog.locator("#jazz-invite-link").inputValue();
  const url = new URL(link);
  assert.equal(url.origin, origin);
  assert.match(url.pathname, /^\/jazz-invite\/[a-f0-9-]{36}$/);
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

  console.log("FRIENDS_SHARE_UI_ACCEPTANCE_PASS", JSON.stringify({
    boardId, roles: ["owner", "member", "member", "viewer"],
    sameReusableLinkRedemptions: 2, canvasLive: true,
  }));
} finally {
  await Promise.all(actors.map(c => c.close().catch(() => {})));
  await ownerPage.goto(origin + "/boards/" + originalBoardId).catch(() => {});
  await browser.close();
}
