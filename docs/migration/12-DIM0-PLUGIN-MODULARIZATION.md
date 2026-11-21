# Dim0 plugin packaging · isolated sprint handoff

Date: 21 November 2026 (packaging-safety update: 22 November 2026)
Source: architectural specification `Dim0-plugin-architecture(1).md`
Reference design: `teableio/teable-mcp@5446050`
Branch: `sprint/dim0-plugin-modular-20261121`, based on `5d899993`

## Delivered

This branch **does not change the Jazz backend, the browser, OAuth issuer or
live presentation data**. It changes only source/plugin packaging and tests.

| Path | Responsibility |
|---|---|
| `plugins/dim0/.codex-plugin/plugin.json` | Authoritative `dim0-jazz` name/version/listing, examples and OpenAI review/publication metadata |
| `plugins/dim0/.mcp.json` | One source HTTP MCP descriptor (intentionally unresolvable until stable hostname is approved) |
| `plugins/dim0/README.md` | Per-account OAuth, real invite redemption, tool list and installation guidance |
| `plugins/dim0/skills/dim0-board/SKILL.md` | Version-checked card edits, applets, identity proof and conflict handling |
| `plugins/dim0/assets/` | Original Dim0 MIT-licensed icon and logo copied from this repository |
| `.agents/plugins/marketplace.json` | Local Codex marketplace registration; `NOT_AVAILABLE` until a permanent source endpoint is configured |
| `scripts/package-dim0-openai.mjs` | Source-to-portable transformation, validation, staged ZIP, atomic promotion |
| `integrations/dim0-mcp-plugin/scripts/build.mjs` | Backwards-compatible wrapper using the **same** canonical packaging code |
| `scripts/test-package-dim0-openai.mjs` | Packaging, ownership, release-gate and rollback tests |
| `scripts/test-dim0-plugin-oauth-discovery.mjs` | Live, read-only OAuth challenge/metadata/DCR/PKCE verification |
| `.github/workflows/dim0-plugin-package.yml` | Self-contained packaging CI for branch/PR updates |

## Portable format

The ZIP root contains `plugin.json`, `mcp.json`, `README.md`,
`assets/icon.png`, `assets/logo.png` and
`skills/dim0-board/SKILL.md` (plus necessary directory entries).
The source `.codex-plugin/plugin.json` stays **out** of the ZIP.
`extensions.com.openai.interface` contains the source listing, while
`review` and `publication` metadata are preserved.
`mcp.json` uses `streamable-http` with OAuth dynamic client registration
(`extensions.com.openai.auth.client.mode = dcr`).

No runtime server code, database, board ID, invitation or access token is
included. The private ZIP's endpoint is **a temporary Cloudflare hostname**.
Rebuild only with a verified **permanent** HTTPS domain before long-term
distribution or public submission. The source placeholder is deliberately
`dim0.example.invalid` and cannot be installed as-is.

## Build and acceptance commands

From the worktree root:

```sh
node --test scripts/test-package-dim0-openai.mjs
cd integrations/patchboard && pnpm install --offline --frozen-lockfile && pnpm test:private:ci
cd ../..

export DIM0_MCP_URL=https://barbie-discovery-bingo-system.trycloudflare.com/patchboard-private-mcp
# Private preview only; release mode rejects the temporary tunnel:
node scripts/package-dim0-openai.mjs
node integrations/dim0-mcp-plugin/scripts/build.mjs

# Only after approving and verifying a permanent HTTPS origin:
# export DIM0_MCP_URL=https://YOUR-PERMANENT-HOST/patchboard-private-mcp
# export DIM0_PLUGIN_APPROVED_ORIGIN=https://YOUR-PERMANENT-HOST
# DIM0_PLUGIN_RELEASE=1 node scripts/package-dim0-openai.mjs

node scripts/test-dim0-plugin-oauth-discovery.mjs
unzip -t integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip
shasum -a 256 integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip
```

The original build default is preserved: extracted files at
`integrations/dim0-mcp-plugin/dist/dim0-jazz/`, and ZIP at
`integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip`.
If `DIM0_PLUGIN_OUTPUT_DIR` is supplied, extracted files go there and the ZIP
goes in its parent. Both invocation paths build the same JSON, assets, skills,
and archive entry names. If validation or zipping fails, the previous
successful ZIP remains available. The extracted output is replaced only if
it is absent, empty, or matches the generated Dim0 layout, **or** matches the
verified legacy three-file Dim0 layout from the pre-modular packager.
Unknown or caller-owned files still cause refusal without deletion. If stage promotion fails
after the old stage is moved, it is restored before cleanup; if restoration
itself fails, the backup directory is retained with a printed recovery path.

## Verification performed

- **PASS:** new and compatibility builder ZIP entries and parsed JSON agree.
- **PASS:** 16 packaging tests, including invalid URLs, source-install
  restrictions, temporary-tunnel release rejection, approved origin matching,
  caller-owned file preservation, promotion rollback, missing icons, malformed
  skill metadata, last-good-ZIP preservation and a real **legacy three-file**
  builder-to-modular in-place upgrade. Successful rebuilds now compare ZIP
  entry names and uncompressed bytes, not timestamp-sensitive ZIP hashes.
  Failed rebuild tests still require the original ZIP bytes to remain identical.
