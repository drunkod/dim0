# Dim0 Jazz MCP plugin template (migration branch)

This is a **packager**, not a deployed MCP server. The server is the imported Patchboard private OAuth MCP service in `../patchboard/apps/server/src/private-mcp.ts`, with new Jazz-backed Dim0 canvas CRUD tools.

## Build a ChatGPT/Codex-compatible package

Use a dedicated HTTPS Funnel origin whose configured private server actually serves `/patchboard-private-mcp`:

```bash
DIM0_MCP_URL=https://your-authorized-funnel-host.ts.net/patchboard-private-mcp \
  node integrations/dim0-mcp-plugin/scripts/build.mjs
```

The script validates that the URL is HTTPS and has no embedded credentials. It writes a portable package containing `plugin.json`, `mcp.json` and this README to `integrations/dim0-mcp-plugin/dist/dim0-jazz-mcp-plugin.zip`. This file is generated locally and is not a live plugin.

**Before upload:** independently verify the OAuth discovery metadata, dynamic client registration/PKCE, correct resource audience, refresh/revocation, board-scoped grants and Tailscale ingress, and supply required privacy/legal URLs and real icons if demanded by the publication portal. Do not use a production user database for initial reviews.

## Tools

Read-only grants: `list_boards`, `read_board`, `list_canvas_entities`, `get_canvas_entity`.

Read/write grants add: `create_note`, `create_canvas_entity`, `update_canvas_entity`, `delete_canvas_entity`.

For full entities the tool caller must carry UUID `id`, UUID `graphUid` equal to the board grant, `type` (note/document/link), complete JSON fields and current `expected_version` for updates/deletes. The backend verifies current Jazz membership and performs serializable, scoped mutations.

The new API is already covered by isolated private OAuth MCP tests. The main Dim0 React board is **not yet connected to Jazz subscriptions**, so new entities are currently visible to the Jazz/MCP API but not guaranteed to appear in the existing Dim0 canvas UI until the next implementation milestone.
