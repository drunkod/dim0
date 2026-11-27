import { chromium, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
const url = process.env.PRIVATE_URL || "http://localhost:8792/patchboard-private/";
const evidenceDir = process.env.PRIVATE_EVIDENCE_DIR || "/Users/test/work/patchwork/demo/patchboard-private-nov21/evidence";
await mkdir(evidenceDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const actors = [];
const errors = [];
try {
  for (const label of ["A", "B"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push({ label, error: String(e) }));
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
      protocol: "ctap2", transport: "internal", hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
    } });
    await page.goto(url);
    await expect(page.getByRole("heading", { name: "Sign in to your private board" }))
      .toBeVisible({ timeout: 20000 });
    await page.getByRole("button", { name: "Create account with passkey" }).click();
    await expect(page.getByRole("button", { name: /Sign out/ }))
      .toBeVisible({ timeout: 25000 });
    const identityResult = await context.request.get("http://localhost:8792/patchboard-private/api/me");
    assert.equal(identityResult.status(), 200);
    const identity = await identityResult.json();
    assert.ok(identity.signedIn && identity.id && identity.accountId && identity.name);
    actors.push({ label, id: identity.id, accountId: identity.accountId, name: identity.name, page, context });
    console.log("PASSKEY_ENROLLED", label, JSON.stringify({ id: identity.id, accountId: identity.accountId }));
    await page.screenshot({ path: evidenceDir + "/passkey-" + label + ".png" });
  }
  assert.notEqual(actors[0].id, actors[1].id);
  assert.notEqual(actors[0].accountId, actors[1].accountId);
  await Promise.all(actors.map(a => a.page.reload()));
  await Promise.all(actors.map(a => expect(a.page.getByRole("button", { name: /Sign out/ }))
    .toBeVisible({ timeout: 25000 })));
  for (const actor of actors) {
    const result = await actor.context.request.get("http://localhost:8792/patchboard-private/api/me");
    const returned = await result.json();
    assert.equal(returned.id, actor.id);
    assert.equal(returned.accountId, actor.accountId);
  }
  assert.equal(errors.length, 0, JSON.stringify(errors));
  console.log("TWO_PASSKEY_USERS_PASS", JSON.stringify({
    origin: new URL(url).origin, users: actors.map(({ label, id, accountId }) => ({ label, id, accountId })),
    javascriptErrors: errors, repeatedAfterPageReload: true,
  }));
  await writeFile(evidenceDir + "/passkey-two-users.json", JSON.stringify({
    testedAt: new Date().toISOString(), users: actors.map(({ label, id, accountId }) => ({ label, id, accountId })),
    browserPageErrors: errors,
  }, null, 2));
} finally {
  for (const actor of actors) await actor.context.close();
  await browser.close();
}