- **PASS:** clean offline `pnpm` install and the full private OAuth/MCP
  regression suite in this isolated worktree. Includes two distinct Jazz
  actors, versioned CRUD, viewer denial, reauthorization/restart, scopes.
- **PASS:** live HTTPS MCP returns an RFC 9728 `401` bearer challenge,
  discovers the matching resource and authorization issuer path, offers
  dynamic client registration and PKCE S256.
- **PASS (22 November 2026):** rebuilt private ZIP at
  `integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip`;
  SHA-256: `1f8d13f88d8dc614c2d4612c21614ebca0871d6445854803047e48a15a5106ef`.
  This remains a **private** temporary-Cloudflare endpoint build, not a release.
- **PRESERVED:** the prior c6348aa3 ZIP was copied to
  `integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin-c6348aa3-preserved.zip`;
  original SHA-256: `888fcef8cc8fb8411fd691bb3e47f1baae986973e44d6a57286d3e2849c8c61c`.
  ZIP timestamps can change between rebuilds; always verify the hash of the
  particular file being installed.
- **PASS (22 November 2026):** 14/14 packaging regressions, a fresh
  `pnpm test:private:ci` OAuth/MCP suite including distinct Jazz writers and
  persistence after restart, plus live public OAuth/DCR/PKCE discovery.
- **NOT DONE:** a genuine clean ChatGPT ZIP installation and independent
  friend's authorization/update remain manual acceptance checks.
- **NOT TESTED:** installing the ZIP into a **fresh ChatGPT account** through
  the plugin install UI. A direct MCP connection is not equivalent.
- **NOT TESTED:** an actual friend connecting **their own ChatGPT and Dim0
  accounts** and renaming a card. Two automated passkeys/Jazz actors are
  useful regressions but not this human acceptance criterion.
- **PENDING:** owned permanent HTTPS origin, real publisher/legal policy
  URLs, public plugin submission. Source marketplace installation is explicitly
  `NOT_AVAILABLE` while the checked-in descriptor is `.invalid`.
- **RELEASE GATE:** `DIM0_PLUGIN_RELEASE=1` rejects `*.trycloudflare.com`,
  `*.loca.lt` and `*.ngrok-free.app` origins even when named as approved,
  and requires a matching bare HTTPS `DIM0_PLUGIN_APPROVED_ORIGIN`. This
  variable does not itself verify domain ownership or reachability.

## Real-account acceptance script

Use a **new QA board**, never the evening presentation board for destructive
testing. Alice and Ben must use different ChatGPT accounts *and independent
Dim0 browser profiles* with distinct passkeys:

1. Both install/connect the same plugin and independently approve the same
   QA board, with Ben as editor. Compare `list_boards` on both connections.
2. Alice creates a visible card via `create_canvas_entity`, records board ID,
   entity UUID, version and its `updatedBy` Jazz actor.
3. Ben calls `get_canvas_entity`, changes the label only, uses
   `update_canvas_entity` with the exact `expected_version`.
4. Alice reloads and reads it again. Verify **same entity UUID**, **higher
   version**, and a **different `updatedBy` matching Ben's Jazz actor**.
5. Reconnect Ben and verify the board grant persists. Separately test a
   viewer grant cannot edit.
6. Never infer Ben's actor from a chat nickname: OAuth consent may have been
   approved in a browser that was still signed in as Alice.

Record date, account identities (without private tokens), board ID, entity ID,
versions, Jazz actor IDs, viewer denial and pass/fail in the QA log.

## Rollback and release

No server migration or restart is needed. Keep the last ZIP and revert
to the existing manually configured MCP URL if necessary. The deployed
Cloudflare origin, private auth, and public presentation board are untouched.

OpenAI docs:
https://developers.openai.com/plugins/build/plugins
https://developers.openai.com/plugins/deploy/connect-chatgpt

Note: the base Agent Plugins `mcp.schema.json` currently omits the
`extensions` property from its HTTP-server schema, while OpenAI's
plugin documentation *explicitly* prescribes
`mcpServers.dim0.extensions["com.openai"].auth` for OAuth. This package
uses the documented OpenAI extension and validates that shape separately.
A real ChatGPT installation is still the final format-acceptance gate.

## 22 November 2026 — PR #2 compatibility correction

The packaging branch now accepts a genuine predecessor artifact containing
exactly `plugin.json`, `mcp.json`, and `README.md` after validating its
Dim0 manifest and MCP descriptor identity. Unknown files remain a hard
failure, and the original ZIP survives both validation and promotion errors.

The regression suite builds a legacy stage **using the original target-branch
packager**, injects an unowned file to assert refusal, then upgrades that same
stage in place with the modular compatibility command. An additional test
rejects a three-file lookalike with a different manifest identity.

Successful rebuilds compare ZIP entry names and the uncompressed bytes of
each entry, because ZIP timestamps can differ across otherwise identical
archives. Failed rebuilds retain the previous exact ZIP hash as a byte-level
rollback assertion.

The presentation deployment and public Jazz service were not modified by
this packaging-only change.
