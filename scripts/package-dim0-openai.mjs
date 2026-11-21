#!/usr/bin/env node
/**
 * Convert the canonical Codex source plugin into a portable ChatGPT ZIP.
 * No server source or credentials are ever copied into this package.
 * Build completely in an isolated directory; promote only a verified ZIP.
 */
import { execFileSync } from "node:child_process";
import {
  copyFile, lstat, mkdir, mkdtemp, readFile, readdir, rename,
  rm, writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultSource = join(repo, "plugins", "dim0");
const legacyStage = join(repo, "integrations", "dim0-mcp-plugin", "dist", "dim0-jazz");
const outDir = resolve(process.env.DIM0_PLUGIN_OUTPUT_DIR || legacyStage);
const archive = join(dirname(outDir), "dim0-jazz-mcp-plugin.zip");

const sourceOverride = process.env.DIM0_PLUGIN_SOURCE_DIR;
if (sourceOverride && process.env.DIM0_PLUGIN_TEST_MODE !== "1") {
  throw new Error("DIM0_PLUGIN_SOURCE_DIR is reserved for isolated package tests");
}
const source = resolve(sourceOverride || defaultSource);
const isRelease = process.env.DIM0_PLUGIN_RELEASE === "1";

/** Parse the only accepted remote MCP endpoint. Never allow URL credentials. */
function validateEndpoint(raw, { release = isRelease, warnFixture = true } = {}) {
  if (typeof raw !== "string" || !raw || raw !== raw.trim()) {
    throw new Error("Dim0 MCP endpoint must be a complete HTTPS URL");
  }
  let url;
  try { url = new URL(raw); }
  catch { throw new Error("Dim0 MCP endpoint is not a valid URL"); }
  if (url.protocol !== "https:" || url.username || url.password ||
      url.hash || url.search || url.pathname !== "/patchboard-private-mcp") {
    throw new Error(
      "Dim0 MCP endpoint must be HTTPS /patchboard-private-mcp, without credentials, query or fragment",
    );
  }
  const h = url.hostname.toLowerCase();
  const fixture = h === "localhost" || h === "127.0.0.1" || h === "[::1]" ||
    /\.(invalid|test|example|localhost|local)$/.test(h) ||
    ["example.com", "example.org", "example.net"].includes(h);
  if (fixture && release) {
    throw new Error("Release plugin cannot use a fixture, localhost or example host");
  }
  // Private previews can use temporary tunnels; public releases cannot.
  const ephemeral = h === "trycloudflare.com" || h.endsWith(".trycloudflare.com") ||
    h === "loca.lt" || h.endsWith(".loca.lt") ||
    h.endsWith(".ngrok-free.app");
  if (release && ephemeral) {
    throw new Error("Release plugin cannot use a temporary tunnel origin");
  }
  if (release) {
    const approved = process.env.DIM0_PLUGIN_APPROVED_ORIGIN;
    let approvedUrl;
    try { approvedUrl = new URL(approved); }
    catch { throw new Error("Release plugin requires DIM0_PLUGIN_APPROVED_ORIGIN (permanent HTTPS origin)"); }
    if (approvedUrl.protocol !== "https:" || approved !== approvedUrl.origin ||
        approvedUrl.username || approvedUrl.password || approvedUrl.hash || approvedUrl.search) {
      throw new Error("DIM0_PLUGIN_APPROVED_ORIGIN must be a bare HTTPS origin");
    }
    if (approvedUrl.origin !== url.origin) {
      throw new Error("Release endpoint does not match DIM0_PLUGIN_APPROVED_ORIGIN");
    }
  }
  if (fixture && warnFixture) console.warn("DIM0_PLUGIN_QA_ENDPOINT_ONLY", url.origin);
  if (ephemeral && warnFixture) console.warn("DIM0_PLUGIN_PRIVATE_TUNNEL_ONLY", url.origin);
  return url;
}

/** Parse one JSON file without executing it. */
async function json(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

/** Reject symbolic links, special files and hidden metadata in the archive. */
async function copyTree(from, to) {
  const stat = await lstat(from);
  if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
    throw new Error("Unsupported plugin source item: " + from);
  }
  if (stat.isFile()) {
    await copyFile(from, to);
    return;
  }
  await mkdir(to, { recursive: true });
  for (const entry of await readdir(from)) {
    if (entry === ".DS_Store") continue;
    if (entry.startsWith(".")) throw new Error("Unexpected hidden plugin file: " + entry);
    await copyTree(join(from, entry), join(to, entry));
  }
}

/** Accept only relative asset paths inside this plugin's owned assets. */
async function verifyAsset(stage, ref, key) {
  if (typeof ref !== "string" || !/^\.\/assets\/[a-zA-Z0-9_-]+\.png$/.test(ref)) {
    throw new Error(key + " must point to ./assets/<owned-png>.png");
  }
  const path = resolve(stage, ref);
  if (!relative(stage, path) || relative(stage, path).startsWith(".." + sep)) {
    throw new Error(key + " path escapes the staged plugin");
  }
  const stat = await lstat(path);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(key + " is not a regular PNG file");
  const bytes = await readFile(path);
  if (!bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    throw new Error(key + " must be a valid PNG");
  }
}

/** Validate all skills before the archive is promoted. */
async function verifySkills(stage) {
  const directory = join(stage, "skills");
  const entries = await readdir(directory, { withFileTypes: true });
  if (!entries.length) throw new Error("At least one Dim0 skill is required");
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) {
      throw new Error("skills must contain directories only");
    }
    const skill = join(directory, entry.name, "SKILL.md");
    const markdown = await readFile(skill, "utf8");
    const header = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const name = header?.[1].match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
    const description = header?.[1].match(/^description:\s*([^\r\n]+)$/m)?.[1]?.trim();
    if (!name || name !== entry.name || !description) {
      throw new Error("Invalid skill frontmatter: " + entry.name + "/SKILL.md");
    }
  }
}

