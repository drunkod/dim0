# Sprint 3 — live ChatGPT OAuth MCP + WebMCP acceptance

**Date:** 2026-11-21. **Status:** real ChatGPT UI exercised against the Dim0/Jazz prototype.

## Proven through chatgpt.com

- Helium (macOS) attached through WebMCP / Chrome DevTools, CDP port 9222.
- From ChatGPT **Plugins → Add → Add custom MCP server**, created a private personal app named **Dim0 Jazz Sprint Demo**, using a temporary HTTPS MCP resource.
- Connected through OAuth PKCE, passkey sign-in and explicit **single-board** `board:read board:write` consent. No shared bearer cookie or bypass.
- From the app's **Try in chat** flow, ChatGPT made actual `list_boards`, `create_canvas_entity`, `get_canvas_entity`, and `update_canvas_entity` tool calls. The server's authenticated canvas API independently confirmed the exact IDs, versions, and payloads.
- ChatGPT created a regular note and later updated it to **version 3**; created a `style.type=applet` widget that rendered a counter in the *actual* Dim0 Canvas; and created a link joining the note to the applet, later updated to **version 2** with the label “runs”. The changes were independently read back through the authenticated board API.
- The mini-app's **+1** button changed the displayed count from 0 to 1; the value remained 1 after a reload on the same browser profile.
- A second isolated browser account registered its own passkey, accepted an invitation as a **viewer**, and saw the ChatGPT-created note. Its forged update returned HTTP 403. A later ChatGPT update was visible to that account without a reload; the browser test reported no JavaScript exceptions. ChatGPT’s per-edit approval was handled with **Allow once**, not a blanket grant.
- The disposable **full private CI suite** passed with `PRIVATE_CI_ACCEPTANCE_PASS` after the OAuth grant-recovery fix, including authentic OAuth, MCP CRUD, role checks, two browsers and server restart.

## Defects found and fixed

1. `GET /config.js` returned 404 in the self-hosted Vite preview because `index.html` requested an optional runtime configuration script absent from `public/`. A harmless deployment-overridable placeholder file now resolves it.
2. An MCP-created sparse link with `style: {}` made `linkToEdge` emit `pathStyle: undefined`. The canvas renderer's edge sampling then threw `Cannot read properties of undefined (reading 'length')`. **Defaulting to `bezier` at conversion time** matches the existing WS inbound normalizer. The full connector is now visible in Helium, with no console messages after the rebuilt bundle loaded.

3. ChatGPT's custom MCP connection did not request `offline_access` and its initial access token expired after 15 minutes. The backend now supports an explicitly configured, capped `PATCHBOARD_MCP_ACCESS_TOKEN_SECONDS` (900–21600); production still defaults to **900** seconds, while the isolated presentation server uses **21600** (six hours).
4. An old PWA service worker intercepted `/patchboard-auth/oauth2/authorize` after browser reload and served Dim0's SPA shell instead of OAuth. The Workbox navigation denylist now excludes private auth, MCP and metadata routes, and the opt-in Jazz app unregisters old test service workers. Verified with a fresh browser bundle: `navigator.serviceWorker.controller === null` and no registrations.
5. Better Auth 1.7.1's returning consent flow issued valid tokens **without** `patchboard_grant_id`, causing 401 despite a successful OAuth callback. The MCP verifier now recovers authority exclusively from an existing `oauthConsent` for the *same verified user and OAuth client*, with matching token scopes and **exactly one** distinct authorized board. Explicit invalid grants, ambiguous multiple boards, cross-client access and revoked grants still fail closed. A dedicated regression test covers these cases. A fresh ChatGPT `list_boards` call succeeded after the fix, returning only the authorized demo board.

The Cloudflare quick-tunnel log occasionally records **context canceled** for client-closed SSE streams and aborted asset requests; these did not reproduce as application faults.

## Reproduce

Start the local prototype: `./scripts/run-jazz-mvp-local.sh`.

Use the optional local wrapper for the installed WebMCP skill's Chrome DevTools CLI:

```sh
./scripts/webmcp-helium.sh start --browserUrl=http://127.0.0.1:9222 \
  --categoryExperimentalWebmcp=true --categoryWebauthn=true
./scripts/webmcp-helium.sh list_pages
```

For an already-open authenticated owner Helium board, use a **fresh test board and its entity IDs**:

```sh
cd integrations/patchboard
DIM0_MCP_ORIGIN=https://your-current-mcp-host.example \
DIM0_MCP_BOARD_ID=<board-uuid> \
DIM0_MCP_ENTITY_ID=<note-uuid> \
DIM0_MCP_APPLET_ID=<applet-uuid> \
DIM0_MCP_LINK_ID=<link-uuid> \
DIM0_MCP_VERIFY_ONLY=1 \
pnpm --filter @patchboard/web exec node test/dim0-chatgpt-plugin-multiaccount.mjs
```

Unset `DIM0_MCP_VERIFY_ONLY` to start the live-update watcher; **after** `VIEWER_READY_FOR_CHATGPT_UPDATE` appears, use the ChatGPT plugin to change the note to a new version and include `DIM0_MCP_EXPECTED_MARKER` in the content. The test records screenshots under `/tmp/dim0-webmcp-plugin-viewer-*.png`. Never print invitation tokens.

Run regression checks: `cd webui && ./node_modules/.bin/vitest run src/features/board/harness/convert/round-trip.test.ts && npm run type-check`, plus `cd integrations/patchboard && pnpm --filter @patchboard/server exec tsx --test test/private-mcp-reconnect-grant.test.mjs && pnpm --filter @patchboard/server typecheck`.

## Demo limitations

- The HTTPS Quick Tunnel address is ephemeral and the custom ChatGPT plugin must be reconfigured if it changes. The live presentation service is intentionally started with `PATCHBOARD_MCP_ACCESS_TOKEN_SECONDS=21600`; restart it with the same environment setting if needed.
- The sprint's owner test account uses a **virtual WebAuthn passkey** in Helium: preserve its browser session for the demo; it is not a durable recovery method.
- This remains an opt-in Jazz canvas prototype, not full Dim0 parity or a durable offline CRDT outbox.
- Server code, board membership checks, and OAuth consent were not disabled for the presentation.
