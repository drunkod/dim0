#!/usr/bin/env node
/** Integration tests for canonical and backwards-compatible Dim0 ZIP builds. */
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cp, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test, after } from "node:test";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const source = join(root, "plugins/dim0");
const canonical = join(root, "scripts/package-dim0-openai.mjs");
const compat = join(root, "integrations/dim0-mcp-plugin/scripts/build.mjs");
const qa = await mkdtemp("/tmp/dim0-plugin-package-test-");
after(async () => rm(qa, { recursive: true, force: true }));
const fixtureUrl = "https://qa.example.invalid/patchboard-private-mcp";
const validEnv = { DIM0_MCP_URL: fixtureUrl };

/** Build with isolated output and return stderr/stdout for failure assertions. */
function build(script, stageDir, extra = {}) {
  return spawnSync(process.execPath, [script], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, DIM0_PLUGIN_OUTPUT_DIR: stageDir, ...validEnv, ...extra },
  });
}
function archive(stageDir) {
  return join(resolve(stageDir, ".."), "dim0-jazz-mcp-plugin.zip");
}
function unzipText(file, name) {
  return execFileSync("unzip", ["-p", file, name], { encoding: "utf8" });
}
function entries(file) {
  return execFileSync("unzip", ["-Z1", file], { encoding: "utf8" })
    .split("\n").filter(Boolean).sort();
}
function sha(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}
async function fixtureSource(label) {
  const dest = join(qa, "source-" + label);
  await cp(source, dest, { recursive: true });
  return dest;
}

let canonicalZip;
let oldZip;

