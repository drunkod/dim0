# Dim0 Jazz Board plugin

Connect ChatGPT (or a compatible MCP client) to a **specific board you approve**
in [Dim0](https://github.com/drunkod/dim0). Dim0 is an infinite canvas for
people and agents: this plugin can read boards, create/rename cards and links,
edit applet source, and read or change shared applet state. The MCP server and
OAuth identity system remain in `integrations/patchboard/apps/server/`: **no
server, database or personal credentials are bundled in this plugin**.

## Install a private preview

The canonical source descriptor `.mcp.json` intentionally points to
`dim0.example.invalid`. The marketplace therefore marks direct source
installation `NOT_AVAILABLE`. **Do not install the source directory unchanged**:
that hostname is not live. Until you own a persistent HTTPS hostname, build a
private portable ZIP with an explicit endpoint:

```sh
DIM0_MCP_URL="https://YOUR-VERIFIED-HOST/patchboard-private-mcp" \
  node scripts/package-dim0-openai.mjs
# or use the backwards-compatible command:
DIM0_MCP_URL="https://YOUR-VERIFIED-HOST/patchboard-private-mcp" \
  node integrations/dim0-mcp-plugin/scripts/build.mjs
```

Default outputs: `integrations/dim0-mcp-plugin/dist/dim0-jazz/` (extracted
portable root) and `integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip`.
`DIM0_PLUGIN_OUTPUT_DIR` changes the extracted root; the ZIP is always placed
in its parent, preserving the old interface. A failed build preserves the last
successful ZIP. The builder recognizes previously generated modular packages and exact
legacy three-file Dim0 packages for in-place upgrades, but refuses any output
directory containing unrecognized or caller-owned files, including nested files. Build failures preserve the
previous stage and ZIP. A release build rejects fixtures and temporary tunnels
and requires a matching explicitly approved permanent HTTPS origin:

```sh
export DIM0_MCP_URL=https://YOUR-PERMANENT-HOST/patchboard-private-mcp
export DIM0_PLUGIN_APPROVED_ORIGIN=https://YOUR-PERMANENT-HOST
DIM0_PLUGIN_RELEASE=1 node scripts/package-dim0-openai.mjs
```

The approval variable is a maintainer guard, not proof of DNS ownership;
verify control of the hostname and live OAuth discovery before release.

Upload the ZIP through your available ChatGPT plugin testing/installation
workflow; do not mistake an already configured MCP URL for an installation
test. The ZIP contains `plugin.json`, `mcp.json`, `README.md`,
`assets/` and `skills/`. Once a persistent domain is confirmed, update the
source `.mcp.json` and run release validation before offering source installs.
A temporary Cloudflare URL may work today but cannot promise permanent access.

## Each person connects as themselves

1. The board owner invites a friend as **editor** (or **viewer**). The friend
   must **redeem** the invitation while signed into their own Dim0 account.
   Merely opening a board URL does not grant membership.
2. Each person uses **their own ChatGPT account** to install/connect the
   same plugin. Each selects Connect, signs into **their own Dim0 passkey** in
   an independent browser profile and approves the shared board.
3. The MCP server discovers OAuth authorization with PKCE and dynamic client
   registration. It checks the bearer subject and board grant on each call,
   maps that subject to a Jazz actor, and checks current board membership.
   **A friend's ChatGPT account is not proof of a distinct Dim0 identity** if
   the consent browser is still signed in as the owner.
4. To verify identities, let the owner create a visible canvas card and record
   its ID and version. The friend reads and renames the same card; the owner
   reloads and checks **the identical ID, a higher version and a different
   `updatedBy` Jazz actor**. A viewer may read, but cannot rename.

## Tools and examples

Read-only access: `list_boards`, `read_board`,
`list_canvas_entities`, `get_canvas_entity`, `get_applet_state`.

Editor access also offers: `create_note` (legacy note representation),
`create_canvas_entity`, `update_canvas_entity`,
`delete_canvas_entity`, `update_applet_state`.

- "Show cards on my approved board" → `list_boards` then
  `list_canvas_entities`.
- "Create a visible card titled Design review" → `create_canvas_entity`
  (not legacy `create_note`) with a new UUID `id`, UUID `graphUid`
  equal to the approved board, kind `node`, and valid full payload.
- "Rename Design review to Ready for QA" → read the **entire existing**
  payload with `get_canvas_entity`, change only the title in the relevant
  label/content field, pass the returned `expected_version` to
  `update_canvas_entity`. Preserve the UUID and other properties.
- "Increment the shared counter" → `get_applet_state`, calculate the
  next JSON state, then `update_applet_state` using its exact version.
  A conflicting version is **not silently merged**: re-read and ask before
  overriding another participant.

An explicit board grant limits which board the plugin can access. A viewer
cannot gain edit rights merely by consenting to a broader OAuth scope.
Never put access tokens, invites or personal information in prompts or code
samples. Do not infer a collaborator from a chat display name.

## Optional catalog QA

The isolated HTTPS QA profile may advertise `call-api-write` with the
single allowlisted `dataset.create.v1` operation. It requires current Owner
authority and explicit `board:write` and `table:create` consent. Neither this
archive nor an old board-write consent confers that capability. Use the
existing request ID and exact input for replay; never substitute a canvas card
for a table. See the [installed catalog runbook](../../integrations/patchboard/docs/QA_INSTALLED_CATALOG_RUNBOOK.md).
The relative link is for repository readers; the portable ZIP does not contain
the backend or runbook.

## Status and support

Private package candidate only. **An actual clean ChatGPT ZIP installation
and two independent ChatGPT-account authorization flows must be verified by
people with access to the relevant accounts.** Automated tests cover OAuth,
permissions, writer attribution, reconnect, and frontend collaboration, but
those are not substitutes for the real-account acceptance test.

This package uses Dim0 MIT-licensed assets, not Teable brand assets. Before
public directory submission, the publisher must provide validated legal
privacy/terms URLs, support contact, a permanent HTTPS origin and submission
evidence; no such details are invented in the manifest.

Source, bugs and support: https://github.com/drunkod/dim0/issues.
