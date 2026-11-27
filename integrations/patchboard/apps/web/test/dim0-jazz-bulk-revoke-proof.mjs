import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const origin = process.env.DIM0_MCP_ORIGIN ?? "http://localhost:48770";
const parsedOrigin = new URL(origin);
assert.equal(parsedOrigin.protocol, "http:");
assert.ok(["localhost", "127.0.0.1"].includes(parsedOrigin.hostname));
assert.ok(![5180, 48751, 8792, 8794].includes(Number(parsedOrigin.port)),
  "Bulk invite stress proof must use a disposable QA origin, never a presentation server");

const browser = await chromium.launch({
  executablePath: "/Applications/Helium.app/Contents/MacOS/Helium",
  headless: true,
});
const ctx = await browser.newContext();
const page = await ctx.newPage();

const api = async (path, body) => page.evaluate(async ({ path, body }) => {
  const response = await fetch("/patchboard-private/api/" + path, {
    method: "POST", headers: { "content-type": "application/json" },
    credentials: "include", body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}, { path, body });

try {
  await page.goto(origin + "/signup", { waitUntil: "domcontentloaded" });
  const device = await ctx.newCDPSession(page);
  await device.send("WebAuthn.enable");
  await device.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.getByRole("button", { name: "Create account with passkey" }).click();
  await expect(page).toHaveURL(origin + "/boards", { timeout: 30000 });
  const board = await api("boards", { title: "Bulk-revoke QA >200" });
  assert.equal(board.status, 201);
  const boardId = board.body.board_id;
  assert.ok(boardId);

  // The owner's GUI list is capped to 200 rows; Disable sharing must operate
  // over the canonical Jazz table, NOT only the visible rows.
  let lastToken;
  for (let n = 0; n < 205; n++) {
    const invite = await api("invite", { board_id: boardId, role: "editor", reusable: true });
    assert.equal(invite.status, 201, "Invitation creation number " + (n + 1));
    assert.equal(invite.body.expires_at, null,
      "Original Dim0 reusable links must remain valid until owner revocation");
    lastToken = new URLSearchParams(new URL(invite.body.invite_url).hash.slice(1)).get("invite");
    if ((n + 1) % 50 === 0) console.log("QA_INVITES_CREATED", n + 1);
  }
  const listed = await page.evaluate(async boardId => {
    const r = await fetch("/patchboard-private/api/invites?board_id=" + boardId);
    return { status: r.status, body: await r.json() };
  }, boardId);
  assert.equal(listed.status, 200);
  assert.ok(listed.body.invites.length <= 200, "List endpoint is intentionally capped");

  const result = await api("invites/revoke-all", { board_id: boardId });
  assert.equal(result.status, 200);
  assert.equal(result.body.revoked_count, 205,
    "Disable sharing must revoke ALL links, including beyond the display cap");
  const replay = await api("join", { board_id: boardId, token: lastToken });
  assert.equal(replay.status, 404);
  console.log("JAZZ_REUSABLE_INVITES_NEVER_EXPIRE_AND_REVOKE_ALL_205_PASS");
} finally {
  await ctx.close();
  await browser.close();
}
