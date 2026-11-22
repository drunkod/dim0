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
async function memberDirectoryStatus(page, boardId) {
  return page.evaluate(async id => (await fetch(
    "/patchboard-private/api/members?board_id=" + encodeURIComponent(id),
    { credentials: "include", cache: "no-store" },
  )).status, boardId);
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
  // A dev server may stream fonts and canvases after the invite page is
  // interactive. Waiting for the full load event made the second independent
  // friend spuriously time out even though the initial invite was usable.
  await page.goto(shareLink, { waitUntil: "domcontentloaded", timeout: 60000 });
  await expect(page.getByRole("heading", { name: "You've been invited to a board" }))
    .toBeVisible({ timeout: 25000 });
  // Match the original Dim0 share semantics: anonymous invitees see their
  // View/Edit permission before they register, without being granted access.
  const landing = new URL(page.url());
  const token = new URLSearchParams(landing.hash.slice(1)).get("invite");
  assert.ok(token, "Expected the invitation code on the rendered Dim0 landing page");
  const preview = await api(page, "invites/preview", { board_id: boardId, token });
  assert.equal(preview.status, 200);
  assert.equal(preview.body.role, role === "member" ? "editor" : "viewer");
  await expect(page.getByText(role === "member" ?
    /grants permission to view and edit/i : /grants view-only access/i)).toBeVisible();
  console.log("ANONYMOUS_INVITE_PREVIEW_PASS", label, role);
  await expect(page.getByRole("button", { name: "Sign in" }))
    .toBeVisible();
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(origin + "/signin", { timeout: 20000 });
  // Assert the actual actions, not a fragile exact copy string. Some Helium
  // rerenders temporarily omit the welcome heading while preserving the
  // usable Dim0 sign-in card and its registration affordance.
  await expect(page.getByRole("button", { name: "Sign in with passkey" }))
    .toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("link", { name: "Create an account" }))
    .toBeVisible({ timeout: 30000 });
  await page.getByRole("link", { name: "Create an account" }).click();
  await expect(page.getByRole("button", { name: "Create account with passkey" }))
    .toBeVisible({ timeout: 30000 });
  // The virtual device is frame-scoped. Retain its disposable test credential
  // in memory so it can be presented again after the full sign-out navigation.
  let credential;
  const device = await context.newCDPSession(page);
  await device.send("WebAuthn.enable");
  device.on("WebAuthn.credentialAdded", event => { credential = event.credential; });
  const { authenticatorId } = await device.send("WebAuthn.addVirtualAuthenticator", { options: {
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
  return { page, context, credential, exceptions, device, authenticatorId };
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
  await expect(dialog.getByText(/Never expires/).first()).toBeVisible();
  console.log("SHARE_LINK_CREATED", role, "hash-secret-not-logged");
  await page.keyboard.press("Escape");
  return link;
}

try {
  const create = await api(ownerPage, "boards", { title: "Friends collaboration QA · " + randomUUID().slice(0, 8) });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const boardId = create.body.board_id;
  await ownerPage.goto(origin + "/boards/" + boardId, { waitUntil: "domcontentloaded" });
  await expect(ownerPage.getByRole("button", { name: "Share this board" }))
    .toBeVisible({ timeout: 25000 });
  // Legacy single-use compatibility links must enter the same Dim0 invite
  // screen, retain the board across registration, and reject a second use.
  // A separate board keeps the four-person reusable sharing assertions intact.
  const singleBoard = await api(ownerPage, "boards", {
    title: "QA single-use compatibility " + randomUUID().slice(0, 8),
  });
  assert.equal(singleBoard.status, 201);
  const singleId = singleBoard.body.board_id;
  const singleInvite = await api(ownerPage, "invite", {
    board_id: singleId, role: "editor", reusable: false,
  });
  assert.equal(singleInvite.status, 201);
  const oldUrl = new URL(singleInvite.body.invite_url);
  assert.equal(oldUrl.origin, origin);
  assert.equal(oldUrl.pathname, "/patchboard-private/");
  assert.equal(oldUrl.searchParams.get("board"), singleId);
  const rawResponse = await ownerPage.context().request.get(oldUrl.href, { maxRedirects: 0 });
  assert.equal(rawResponse.status(), 302);
  const destination = new URL(rawResponse.headers().location, origin);
  assert.equal(destination.pathname, "/share/join/" + singleId);
  assert.equal(destination.search, "");
  assert.equal(new URLSearchParams(destination.hash.slice(1)).get("invite"),
    oldUrl.searchParams.get("invite"), "Redirect must preserve the invitation code");
  await createBrowserFriend("single-use editor", oldUrl.href, "member", singleId);
  const secondContext = await browser.newContext();
  actors.push(secondContext);
  const secondPage = await secondContext.newPage();
  await secondPage.goto(oldUrl.href, { waitUntil: "domcontentloaded" });
  await expect(secondPage.getByText(/expired or been revoked/i).first())
    .toBeVisible({ timeout: 30000 });
  const singleReplay = await api(secondPage, "invites/preview", {
    board_id: singleId, token: oldUrl.searchParams.get("invite"),
  });
  assert.equal(singleReplay.status, 404);
  console.log("SINGLE_USE_DIM0_REDIRECT_JOIN_AND_REPLAY_PASS");

  const shareLink = await createLink(ownerPage);
  const A = await createBrowserFriend("A", shareLink, "member", boardId);
  const B = await createBrowserFriend("B", shareLink, "member", boardId);
  assert.notEqual((await A.page.evaluate(async()=> (await(await fetch("/patchboard-private/api/me")).json()).accountId)),
    (await B.page.evaluate(async()=> (await(await fetch("/patchboard-private/api/me")).json()).accountId)));
  console.log("REUSABLE_LINK_TWO_INDEPENDENT_ACCOUNTS_PASS");

  // A signed-in member's interrupted join must show both recovery choices,
  // without turning a temporary 503 into a terminal/revoked link.
  const retryTab = await B.context.newPage();
  try {
    await retryTab.goto(shareLink, { waitUntil: "domcontentloaded" });
    await expect(retryTab.getByRole("button", { name: "Open board" }))
      .toBeVisible({ timeout: 20000 });
    await retryTab.route("**/patchboard-private/api/join", route => route.fulfill({
      status: 503, contentType: "application/json", body: "{}",
    }));
    await retryTab.getByRole("button", { name: "Open board" }).click();
    await expect(retryTab.getByRole("button", { name: "Retry invitation" }))
      .toBeVisible({ timeout: 20000 });
    await expect(retryTab.getByRole("button", { name: "Cancel invitation" })).toBeVisible();
    await retryTab.unroute("**/patchboard-private/api/join");
    await retryTab.getByRole("button", { name: "Retry invitation" }).click();
    await expect(retryTab).toHaveURL(origin + "/boards/" + boardId, { timeout: 20000 });
    console.log("SIGNED_IN_INVITE_503_RETRY_CANCEL_PASS");
  } finally { await retryTab.close(); }

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
  await A.page.reload({ waitUntil: "domcontentloaded" });
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
  assert.equal(await memberDirectoryStatus(V.page, boardId), 403,
    "Viewer cannot inspect the owner's member directory");

  // Preserve the legacy upgrade-only rule in Jazz: viewer -> editor when
  // accepting an Edit link, and never editor -> viewer on a View link.
  const editorCode = new URLSearchParams(new URL(shareLink).hash.slice(1)).get("invite");
  const viewerCode = new URLSearchParams(new URL(viewerLink).hash.slice(1)).get("invite");
  assert.equal((await api(V.page, "join", { board_id: boardId, token: editorCode })).status, 200);
  assert.equal((await readCanvas(V.page, boardId)).body.role, "member");
  assert.equal((await api(V.page, "join", { board_id: boardId, token: viewerCode })).status, 200);
  assert.equal((await readCanvas(V.page, boardId)).body.role, "member");
  console.log("JAZZ_INVITE_UPGRADE_ONLY_ROLE_PARITY_PASS");
  assert.equal(await memberDirectoryStatus(V.page, boardId), 403,
    "Editor cannot inspect the owner's member directory");

  const members = await ownerPage.evaluate(async id =>
    (await (await fetch("/patchboard-private/api/members?board_id=" + id)).json()).members, boardId);
  assert.equal(members.length, 4, JSON.stringify(members));
  const ownerIdentity = await ownerPage.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me")).json()));
  assert.equal(members.find(m => m.id === ownerIdentity.accountId)?.name, ownerIdentity.name);
  const aProfile = await A.page.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me")).json()));
  assert.equal(members.find(m => m.id === aProfile.accountId)?.name, aProfile.name);
  const bProfile = await B.page.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me")).json()));
  assert.equal(members.find(m => m.id === bProfile.accountId)?.name, bProfile.name);
  console.log("JAZZ_OWNER_ONLY_MEMBER_DISPLAY_NAMES_PASS");
  // Assert actual rendered UI labels and row-specific actions rather than
  // trusting only the /members JSON. Full Jazz account IDs remain the keys.
  await ownerPage.getByRole("button", { name: "Share this board" }).click();
  const shareDialog = ownerPage.getByRole("dialog");
  const memberRow = (profile) => {
    const label = profile.name.trim() + " · " + profile.accountId.slice(0, 8);
    return shareDialog.getByRole("listitem").filter({ hasText: label });
  };
  const ownerRow = memberRow(ownerIdentity);
  const aliceRow = memberRow(aProfile);
  const bobRow = memberRow(bProfile);
  await expect(ownerRow).toBeVisible({ timeout: 15000 });
  await expect(ownerRow.getByRole("button", { name: "Remove" })).toHaveCount(0);
  await expect(aliceRow).toBeVisible({ timeout: 15000 });
  await expect(bobRow).toBeVisible({ timeout: 15000 });
  // The parent Helium browser and this CDP client share the owner tab.
  // Stub only the tab's native confirm to avoid competing dialog handlers.
  await ownerPage.evaluate(() => {
    window.__dim0QaRemoveMessage = "";
    window.confirm = message => {
      window.__dim0QaRemoveMessage = message;
      return true;
    };
  });
  const removedResponse = ownerPage.waitForResponse(response =>
    new URL(response.url()).pathname === "/patchboard-private/api/members/remove" &&
    response.request().method() === "POST");
  await aliceRow.getByRole("button", { name: "Remove", exact: true }).click();
  const removed = await removedResponse;
  assert.equal(removed.status(), 200);
  assert.deepEqual(removed.request().postDataJSON(), {
    board_id: boardId, user_id: aProfile.accountId,
  });
  assert.match(await ownerPage.evaluate(() => window.__dim0QaRemoveMessage),
    /Remove .* from this board\?/);
  await expect(aliceRow).toHaveCount(0, { timeout: 15000 });
  await expect(bobRow).toBeVisible();
  assert.equal((await readCanvas(B.page, boardId)).status, 200);
  await ownerPage.keyboard.press("Escape");
  console.log("OWNER_REMOVED_SELECTED_MEMBER_BY_FULL_JAZZ_ID_PASS");
  const afterRemove = await A.context.request.get(
    origin + "/patchboard-private/api/canvas?board_id=" + boardId);
  assert.equal(afterRemove.status(), 403);
  const removedWrite = await A.context.request.post(
    origin + "/patchboard-private/api/canvas/create", {
      data: { board_id: boardId, kind: "node", payload: { ...payload, id: randomUUID() } },
    });
  assert.equal(removedWrite.status(), 403);
  await expect(A.page).toHaveURL(origin + "/boards?access=removed", { timeout: 20000 });
  // The canonical 403 and URL change are already verified above. Wait for
  // the board-list screen to hydrate before checking its explanation.
  await expect(A.page.getByRole("alert")).toContainText(
    /Access to that board was removed/, { timeout: 30000 });
  console.log("MEMBER_REMOVAL_EXITS_OPEN_BOARD_PASS");

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
  // The owner tab is controlled by both the launch-side Playwright session and
  // this CDP-connected session. Native confirm dialogs may be auto-dismissed
  // by one connection before the other can call dialog.accept(). Stub only
  // window.confirm in this disposable QA tab, assert its wording, then test
  // the real Disable sharing button, Jazz transaction and subsequent denial.
  await ownerPage.evaluate(() => {
    const capture = window;
    capture.__dim0QaConfirmMessage = "";
    window.confirm = message => {
      capture.__dim0QaConfirmMessage = message;
      return true;
    };
  });
  await ownerPage.getByRole("button", { name: "Disable sharing" }).click();
  assert.match(await ownerPage.evaluate(() => window.__dim0QaConfirmMessage),
    /Disable sharing\?.*Existing members keep access/i);
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
  await newPage.goto(shareLink, { waitUntil: "domcontentloaded", timeout: 60000 });
  // With original Dim0-style public preview, a confirmed revoked token
  // correctly shows a terminal error BEFORE making the user register.
  await expect(newPage.getByText(/This invitation has expired or been revoked/))
    .toBeVisible({ timeout: 20000 });
  await newPage.getByRole("button", { name: "Back home" }).click();
  await expect(newPage).toHaveURL(/\/signin/, { timeout: 20000 });
  await newPage.getByRole("link", { name: "Create an account" }).click();
  await newPage.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(newPage.getByRole("button", { name: "Create board" }))
    .toBeVisible({ timeout: 20000 });
  console.log("REVOKED_INVITE_PREVIEW_BEFORE_SIGNUP_PASS");
  const signedIn = await newPage.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me", { credentials: "include" })).json()).signedIn);
  assert.equal(signedIn, true);
  assert.equal(await newPage.evaluate(() => sessionStorage.getItem("dim0:jazz:pendingInvite")), null);
  console.log("NEW_FRIEND_REVOKED_INVITE_SIGNED_IN_DASHBOARD_PASS");

  // A verified owner with a stale link must not be portrayed as logged out.
  const staleTab = await ownerPage.context().newPage();
  try {
    await staleTab.goto(origin + "/boards", { waitUntil: "domcontentloaded" });
    // Finish the initial identity/invitation effect before seeding the next
    // invitation. Otherwise the first render can consume the code between
    // sessionStorage.setItem and reload, leaving no error on the new page.
    await expect(staleTab.getByRole("heading", { name: "Your boards" }))
      .toBeVisible({ timeout: 30000 });
    await staleTab.evaluate(({ boardId, code }) => sessionStorage.setItem(
      "dim0:jazz:pendingInvite", JSON.stringify({ boardId, token: code }),
    ), { boardId, code });
    await staleTab.reload({ waitUntil: "domcontentloaded" });
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
    await staleTab.reload({ waitUntil: "domcontentloaded" });
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
  await returning.goto(origin + "/boards/" + boardId, { waitUntil: "domcontentloaded" });
  await expect(returning.getByRole("button", { name: "Sign in with passkey" })).toBeVisible();
  assert.ok(B.credential, "Missing test passkey from verified friend registration");
  // Helium permits a single internal virtual authenticator per environment.
  // The earlier passkey remains stored in B.credential, so remove that device
  // before attaching a replacement to the new tab. Avoid two simultaneous
  // internal authenticators, which raises a CDP protocol error in Helium.
  await B.device.send("WebAuthn.removeVirtualAuthenticator", {
    authenticatorId: B.authenticatorId,
  }).catch(error => {
    if (!/not found|not exist|No authenticator/i.test(String(error))) throw error;
  });
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
    boardId, roles: ["owner", "member", "member", "member"],
    viewerWasUpgraded: true, sameReusableLinkRedemptions: 2, canvasLive: true,
  }));
} finally {
  await Promise.all(actors.map(c => c.close().catch(() => {})));
  await ownerPage.goto(origin + "/boards/" + originalBoardId, { waitUntil: "domcontentloaded" }).catch(() => {});
  await browser.close();
}