test("canonical build preserves names, portable OAuth and Teable-style assets/skills", async () => {
  const stage = join(qa, "canonical", "stage");
  const result = build(canonical, stage);
  assert.equal(result.status, 0, result.stderr);
  canonicalZip = archive(stage);
  execFileSync("unzip", ["-tqq", canonicalZip]);
  const names = entries(canonicalZip);
  assert.deepEqual(names, [
    "README.md", "assets/", "assets/icon.png", "assets/logo.png",
    "mcp.json", "plugin.json", "skills/", "skills/dim0-board/",
    "skills/dim0-board/SKILL.md",
  ].sort());
  const meta = JSON.parse(unzipText(canonicalZip, "plugin.json"));
  const mcp = JSON.parse(unzipText(canonicalZip, "mcp.json"));
  const orig = JSON.parse(await readFile(join(source, ".codex-plugin/plugin.json"), "utf8"));
  assert.equal(meta.name, "dim0-jazz");
  assert.equal(meta.version, orig.version);
  assert.equal(meta.$schema, "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json");
  assert.equal(meta.skills, undefined);
  assert.equal(meta.mcpServers, undefined);
  assert.equal(meta.interface, undefined);
  assert.deepEqual(meta.extensions["com.openai"].interface, orig.interface);
  assert.deepEqual(meta.extensions["com.openai"].review, orig.extensions["com.openai"].review);
  assert.deepEqual(meta.extensions["com.openai"].publication, orig.extensions["com.openai"].publication);
  assert.deepEqual(Object.keys(mcp.mcpServers), ["dim0"]);
  assert.equal(mcp.mcpServers.dim0.type, "streamable-http");
  assert.equal(mcp.mcpServers.dim0.url, fixtureUrl);
  assert.deepEqual(mcp.mcpServers.dim0.extensions["com.openai"].auth,
    { type: "oauth", client: { mode: "dcr" } });
  assert.match(unzipText(canonicalZip, "skills/dim0-board/SKILL.md"),
    /^---\nname: dim0-board\ndescription: /);
  for (const name of ["assets/icon.png", "assets/logo.png"]) {
    const content = execFileSync("unzip", ["-p", canonicalZip, name]);
    assert.deepEqual(content.subarray(0, 8), Buffer.from([137,80,78,71,13,10,26,10]));
  }
  assert.deepEqual((await readdir(stage)).sort(),
    ["README.md", "assets", "mcp.json", "plugin.json", "skills"].sort());
  assert.ok(!names.some(n => /\.(env|db|sqlite)|(^|\/)server\//.test(n)));
});

test("legacy build command produces equivalent JSON and entry names", () => {
  const stage = join(qa, "legacy", "stage");
  const result = build(compat, stage);
  assert.equal(result.status, 0, result.stderr);
  oldZip = archive(stage);
  assert.deepEqual(entries(oldZip), entries(canonicalZip));
  for (const name of ["plugin.json", "mcp.json", "README.md", "skills/dim0-board/SKILL.md"]) {
    assert.equal(unzipText(oldZip, name), unzipText(canonicalZip, name));
  }
});

test("rejects absent endpoint when the checked-in source uses a placeholder", () => {
  const stage = join(qa, "none", "stage");
  const result = build(canonical, stage, { DIM0_MCP_URL: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /placeholder; set DIM0_MCP_URL/);
});

test("rejects invalid URL path, URL credentials, non-HTTPS and query/fragment", () => {
  const urls = [
    "http://qa.example.invalid/patchboard-private-mcp",
    "https://qa.example.invalid/not-the-mcp",
    "https://qa.example.invalid/patchboard-private-mcp/",
    "https://someone:password@qa.example.invalid/patchboard-private-mcp",
    "https://qa.example.invalid/patchboard-private-mcp?token=bad",
    "https://qa.example.invalid/patchboard-private-mcp#fragment",
  ];
  for (let i = 0; i < urls.length; i++) {
    const result = build(canonical, join(qa, "bad-url-" + i, "stage"),
      { DIM0_MCP_URL: urls[i] });
    assert.notEqual(result.status, 0, "Must reject " + urls[i]);
    assert.match(result.stderr, /HTTPS \/patchboard-private-mcp/);
  }
});

test("release mode refuses placeholder or localhost despite valid HTTPS", () => {
  for (const endpoint of [
    fixtureUrl, "https://localhost/patchboard-private-mcp",
    "https://example.com/patchboard-private-mcp",
  ]) {
    const result = build(canonical, join(qa, "release-" + endpoint.length, "stage"), {
      DIM0_MCP_URL: endpoint, DIM0_PLUGIN_RELEASE: "1",
    });
    assert.notEqual(result.status, 0, endpoint);
    assert.match(result.stderr, /Release plugin cannot use/);
  }
});

test("bad image, skill header and source endpoint never replace a prior good ZIP", async () => {
  const stage = join(qa, "resilience", "stage");
  const initial = build(canonical, stage);
  assert.equal(initial.status, 0, initial.stderr);
  const zip = archive(stage);
  const referenceHash = sha(await readFile(zip));
  const referenceStage = await readFile(join(stage, "plugin.json"), "utf8");

  const imageSource = await fixtureSource("image");
  const manifestFile = join(imageSource, ".codex-plugin/plugin.json");
  const broken = JSON.parse(await readFile(manifestFile, "utf8"));
  broken.interface.composerIcon = "./assets/not-here.png";
  await writeFile(manifestFile, JSON.stringify(broken));
  let fail = build(canonical, stage, {
    DIM0_PLUGIN_SOURCE_DIR: imageSource, DIM0_PLUGIN_TEST_MODE: "1",
  });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /not-here\.png|ENOENT/);
  assert.equal(sha(await readFile(zip)), referenceHash);

  const skillSource = await fixtureSource("skill");
  const skill = join(skillSource, "skills/dim0-board/SKILL.md");
  await writeFile(skill, "## No YAML frontmatter\n");
  fail = build(canonical, stage, {
    DIM0_PLUGIN_SOURCE_DIR: skillSource, DIM0_PLUGIN_TEST_MODE: "1",
  });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /Invalid skill frontmatter/);
  assert.equal(sha(await readFile(zip)), referenceHash);

  const mcpSource = await fixtureSource("endpoint");
  const mcpFile = join(mcpSource, ".mcp.json");
  const descriptor = JSON.parse(await readFile(mcpFile, "utf8"));
  descriptor.mcpServers.dim0.url = "https://qa.example.invalid/wrong";
  await writeFile(mcpFile, JSON.stringify(descriptor));
  fail = build(canonical, stage, {
    DIM0_PLUGIN_SOURCE_DIR: mcpSource, DIM0_PLUGIN_TEST_MODE: "1",
  });
  assert.notEqual(fail.status, 0);
  assert.match(fail.stderr, /HTTPS \/patchboard-private-mcp/);
  assert.equal(sha(await readFile(zip)), referenceHash);
  assert.equal(await readFile(join(stage, "plugin.json"), "utf8"), referenceStage);
});

test("production override passes release validation without changing canonical source", () => {
  const stage = join(qa, "release-good", "stage");
  const endpoint = "https://barbie-discovery-bingo-system.trycloudflare.com/patchboard-private-mcp";
  // This is a syntax-only package test; a live/discoverable endpoint is verified separately.
  const result = build(canonical, stage, {
    DIM0_MCP_URL: endpoint, DIM0_PLUGIN_RELEASE: "1",
  });
  assert.equal(result.status, 0, result.stderr);
  const mcp = JSON.parse(unzipText(archive(stage), "mcp.json"));
  assert.equal(mcp.mcpServers.dim0.url, endpoint);
});