/**
 * Only replace our own previous extracted plugin. Unrecognized files at any
 * depth could belong to the caller: refuse rather than deleting them.
 * Legacy (pre-marker) stages are recognized by their exact portable layout.
 */
async function assertReplaceableOutput(target) {
  let stat;
  try { stat = await lstat(target); }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Refusing to replace non-directory or symlink output: " + target);
  }
  const entries = await readdir(target);
  if (!entries.length) return true;
  async function check(directory, expectedFiles, expectedDirectories = []) {
    const expected = [...expectedFiles, ...expectedDirectories].sort();
    const actual = (await readdir(directory)).sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error("Refusing to replace unowned plugin output files in " + directory);
    }
    for (const name of expectedFiles) {
      const item = await lstat(join(directory, name));
      if (!item.isFile() || item.isSymbolicLink()) {
        throw new Error("Refusing to replace unexpected plugin output file: " + name);
      }
    }
    for (const name of expectedDirectories) {
      const item = await lstat(join(directory, name));
      if (!item.isDirectory() || item.isSymbolicLink()) {
        throw new Error("Refusing to replace unexpected plugin output directory: " + name);
      }
    }
  }
  await check(target, ["plugin.json", "mcp.json", "README.md"], ["assets", "skills"]);
  await check(join(target, "assets"), ["icon.png", "logo.png"]);
  await check(join(target, "skills"), [], ["dim0-board"]);
  await check(join(target, "skills", "dim0-board"), ["SKILL.md"]);
  const manifest = await json(join(target, "plugin.json"));
  const mcp = await json(join(target, "mcp.json"));
  if (manifest.name !== "dim0-jazz" ||
      manifest.$schema !== "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json" ||
      Object.keys(mcp.mcpServers ?? {}).join(",") !== "dim0" ||
      mcp.mcpServers.dim0.type !== "streamable-http") {
    throw new Error("Refusing to replace output without verified Dim0 package identity");
  }
  return true;
}

