/** Native Settings proof: built Dim0 UI, real private Better Auth/Jazz server,
 * two virtual-passkey users and a stale preference update. Never uses a live store. */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";

const patchboard = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const webui = resolve(patchboard, "../../webui");
const root = await mkdtemp(join(tmpdir(), "dim0-native-profile-fixture-"));
const evidence = process.env.PATCHBOARD_NATIVE_PROFILE_EVIDENCE
  ? resolve(process.env.PATCHBOARD_NATIVE_PROFILE_EVIDENCE)
  : await mkdtemp(join(tmpdir(), "dim0-native-profile-evidence-"));
await mkdir(evidence, { recursive: true, mode: 0o700 });
const freePort = () => new Promise((done, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const { port } = server.address();
    server.close(() => done(port));
  });
});
const frontendPort = await freePort();
let backendPort = await freePort();
while (backendPort === frontendPort) backendPort = await freePort();
const origin = "http://localhost:" + frontendPort;
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(key)));
Object.assign(env, {
  CI: "1", VITE_DIM0_JAZZ_CANVAS: "1", APP_PORT: String(frontendPort),
  PATCHBOARD_PRIVATE_ROOT: root, PATCHBOARD_PRIVATE_ORIGIN: origin,
  PATCHBOARD_PRIVATE_DEV: "1", PATCHBOARD_PRIVATE_PORT: String(backendPort),
});
const jobs = [];
let browser;
function launch(command, args, cwd) {
  const child = spawn(command, args, { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { output = (output + chunk).slice(-12000); });
  }
  const done = new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("exit", code => resolveDone(code));
  });
  const job = { child, done, output: () => output };
  jobs.push(job);
  return job;
}
async function execute(command, args, cwd) {
  const job = launch(command, args, cwd);
  assert.equal(await job.done, 0, command + " failed: " + job.output());
}
async function waitReady(job, url) {
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.equal(job.child.exitCode, null, "QA service exited: " + job.output());
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(800) });
      if (response.ok) return;
    } catch { /* cold local start */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("QA service did not become ready");
}
async function account() {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
  await context.route("**/*", route => {
    const url = new URL(route.request().url());
    return url.origin === origin || ["data:", "blob:"].includes(url.protocol)
      ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });
  await page.goto(origin + "/signup");
  await page.getByRole("button", { name: "Create account with passkey", exact: true }).click();
  await expect(page.getByRole("link", { name: "Account settings" })).toBeVisible({ timeout: 30000 });
  const identity = await page.evaluate(async () => (await fetch("/patchboard-private/api/me")).json());
  assert.ok(identity.signedIn && identity.id && identity.accountId);
  await page.getByRole("link", { name: "Account settings" }).click();
  await expect(page).toHaveURL(origin + "/settings");
  await expect(page.getByLabel("Preferred locale (BCP 47)")).toHaveValue("en");
  return { context, page, identity };
}
try {
  await execute("pnpm", ["auth:migrate:private"], patchboard);
  const backend = launch("pnpm", ["--filter", "@patchboard/server", "exec", "tsx", "src/private-demo.ts"], patchboard);
  await waitReady(backend, "http://127.0.0.1:" + backendPort + "/health");
  const vite = join(webui, "node_modules/.bin/vite");
  const buildDir = join(root, "native-build");
  await execute(vite, ["build", "--outDir", buildDir], webui);
  const frontend = launch(vite, ["preview", "--outDir", buildDir, "--host", "127.0.0.1", "--port", String(frontendPort), "--strictPort"], webui);
  await waitReady(frontend, origin + "/signup");
  browser = await chromium.launch({ headless: true });
  const a = await account(), b = await account();
  assert.notEqual(a.identity.id, b.identity.id);
  assert.notEqual(a.identity.accountId, b.identity.accountId);
  const stale = await a.context.newPage();
  await stale.goto(origin + "/settings");
  await expect(stale.getByLabel("Preferred locale (BCP 47)")).toHaveValue("en");
  const field = a.page.getByLabel("Preferred locale (BCP 47)");
  await field.fill("ru-RU");
  const saved = a.page.waitForResponse(r => r.url().endsWith("/account/preferences") && r.request().method() === "PATCH");
  await a.page.getByRole("button", { name: "Save locale preference" }).click();
  const committed = await saved;
  assert.equal(committed.status(), 200);
  assert.deepEqual(await committed.json(), { locale: "ru-RU", version: 1, changed: true });
  await expect(a.page.getByRole("status")).toHaveText("Locale preference saved.");
  await a.page.screenshot({ path: join(evidence, "account-a-saved.png") });
  await stale.getByLabel("Preferred locale (BCP 47)").fill("fr-FR");
  const denied = stale.waitForResponse(r => r.url().endsWith("/account/preferences") && r.request().method() === "PATCH");
  await stale.getByRole("button", { name: "Save locale preference" }).click();
  const conflict = await denied;
  assert.equal(conflict.status(), 409);
  assert.equal((await conflict.json()).error, "STALE_STATE");
  await expect(stale.getByRole("status")).toHaveText("STALE_STATE");
  await stale.screenshot({ path: join(evidence, "account-a-stale-conflict.png") });
  await a.page.reload();
  await expect(field).toHaveValue("ru-RU");
  await a.page.screenshot({ path: join(evidence, "account-a-reloaded.png") });
  await b.page.reload();
  await expect(b.page.getByLabel("Preferred locale (BCP 47)")).toHaveValue("en");
  await b.page.screenshot({ path: join(evidence, "account-b-isolated.png") });
  const guest = await browser.newContext({ serviceWorkers: "block" });
  const guestPage = await guest.newPage();
  await guest.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
  await guestPage.goto(origin + "/settings");
  await expect(guestPage).toHaveURL(/\/signin(?:\?|$)/);
  const result = {
    twoDistinctSubjectsAndJazzActors: true, nativeSettingsNavigation: true,
    accountALocale: "ru-RU", accountBLocale: "en", staleStatus: 409,
    staleCode: "STALE_STATE", reloaded: true, guestDenied: true,
  };
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2) + "\n");
  console.log("NATIVE_ACCOUNT_PROFILE_PROOF_PASS", JSON.stringify(result), "evidence:", evidence);
} finally {
  await browser?.close();
  for (const job of jobs.reverse()) {
    if (job.child.exitCode === null && job.child.signalCode === null) {
      try { process.kill(-job.child.pid, "SIGTERM"); } catch { /* already exited */ }
      await Promise.race([job.done, new Promise(done => setTimeout(done, 3000))]);
      if (job.child.exitCode === null && job.child.signalCode === null) {
        try { process.kill(-job.child.pid, "SIGKILL"); } catch { /* already exited */ }
        await job.done;
      }
    }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
