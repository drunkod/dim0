import assert from "node:assert/strict";
import { chromium, expect } from "@playwright/test";

const base = process.env.DIM0_MCP_ORIGIN ?? "http://127.0.0.1:5199";
const browser = await chromium.launch({
  executablePath: "/Applications/Helium.app/Contents/MacOS/Helium",
  headless: true,
});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));

const boardId = "00000000-0000-4000-8000-000000000001";
const noteId = "00000000-0000-4000-8000-000000000002";
const failIdentity = async (route) => route.fulfill({
  status: 503, contentType: "application/json", body: '{"signedIn":false}',
});

try {
  // A transient 503 is never interpreted as an unauthenticated member;
  // the original nested applet URL stays in place until Retry succeeds.
  await page.route("**/patchboard-private/api/me", failIdentity);
  const destination = "/boards/" + boardId + "/applets/" + noteId + "?focus=code";
  await page.goto(base + destination);
  await expect(page.getByRole("button", { name: "Retry connection" }))
    .toBeVisible({ timeout: 25000 });
  assert.equal(new URL(page.url()).pathname, new URL(base + destination).pathname);
  assert.equal(await page.locator('[data-sidebar="sidebar"]').count(), 0);
  console.log("JAZZ_IDENTITY_503_RETRY_VISIBLE_PASS");
  await page.unroute("**/patchboard-private/api/me");
  await page.getByRole("button", { name: "Retry connection" }).click();
  await expect(page).toHaveURL(/\/signin\?next=/, { timeout: 25000 });
  const next = new URL(page.url()).searchParams.get("next");
  assert.equal(next, destination);
  console.log("JAZZ_IDENTITY_RETRY_PRESERVES_APPLET_DESTINATION_PASS");

  // The invitation page must not present a 503 as a signed-out account or
  // as an expired link; it offers Retry and Cancel until the service returns.
  await page.route("**/patchboard-private/api/me", failIdentity);
  // A valid-looking, otherwise unknown QA token is mocked at the public
  // preview boundary. This isolates identity 503 from an expired-link 404.
  await page.route("**/patchboard-private/api/invites/preview", async route =>
    route.fulfill({ status: 200, contentType: "application/json", body: '{"role":"editor"}' }));
  const invite = "/share/join/" + boardId + "#invite=" + "A".repeat(43);
  await page.goto(base + invite);
  await expect(page.getByRole("button", { name: "Retry invitation" }))
    .toBeVisible({ timeout: 25000 });
  await expect(page.getByRole("button", { name: "Cancel invitation" })).toBeVisible();
  assert.equal(await page.getByText(/expired or revoked/i).count(), 0);
  console.log("JAZZ_INVITATION_503_RETRY_CANCEL_PASS");
  await page.unroute("**/patchboard-private/api/me");
  await page.getByRole("button", { name: "Retry invitation" }).click();
  await expect(page.getByRole("button", { name: "Sign in", exact: true }))
    .toBeVisible({ timeout: 25000 });
  await expect(page.getByText(/grants permission to view and edit/i)).toBeVisible();
  assert.ok(page.url().endsWith(invite));
  console.log("JAZZ_INVITATION_RETRY_KEEPS_LINK_PASS");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(base + "/signin", { timeout: 30000 });
  await expect(page.getByRole("button", { name: "Sign in with passkey" }))
    .toBeVisible({ timeout: 30000 });
  await expect(page.getByRole("link", { name: "Create an account" }))
    .toBeVisible({ timeout: 30000 });
  console.log("INVITATION_TO_ORIGINAL_DIM0_SIGNIN_PASS");
  await page.unroute("**/patchboard-private/api/invites/preview");

  assert.deepEqual(errors, [], "No unhandled errors should reach the browser");
  console.log("JAZZ_AUTH_OUTAGE_BROWSER_ACCEPTANCE_PASS");
} finally {
  await context.close();
  await browser.close();
}
