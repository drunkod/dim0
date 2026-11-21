#!/usr/bin/env node
/**
 * Package the Dim0 OAuth MCP plugin after a separate, secure Tailscale Funnel
 * endpoint is configured. No runtime secrets or private hostnames are committed.
 */
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = resolve(scriptDir, "..");
const endpoint = process.env.DIM0_MCP_URL;
if (!endpoint) throw new Error("Set DIM0_MCP_URL to your HTTPS Tailscale Funnel MCP URL");
const url = new URL(endpoint);
if (url.protocol !== "https:" || url.username || url.password ||
    url.hash || url.search || url.pathname !== "/patchboard-private-mcp") {
  throw new Error("DIM0_MCP_URL must be HTTPS ending in /patchboard-private-mcp, without credentials or query");
}
const outDir = process.env.DIM0_PLUGIN_OUTPUT_DIR || resolve(root, "dist", "dim0-jazz");
const manifest = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json",
  name: "dim0-jazz",
  version: "0.1.0",
  description: "Edit collaborative Dim0 boards through Jazz and board-scoped OAuth MCP.",
  author: { name: "Patchboard + Dim0 migration" },
  homepage: "https://github.com/drunkod/dim0",
  repository: "https://github.com/drunkod/dim0",
  license: "MIT",
  keywords: ["collaborative-board", "jazz", "mcp", "canvas"],
  extensions: {
    "com.openai": {
      interface: {
        displayName: "Dim0 Jazz Board",
        shortDescription: "Read and edit your collaborative canvas",
        longDescription: "Read and edit nodes, links, applets and documents in a single OAuth-authorized Dim0 board using Jazz as the canonical store.",
        developerName: "Patchboard",
        category: "Productivity",
        capabilities: ["Read board entities", "Create or edit nodes and links", "Edit applet JSX", "Delete authorized entities"],
        websiteURL: "https://github.com/drunkod/dim0",
        defaultPrompt: [
          "Read the nodes on my connected board.",
          "Create an applet on my board.",
          "Update this board node after checking its revision.",
        ],
      },
    },
  },
};
const server = {
  $schema: "https://agent-plugins.org/schemas/1.0.0/mcp.schema.json",
  mcpServers: {
    dim0: {
      type: "streamable-http",
      url: url.toString(),
      extensions: { "com.openai": { auth: { type: "oauth", client: { mode: "dcr" } } } },
    },
  },
};
await mkdir(outDir, { recursive: true });
await writeFile(resolve(outDir, "plugin.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(resolve(outDir, "mcp.json"), JSON.stringify(server, null, 2) + "\n");
const readme = await readFile(resolve(root, "README.md"), "utf8");
await writeFile(resolve(outDir, "README.md"), readme);
const zipFile = resolve(outDir, "..", "dim0-jazz-mcp-plugin.zip");
await rm(zipFile, { force: true });
execFileSync("zip", ["-q", zipFile, "plugin.json", "mcp.json", "README.md"], { cwd: outDir });
console.log("DIM0_MCP_PLUGIN_PACKAGED", zipFile);
