import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const root = await mkdtemp(join(tmpdir(), "patchboard-private-ci-"));
const freePort = async () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    const port = address.port;
    server.close(() => resolvePort(port));
  });
});
const port = await freePort();
const origin = "http://localhost:" + port;
const env = {
  ...process.env,
  PATCHBOARD_PRIVATE_ROOT: root,
  PATCHBOARD_PRIVATE_ORIGIN: origin,
  PATCHBOARD_PRIVATE_DEV: "1",
  PATCHBOARD_PRIVATE_PORT: String(port),
  PATCHBOARD_PRIVATE_TEST_PID_FILE: join(root, "qa-private-server.pid"),
  PATCHBOARD_OAUTH_CI_RESTART: "1",
};
let serverProcess;
function scrub(s) {
  return s.replace(/(Bearer\s+)[\w.-]+/gi, "$1[REDACTED]")
    .replace(/(refresh_token|access_token|code_verifier|set-cookie)["=: ]+[\w.%/-]+/gi, "$1=[REDACTED]");
}
function execScript(args, { background = false } = {}) {
  const child = spawn("pnpm", args, {
    cwd: repoRoot, env, detached: background, stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.on("data", chunk => { output += String(chunk).slice(0, 20000); });
  }
  if (background) return { child, output: () => output };
  return new Promise((resolveDone, reject) => {
    child.once("error", reject);
    child.once("exit", code => code === 0
      ? resolveDone(output)
      : reject(new Error("pnpm " + args.join(" ") + " failed (exit " + code + "):\n" +
        scrub(output).slice(-6000))));
  });
}
async function waitForService(child, output) {
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("Private server exited before ready:\n" + scrub(output()));
    try {
      const [health, mcp, ui] = await Promise.all([
        fetch("http://127.0.0.1:" + port + "/health", { signal: AbortSignal.timeout(900) }),
        fetch(origin + "/patchboard-private-mcp", { signal: AbortSignal.timeout(900) }),
        fetch(origin + "/patchboard-private/", { signal: AbortSignal.timeout(900) }),
      ]);
      if (health.ok && ui.ok && mcp.status === 401 &&
        mcp.headers.get("www-authenticate")?.includes("resource_metadata")) return;
    } catch { /* Cold Jazz startup, do not interpret it as failure yet. */ }
    await new Promise(done => setTimeout(done, 250));
  }
  throw new Error("Private service did not expose UI + MCP 401:\n" + scrub(output()).slice(-6000));
}
try {
  await execScript(["auth:migrate:private"]);
  console.log("PRIVATE_CI_AUTH_MIGRATION_PASS");
  const started = execScript(["demo:private"], { background: true });
  serverProcess = started.child;
  await waitForService(serverProcess, started.output);
  console.log("PRIVATE_CI_UI_AND_UNAUTHENTICATED_MCP_PASS");
  await execScript(["test:private:enrollment"]);
  const proof = await execScript(["test:private:oauth"]);
  for (const line of scrub(proof).split("\n")) {
    if (/PASS|FAILED|Error/.test(line)) console.log(line.slice(0, 550));
  }
  console.log("PRIVATE_CI_ACCEPTANCE_PASS");
} finally {
  if (serverProcess && serverProcess.exitCode === null) {
    try { process.kill(-serverProcess.pid, "SIGTERM"); } catch { /* already stopped */ }
    await Promise.race([
      new Promise(done => serverProcess.once("exit", done)),
      new Promise(done => setTimeout(done, 2000)),
    ]);
    if (serverProcess.exitCode === null) {
      try { process.kill(-serverProcess.pid, "SIGKILL"); } catch { /* already stopped */ }
    }
  }
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
