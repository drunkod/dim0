/** Native owner Share role proof with real disposable Jazz membership. */
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
const root = await mkdtemp(join(tmpdir(), "dim0-native-member-role-fixture-"));
const evidence = process.env.PATCHBOARD_NATIVE_MEMBER_EVIDENCE
  ? resolve(process.env.PATCHBOARD_NATIVE_MEMBER_EVIDENCE)
  : await mkdtemp(join(tmpdir(), "dim0-native-member-role-evidence-"));
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
  const owner=await account(), member=await account();
  assert.notEqual(owner.identity.accountId,member.identity.accountId);
  const api=(page,path,data)=>page.evaluate(async({path,data})=>{
    const r=await fetch("/patchboard-private/api/"+path,data===undefined?{}:{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(data),
    });
    return {status:r.status,body:await r.json()};
  },{path,data});
  const created=await api(owner.page,"boards",{title:"Versioned membership proof"});
  assert.equal(created.status,201);
  const id=created.body.board_id;
  const invite=await api(owner.page,"invite",{board_id:id,role:"viewer",reusable:false});
  assert.equal(invite.status,201);
  const token=new URL(invite.body.invite_url).searchParams.get("invite");
  assert.equal(token.length,43);
  await member.page.goto(origin+"/jazz-invite/"+id+"#invite="+encodeURIComponent(token));
  await member.page.getByRole("button",{name:"Accept invitation",exact:true}).click();
  await expect(member.page).toHaveURL(url=>url.pathname==="/boards/"+id);
  const read=async()=>{
    const r=await api(owner.page,"members?board_id="+id);
    assert.equal(r.status,200);
    assert.equal(r.body.members.length,2);
    const row=r.body.members.find(m=>m.id===member.identity.accountId);
    assert.ok(row);
    return {role:row.role,version:row.role_version};
  };
  assert.deepEqual(await read(),{role:"viewer",version:1});
  const open=async()=>{
    await owner.page.getByRole("button",{name:"Share this board",exact:true}).click();
    return owner.page.getByRole("dialog").getByRole("combobox",{name:/Role of /});
  };
  await owner.page.goto(origin+"/boards/"+id);
  let select=await open();
  await expect(select).toHaveValue("viewer");
  await owner.page.screenshot({path:join(evidence,"before-role.png")});
  const saved=owner.page.waitForResponse(r=>new URL(r.url()).pathname==="/patchboard-private/api/members/role");
  await select.selectOption("member");
  const result=await saved;
  assert.equal(result.status(),200);
  const commit=await result.json();
  assert.equal(commit.role_version,2);
  assert.equal(commit.assigned_role,"editor");
  const request=result.request().postDataJSON();
  await expect(select).toHaveValue("member");
  assert.deepEqual(await read(),{role:"editor",version:2});
  const retry=await api(owner.page,"members/role",request);
  assert.equal(retry.status,200);
  assert.deepEqual(retry.body,commit);
  const forbidden=await api(member.page,"members/role",{...request,expected_version:2,role:"viewer",request_id:"nonowner-proof"});
  assert.equal(forbidden.status,403);
  assert.deepEqual(await read(),{role:"editor",version:2});
  await owner.page.reload();
  select=await open();
  await expect(select).toHaveValue("member");
  await owner.page.screenshot({path:join(evidence,"editor-after-reload.png")});
  const downgraded=owner.page.waitForResponse(r=>new URL(r.url()).pathname==="/patchboard-private/api/members/role");
  owner.page.once("dialog",dialog=>dialog.accept());
  await select.selectOption("viewer");
  const downgrade=await downgraded;
  assert.equal(downgrade.status(),200);
  assert.equal((await downgrade.json()).role_version,3);
  await expect(select).toHaveValue("viewer");
  assert.deepEqual(await read(),{role:"viewer",version:3});
  await owner.page.reload();
  select=await open();
  await expect(select).toHaveValue("viewer");
  await owner.page.screenshot({path:join(evidence,"viewer-after-reload.png")});
  const evidenceResult={browser:browser.version(),nativeShare:true,initial:{role:"viewer",version:1},promoted:{role:"editor",version:2},identicalRetry:true,unauthorizedStatus:403,downgraded:{role:"viewer",version:3},reloadBothRoles:true};
  await writeFile(join(evidence,"result.json"),JSON.stringify(evidenceResult,null,2)+"\n");
  console.log("NATIVE_MEMBER_ROLE_PROOF_PASS",JSON.stringify(evidenceResult));
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
