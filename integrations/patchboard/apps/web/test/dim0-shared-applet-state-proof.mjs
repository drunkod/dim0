import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium, expect } from "@playwright/test";

const origin = process.env.PATCHBOARD_PRIVATE_ORIGIN;
assert.ok(origin?.startsWith("http://localhost:"), "This QA uses isolated localhost server only");
const browser = await chromium.launch({ headless: true });
const contexts = [];
async function createActor(label) {
  const context = await browser.newContext();
  contexts.push(context);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  }});
  await page.goto(origin + "/patchboard-private/", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: "Create account with passkey" }))
    .toBeVisible({ timeout: 25000 });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page.getByRole("button", { name: /Sign out/ }))
    .toBeVisible({ timeout: 30000 });
  const me = await page.evaluate(async () =>
    (await (await fetch("/patchboard-private/api/me", { credentials: "include" })).json()));
  assert.ok(me.signedIn && me.accountId, label);
  return { page, me };
}
async function api(actor, route, data) {
  return actor.page.evaluate(async ({ route, data }) => {
    const r = await fetch("/patchboard-private/api/" + route, {
      ...(data ? { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(data) } : {}),
      credentials: "include", cache: "no-store",
    });
    return { status: r.status, body: await r.json() };
  }, { route, data });
}
try {
  const owner = await createActor("owner");
  const editor = await createActor("editor");
  const viewer = await createActor("viewer");
  const board = await api(owner, "boards", { title: "Jazz shared counter regression" });
  assert.equal(board.status, 201, JSON.stringify(board.body));
  const boardId = board.body.board_id;
  const invite = async (role, to) => {
    const created = await api(owner, "invite", { board_id: boardId, role });
    assert.equal(created.status, 201);
    const token = new URL(created.body.invite_url).searchParams.get("invite");
    const joined = await api(to, "join", { board_id: boardId, token });
    assert.equal(joined.status, 200);
  };
  await invite("editor", editor);
  await invite("viewer", viewer);
  console.log("SHARED_APPLET_AUTHENTICATED_ROLES_PASS");

  const noteId = randomUUID();
  const applet = { id: noteId, graphUid: boardId, type: "note",
    version: 1, style: { type: "applet" },
    content: { markdown: '<Widget state={{ count: 0 }} persist><div><button onClick={set("count", count + 1)}>+</button><span>{count}</span></div></Widget>' },
    label: { markdown: "Shared Jazz Counter" },
    properties: { nodePosition: { type: "position", position: { x: 120, y: 100 } },
      nodeSize: { type: "size", size: { width: 350, height: 240 } },
      nodeZIndex: { type: "number", number: 1 } },
  };
  const create = await api(owner, "canvas/create", { board_id: boardId, kind: "node", payload: applet });
  assert.equal(create.status, 201, JSON.stringify(create.body));
  const path = "applet-state?board_id=" + boardId + "&note_id=" + noteId;
  const initial = await api(editor, path);
  assert.deepEqual({ status: initial.status, version: initial.body.version, value: initial.body.value },
    { status: 200, version: 0, value: null });
  const first = await api(owner, "applet-state", {
    board_id: boardId, note_id: noteId, expected_version: 0, value: { count: 1 },
  });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.version, 1);
  const observed = await api(editor, path);
  assert.equal(observed.body.value.count, 1);
  console.log("JAZZ_APPLET_CROSS_BROWSER_HYDRATION_PASS");

  const write2 = await api(editor, "applet-state", {
    board_id: boardId, note_id: noteId, expected_version: 1, value: { count: 2 },
  });
  assert.equal(write2.status, 200);
  const stale = await api(owner, "applet-state", {
    board_id: boardId, note_id: noteId, expected_version: 1, value: { count: 999 },
  });
  assert.equal(stale.status, 409);
  await owner.page.reload({ waitUntil: "domcontentloaded" });
  const after = await api(owner, path);
  assert.equal(after.body.version, 2);
  assert.deepEqual(after.body.value, { count: 2 });
  console.log("JAZZ_APPLET_STALE_CAS_409_PERSISTENCE_PASS");

  const viewerRead = await api(viewer, path);
  assert.equal(viewerRead.status, 200);
  assert.equal(viewerRead.body.value.count, 2);
  const viewerWrite = await api(viewer, "applet-state", {
    board_id: boardId, note_id: noteId, expected_version: 2, value: { count: 8 },
  });
  assert.equal(viewerWrite.status, 403);
  console.log("JAZZ_APPLET_VIEWER_READ_ONLY_PASS");

  const nonAppletId = randomUUID();
  await api(owner, "canvas/create", { board_id: boardId, kind: "node", payload: {
    ...applet, id: nonAppletId, style: { type: "rectangle" },
  }});
  const forbiddenType = await api(owner,
    "applet-state?board_id=" + boardId + "&note_id=" + nonAppletId);
  assert.equal(forbiddenType.status, 400);
  const oversized = await api(owner, "applet-state", {
    board_id: boardId, note_id: noteId, expected_version: 2, value: { huge: "x".repeat(17000) },
  });
  assert.equal(oversized.status, 400);
  console.log("JAZZ_APPLET_TYPE_AND_SIZE_VALIDATION_PASS");

  const del = await api(owner, "canvas/delete", {
    board_id: boardId, entity_id: noteId, expected_version: 1,
  });
  assert.equal(del.status, 200);
  const missing = await api(owner, path);
  assert.equal(missing.status, 403);
  // Jazz entity IDs are immutable row identities: tombstoned rows are not
  // necessarily reusable, so do not attempt to reinsert the deleted UUID.
  // A subsequent read is denied because the applet node no longer exists.
  console.log("JAZZ_APPLET_DELETE_INACCESSIBLE_PASS");
  console.log("JAZZ_SHARED_COUNTER_API_ACCEPTANCE_PASS",JSON.stringify({boardId,noteId,lastSavedVersion:2}));
} finally {
  await Promise.all(contexts.map(c => c.close().catch(()=>{})));
  await browser.close();
}