/** Build in the ZIP's filesystem so rename is atomic; retain old ZIP on failure. */
async function main() {
  const canonical = await json(join(source, ".codex-plugin", "plugin.json"));
  const sourceMcp = await json(join(source, ".mcp.json"));
  if (canonical.name !== "dim0-jazz" || !/^\d+\.\d+\.\d+$/.test(canonical.version)) {
    throw new Error("Plugin name/version is missing or incompatible");
  }
  if (canonical.mcpServers !== "./.mcp.json" || canonical.skills !== "./skills") {
    throw new Error("Source manifest must reference .mcp.json and ./skills");
  }
  if (!canonical.interface || !canonical.interface.displayName ||
      !canonical.interface.longDescription || !canonical.interface.defaultPrompt) {
    throw new Error("Source manifest is missing a complete interface listing");
  }
  if (Object.keys(sourceMcp.mcpServers ?? {}).join(",") !== "dim0" ||
      sourceMcp.mcpServers.dim0.type !== "http") {
    throw new Error("Source descriptor must define one HTTP MCP server named dim0");
  }
  if (!process.env.DIM0_MCP_URL &&
      sourceMcp.mcpServers.dim0.url.endsWith(".invalid/patchboard-private-mcp")) {
    throw new Error("Source MCP URL is a placeholder; set DIM0_MCP_URL");
  }
  // Validate the source too, even when a build override is supplied.
  validateEndpoint(sourceMcp.mcpServers.dim0.url, { release: false, warnFixture: false });
  const endpoint = validateEndpoint(process.env.DIM0_MCP_URL || sourceMcp.mcpServers.dim0.url);
  const { mcpServers: _sourceMcp, skills: _sourceSkills,
    interface: listing, extensions = {}, ...metadata } = canonical;
  const { "com.openai": openai = {}, ...otherExtensions } = extensions;

  const manifest = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
    ...metadata,
    extensions: {
      ...otherExtensions,
      "com.openai": { interface: listing, ...openai },
    },
  };
  const mcp = {
    $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
    mcpServers: {
      dim0: {
        type: "streamable-http",
        url: endpoint.href,
        extensions: {
          "com.openai": { auth: { type: "oauth", client: { mode: "dcr" } } },
        },
      },
    },
  };

  const parent = dirname(outDir);
  await mkdir(parent, { recursive: true });
  const tempRoot = await mkdtemp(join(parent, ".dim0-plugin-"));
  const stage = join(tempRoot, "stage");
  const candidateZip = join(tempRoot, "dim0-jazz-mcp-plugin.zip");
  const priorStage = join(tempRoot, "previous-stage");
  let movedPrevious = false;
  let promotedStage = false;
  try {
    await mkdir(stage);
    await copyTree(join(source, "assets"), join(stage, "assets"));
    await copyTree(join(source, "skills"), join(stage, "skills"));
    await copyFile(join(source, "README.md"), join(stage, "README.md"));
    await writeFile(join(stage, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
    await writeFile(join(stage, "mcp.json"), JSON.stringify(mcp, null, 2) + "\n");

    for (const field of ["composerIcon", "logo", "composerIconDark", "logoDark"]) {
      if (listing[field]) await verifyAsset(stage, listing[field], field);
    }
    if (!listing.composerIcon || !listing.logo) throw new Error("Owned icons are required");
    await verifySkills(stage);
    execFileSync("zip", [
      "-q", "-r", candidateZip, "plugin.json", "mcp.json", "README.md", "assets", "skills",
    ], { cwd: stage });
    execFileSync("unzip", ["-tqq", candidateZip]);

    // Validate before moving the old stage. Refuse directories with any
    // caller-owned or unrecognized content, including nested files.
    const hasPrevious = await assertReplaceableOutput(outDir);
    try {
      if (hasPrevious) {
        await rename(outDir, priorStage);
        movedPrevious = true;
      }
      // Test-only injection exercises failure AFTER moving the old stage.
      if (process.env.DIM0_PLUGIN_TEST_MODE === "1" &&
          process.env.DIM0_PLUGIN_TEST_FAIL_PROMOTE === "1") {
        throw new Error("Injected stage promotion failure");
      }
      await rename(stage, outDir);
      promotedStage = true;
      if (process.env.DIM0_PLUGIN_TEST_MODE === "1" &&
          process.env.DIM0_PLUGIN_TEST_FAIL_ZIP_PROMOTE === "1") {
        throw new Error("Injected ZIP promotion failure");
      }
      // Atomic on the same filesystem: the prior ZIP stays until this point.
      await rename(candidateZip, archive);
      // Promotion committed. The previous generated stage is disposable now.
      movedPrevious = false;
    } catch (error) {
      try {
        if (promotedStage) await rm(outDir, { recursive: true, force: true });
        if (movedPrevious) {
          await rename(priorStage, outDir);
          movedPrevious = false;
        }
      } catch (rollbackError) {
        // Keep priorStage for manual recovery if restoration itself fails.
        throw new AggregateError([error, rollbackError],
          "Plugin output rollback failed; backup retained at " + priorStage);
      }
      throw error;
    }
    console.log("DIM0_MCP_PLUGIN_PACKAGED", archive);
  } finally {
    if (movedPrevious) {
      console.error("DIM0_PLUGIN_PREVIOUS_STAGE_RETAINED", priorStage);
    } else {
      // Never delete a backup if rollback itself failed.
      await rm(tempRoot, { recursive: true, force: true });
    }
  }
}
await main();
