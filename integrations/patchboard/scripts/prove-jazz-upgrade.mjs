import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// Execute the identical worker against two real dependency installations.
// No production store can be supplied: the runner owns every fixture path.
const baseline = process.argv[2];
if (!baseline) throw new Error("Usage: node scripts/prove-jazz-upgrade.mjs /path/to/alpha.69/integrations/patchboard");
const candidate = resolve(import.meta.dirname, "..");
const worker = readFileSync(new URL("./jazz-upgrade-fixture.mjs", import.meta.url), "utf8");
const root = mkdtempSync(join(tmpdir(), "dim0-jazz-version-proof-"));
const live = join(root, "fixture");
const backup = join(root, "backup");
const restored = join(root, "restored");
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
  !/^(PATCHBOARD_|DIM0_|BETTER_AUTH_|VITE_|JAZZ_|DATABASE_URL$|APP_PORT$|PORT$)/.test(key)
));

function run(workspace, version, phase, path) {
  const result = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module"], {
    cwd: resolve(workspace, "apps/server"),
    env: { ...env, PROOF_VERSION: version, PROOF_PHASE: phase, PROOF_ROOT: path },
    input: worker,
    stdio: ["pipe", "inherit", "inherit"],
    timeout: 120000,
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${version} ${phase}`);
}

try {
  run(baseline, "2.0.0-alpha.69", "seed", live);
  // Both stores and the secret are closed before copying. This fixture has
  // no remote peer or external chunk storage, and is never served publicly.
  cpSync(live, backup, { recursive: true });
  run(candidate, "2.0.0-beta.5", "verify", live);
  run(candidate, "2.0.0-beta.5", "write", live);
  run(candidate, "2.0.0-beta.5", "verify", live);
  cpSync(backup, restored, { recursive: true });
  run(baseline, "2.0.0-alpha.69", "verify", restored);
  console.log("JAZZ_VERSION_UPGRADE_AND_RESTORE_PASS");
} finally {
  rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}
