import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

// For a new sprint, authorize a fresh test board in ChatGPT and pass its IDs.
// This test never logs passkeys or invitation tokens.
const origin = process.env.DIM0_MCP_ORIGIN;
const boardId = process.env.DIM0_MCP_BOARD_ID;
const firstId = process.env.DIM0_MCP_ENTITY_ID;
const expectedMarker = process.env.DIM0_MCP_EXPECTED_MARKER ?? "PLUGIN-LIVE-UPDATED";
const verifyOnly = process.env.DIM0_MCP_VERIFY_ONLY === "1";
assert.ok(origin && boardId && firstId,
  "Set DIM0_MCP_ORIGIN, DIM0_MCP_BOARD_ID and DIM0_MCP_ENTITY_ID");
const browser = await chromium.connectOverCDP(
  process.env.HELIUM_CDP_URL ?? "http://127.0.0.1:9222");
const ownerPage = browser.contexts().flatMap(context => context.pages())
  .find(page => page.url().includes("/boards/" + boardId));
assert.ok(ownerPage, "Helium owner board tab not found");

async function readCanvas(page) {
  return page.evaluate(async boardId => {
    const r = await fetch("/patchboard-private/api/canvas?board_id=" + boardId,
      { credentials: "include", cache: "no-store" });
    return { status: r.status, ...(await r.json()) };
  }, boardId);
}

let viewerContext;
try {
  const ownerBefore = await readCanvas(ownerPage);
  assert.equal(ownerBefore.status, 200);
  assert.equal(ownerBefore.role, "owner");
  const ownerRecord = ownerBefore.entities.find(row => row.id === firstId);
  assert.ok(ownerRecord);
  console.log("OWNER_CHATGPT_ENTITY_VISIBLE", boardId);

  const invite = await ownerPage.evaluate(async boardId => {
    const res = await fetch("/patchboard-private/api/invite", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, role: "viewer" }),
    });
    return { status: res.status, body: await res.json() };
  }, boardId);
  assert.equal(invite.status, 201, JSON.stringify({ status: invite.status, error: invite.body.error }));
  const invitationToken = new URL(invite.body.invite_url).searchParams.get("invite");
  assert.ok(invitationToken, "No invite token issued");

  viewerContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const viewerPage = await viewerContext.newPage();
  const jsErrors = [];
  viewerPage.on("pageerror", error => jsErrors.push(String(error)));
  const cdp = await viewerContext.newCDPSession(viewerPage);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true,
    automaticPresenceSimulation: true,
  } });
  await viewerPage.goto(origin + "/patchboard-private/");
  await expect(viewerPage.getByRole("heading", { name: "Sign in to your private board" }))
    .toBeVisible({ timeout: 18000 });
  await viewerPage.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(viewerPage.getByRole("button", { name: /Sign out/ }))
    .toBeVisible({ timeout: 20000 });
  const joined = await viewerPage.evaluate(async ({ boardId, token }) => {
    const r = await fetch("/patchboard-private/api/join", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, token }),
    });
    return r.status;
  }, { boardId, token: invitationToken });
  assert.equal(joined, 200);
  await viewerPage.goto(origin + "/boards/" + boardId);
  await expect(viewerPage.getByText("Read-only")).toBeVisible({ timeout: 28000 });
  await expect.poll(async () => {
    const snap = await readCanvas(viewerPage);
    return snap.status === 200 && snap.role === "viewer" &&
      snap.entities.some(row => row.id === firstId);
  }, { timeout: 20000, intervals: [250, 500, 1000] }).toBe(true);
  console.log("SECOND_ACCOUNT_VIEWER_CAN_SEE_CHATGPT_ENTITY");

  const denied = await viewerPage.evaluate(async ({ boardId, firstId }) => {
    const current = await (await fetch("/patchboard-private/api/canvas?board_id=" + boardId)).json();
    const note = current.entities.find(row => row.id === firstId);
    const r = await fetch("/patchboard-private/api/canvas/update", {
      method: "POST", credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ board_id: boardId, entity_id: firstId,
        expected_version: note.version,
        payload: { ...note.payload, content: { markdown: "FORGED BY VIEWER" } },
      }),
    });
    return r.status;
  }, { boardId, firstId });
  assert.equal(denied, 403);
  console.log("VIEWER_WRITE_BLOCKED_403");

  await expect.poll(async () => viewerPage.locator("canvas").count(),
    { timeout: 15000 }).toBeGreaterThan(0);
  await viewerPage.screenshot({ path: "/tmp/dim0-webmcp-plugin-viewer-before.png", fullPage: true });
  if (verifyOnly) {
    const expectedIds = [process.env.DIM0_MCP_APPLET_ID, process.env.DIM0_MCP_LINK_ID].filter(Boolean);
    const snapshot = await readCanvas(viewerPage);
    for (const id of expectedIds) assert.ok(snapshot.entities.some(row => row.id === id), "Missing " + id);
    if (process.env.DIM0_MCP_APPLET_ID) {
      await expect(viewerPage.getByRole("button", { name: "+1" }))
        .toBeVisible({ timeout: 20000 });
    }
    await viewerPage.screenshot({ path: "/tmp/dim0-webmcp-plugin-viewer-after.png", fullPage: true });
    console.log("SECOND_ACCOUNT_CURRENT_CANVAS_PASS", snapshot.entities.length);
  } else {
    const clip = { x: 120, y: 105, width: 555, height: 280 };
    const beforeImage = await viewerPage.screenshot({ clip });
    console.log("VIEWER_READY_FOR_CHATGPT_UPDATE");
    await expect.poll(async () => {
      const snap = await readCanvas(viewerPage);
      const note = snap.entities.find(row => row.id === firstId);
      return note && note.version > ownerRecord.version &&
        note.payload?.content?.markdown?.includes(expectedMarker);
    }, { timeout: 155000, intervals: [400, 1000, 2000] }).toBe(true);
    await expect.poll(async () => {
      const afterImage = await viewerPage.screenshot({ clip });
      return !beforeImage.equals(afterImage);
    }, { timeout: 20000, intervals: [300, 700, 1400] }).toBe(true);
    await viewerPage.screenshot({ path: "/tmp/dim0-webmcp-plugin-viewer-after.png", fullPage: true });
    console.log("SECOND_ACCOUNT_LIVE_CHATGPT_UPDATE_PASS", firstId);
  }
  assert.deepEqual(jsErrors, []);
  console.log("VIEWER_JS_ERRORS_NONE");
} finally {
  if (viewerContext) await viewerContext.close();
  await browser.close();
}
