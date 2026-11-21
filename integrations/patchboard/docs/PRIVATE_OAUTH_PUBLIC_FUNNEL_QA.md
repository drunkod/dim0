# Patchboard private OAuth MCP — scoped public HTTPS rehearsal

> **21 Nov 2026 postscript (after the original QA below):** The real ChatGPT.com **owner-account** OAuth connection is now **verified** using the protected MCP URL, DCR, board consent, and **OIDC disabled**. ChatGPT's default `openid` and `email` scopes caused `invalid_scope` until OIDC was disabled. `read_board`, `create_note`, one-author attribution, exact-note persistence and idempotent request-ID retry all passed; see [HUMAN_ACCEPTANCE_RUNBOOK.md](HUMAN_ACCEPTANCE_RUNBOOK.md) and the evidence stored at `/Users/test/work/patchwork/demo/cross-browser-qa-20261121/CHATGPT_PLUGIN_ACCEPTANCE.md`. **Still unverified:** a *second independent real ChatGPT account*, cellular outside the tailnet and Firefox private passkey. The dated assertions below describe the earlier SDK rehearsal; do not silently replace them with this new result.

**Date:** 20–21 November 2026. **Status:** validated on a disposable public-Funnel staging database, not promoted to the private production board. A real ChatGPT.com plugin connection and an off-tailnet browser remain unverified. External hosting is not used.

**Upgrade 21 November:** The disposable 8794 process was stopped in isolation, backed up to `/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging-backup-20261121` (0700), migrated without schema changes, and restarted using PR #6 commit `943d40d` (which includes the corrected PR #5 board-bound OAuth). The new code was validated through the actual HTTPS Funnel hostname and remained healthy after its scoped restart. The guest service 8791, private real-board service 8792 and all existing Funnel mappings were preserved.

## Exact implementation and isolation

- MacBook source worktree: /Users/test/work/patchwork/agent-staff-board-private-public
- Branch: feat/private-oauth-public-qa (stacked on feat/private-oauth-mcp / PR #5).
- Private staging-only loopback listener: 127.0.0.1:8794.
- Public HTTPS ingress: https://tests-macbook-air.tail70b8a.ts.net.
- Isolated **disposable** persistent root: /Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging.
- Authentication SQLite: public-staging/auth/better-auth.sqlite (0600).
- Jazz board SQLite: public-staging/jazz (private permissions). The auth secret is local, in public-staging/auth/better-auth-secret (0600).
- The existing private real accounts on 8792 and guest demo data on 8791 were NOT migrated or exposed.
- Both SQLite stores and all OAuth/passkey login, MCP and realtime Jazz processes remain on the user's MacBook. Tailscale Funnel is the external TLS ingress, not an application hosting provider.

## Public paths added on the existing HTTPS 443 hostname

| Public route | Loopback destination | Purpose |
|---|---|---|
| /patchboard-private | 127.0.0.1:8794/patchboard-private | Private Foldkit app, passkey sign-in, board and Jazz HTTP/WSS |
| /patchboard-auth | 127.0.0.1:8794/patchboard-auth | OAuth authorize/token/register/JWKS, Better Auth passkey routes, auth-server discovery |
| /patchboard-private-mcp | 127.0.0.1:8794/patchboard-private-mcp | Protected Streamable HTTP MCP; no-cookie access |
| /.well-known/oauth-protected-resource | 127.0.0.1:8794/.well-known/oauth-protected-resource | RFC 9728 protected-resource discovery, including the resource-suffixed path |
| /.well-known/oauth-authorization-server/patchboard-auth | 127.0.0.1:8794/.well-known/oauth-authorization-server/patchboard-auth | RFC 8414 issuer-with-path metadata, canonical provider document re-served verbatim |

**Existing mappings preserved:** root / to 3000; /orbit-mcp to 8787/mcp; /patchboard and /patchboard-mcp to 8791; HTTPS 10000 root to 8787; HTTPS 8443 tailnet-only root to 8648. The prior complete Funnel config was saved on the Mac at /tmp/patchboard-funnel-before-private-20261120.json and .txt. Do NOT run tailscale funnel reset or a broad HTTPS 443 root remap.

## Confirmed remote resources

- Public UI: https://tests-macbook-air.tail70b8a.ts.net/patchboard-private/
- Private MCP: https://tests-macbook-air.tail70b8a.ts.net/patchboard-private-mcp
- Protected resource metadata: https://tests-macbook-air.tail70b8a.ts.net/.well-known/oauth-protected-resource/patchboard-private-mcp
- Authorization server metadata: https://tests-macbook-air.tail70b8a.ts.net/patchboard-auth/.well-known/oauth-authorization-server
- **Standard issuer-path discovery (RFC 8414):** https://tests-macbook-air.tail70b8a.ts.net/.well-known/oauth-authorization-server/patchboard-auth
- OAuth issuer: https://tests-macbook-air.tail70b8a.ts.net/patchboard-auth
- OAuth resource audience: https://tests-macbook-air.tail70b8a.ts.net/patchboard-private-mcp
- Jazz WebSocket endpoint: wss://tests-macbook-air.tail70b8a.ts.net/patchboard-private/jazz/apps/<app-id>/ws, scoped to signed-in members

Actual public-domain HTTP checks: private UI 200, resource metadata 200, authorization server metadata 200, MCP without bearer 401 with correct WWW-Authenticate resource_metadata and scopes. Verified from MacBook via public hostname, not from a separate off-tailnet device.

## Full public-domain OAuth acceptance evidence

The production-built private UI and official MCP SDK were exercised over the actual HTTPS hostname. The test used temporary virtual WebAuthn authenticators and created only disposable staging accounts/boards.

Acceptance steps:
1. No Bearer, malformed bearer and cookie-only MCP are denied HTTP 401.
2. Dynamic OAuth client registration returns a client ID; Authorization Code + PKCE + explicit passkey sign-in and consent yields a scoped, short-lived bearer token for the exact MCP audience.
3. A board:read-only grant discovers only list_boards/read_board; a board:write grant additionally discovers create_note.
4. Owner's OAuth MCP call creates a note immediately, visible in the private Foldkit/Jazz app. Idempotent retry returns identical note ID. Attempt to write a different board is denied.
5. Separate invited viewer registers a passkey and consents to board:read plus board:write, reads the board with MCP, but create_note is denied by viewer role.
6. Two separately signed-in browser profiles already subscribed to the same board when a subsequent OAuth-authorized owner MCP call created a new note. Both saw the same note without refresh. Chromium DevTools recorded actual HTTP **101** WSS upgrade responses for owner AND viewer.
7. Only the identified private staging Node process on port 8794 was stopped via SIGTERM and restarted against the exact same SQLite root. Both authenticated browser profiles reloaded, the note persisted with the **original note ID**, and the same OAuth access token was accepted after restart.

Successful test markers:
- MCP_COOKIE_AND_INVALID_BEARER_DENIED
- OAUTH_CODE_PKCE_CONSENT_PASS (read and write grants)
- MCP_READ_SCOPE_TOOL_DISCOVERY_PASS
- PRIVATE_OAUTH_MCP_NOTE_LIVE_AND_IDEMPOTENT_PASS
- PRIVATE_OAUTH_VIEWER_SCOPE_CANNOT_ESCALATE_ROLE_PASS
- PRIVATE_OAUTH_TWO_BROWSER_WSS_LIVE_MCP_PASS
- PRIVATE_PUBLIC_OAUTH_RESTART_EXACT_ID_PASS

One verified public run: board 01a1fa19-c714-75a3-b06e-860eae723125, live note dd2c3e7c-db26-4f4b-85bc-c79efe7df686, both WSS 101 and two-browser reloads with exact ID. This sample board is staging-only. Test log: /tmp/patchboard-oauth-public-restart-proof.log.

## 21 November: local CI proof of board-bound consent and independent authorship

This section records the **new isolated loopback CI rehearsal** in a fresh temporary auth/Jazz store. The earlier public HTTPS checks above preceded board-specific consent; the 8794 public staging instance **has since been upgraded and retested** as detailed below.

- PR #5 at `01fe126` runs a required independent `private-oauth` GitHub Actions job. Dynamic registration, passkey login, PKCE, **one explicitly selected board per grant**, refresh, membership checks, viewer denial and bounded SQLite enrollment are tested. The same user owns A and B: a grant for A can only list, read or write A; a separate grant for B does not affect A. `pnpm test:private:ci` is the repeatable local command.
- PR #6 adds a **third, independent editor profile**, a separate passkey account and independent OAuth grant on the same board. An owner and invited editor use the **same request_id**, receive two different note IDs, and both note `author_id` values match the correct Jazz `/api/me.accountId`. Both persisted `author_name` values and coordinates are asserted.
- All **three** authenticated browser profiles (owner, editor and viewer) show both correctly attributed notes without refreshing. The viewer still cannot write. The actual Jazz socket upgrade (HTTP 101) is checked by browser CDP.
- A deliberately isolated fixture-only process is restarted against the identical SQLite stores. After reload, all three profiles still show both author labels. The MCP SDK proves exact note IDs, text, board ID, author IDs, author names and coordinates are unchanged; the original OAuth access tokens remain valid until expiry. The test never stops ports 8791, 8792 or 8794.
- Example isolated successful run: board `01a1fa63-9eaa-7db3-b4de-bd9c597264e4`, owner note `ed54cf9d-e84d-484c-b698-92806c976b1f`, editor note `00c3777a-53e4-4237-87d9-02adcbf4f103`. These identifiers belong to **disposed temporary CI data**. Test log `/tmp/patchboard-pr6-final-private-ci3.log`.

Run the full automated local acceptance by executing `pnpm test:private:ci` in the PR #6 worktree. It creates and cleans a temporary SQLite root, migrates auth tables, launches a dedicated loopback server, creates virtual WebAuthn passkeys, tests both MCP writes, restarts only the fixture, then removes it. No Funnel, Mac-specific ports or actual ChatGPT account is required.

**Remaining gates:** one independently off-tailnet browser and two real ChatGPT connector grants/actions with exact callback URLs. The 8794 staging account data is disposable; do not use production board content for verification.

## 21 November: upgraded public HTTPS proof — pass

After the scoped code upgrade, the official MCP SDK and **three independently signed-in Playwright browser profiles** exercised the public hostname `https://tests-macbook-air.tail70b8a.ts.net` (the request path passed through the Tailscale Funnel). This was an HTTPS test originating on the MacBook, **not** an independent off-tailnet browser.

- **One-board authorization:** user owns A and B; a grant for A cannot list, read, write or refresh into B. A separate connection to B is independent.
- **Session isolation:** unauthenticated or malformed MCP Bearer is rejected; passkey cookie alone is insufficient. Explicit consent and OAuth PKCE are required.
- **Real-time collaboration:** owner and viewer saw an MCP note without refresh; Chromium CDP observed Jazz WSS HTTP 101 for both.
- **Three identities:** owner and invited editor created different note IDs with the identical request ID; the viewer could read but not write. All three browsers saw both notes and the server-assigned author labels.
- **Restart:** the automated script stopped and restarted **only** the identified disposable 8794 server. Both authors' IDs, names, note texts and coordinates survived; valid OAuth access tokens continued to work.
- **GitHub CI:** PR #5 (board-scoped OAuth + bounded enrollments) and PR #6 (independent writer author labels and restart) each have passing required checks at the time of this test.

Sample staging proof: board `01a1fa67-c205-7340-a584-6ac6a7b17c18`, owner note `93385f56-c723-404d-9941-9ea8b03a398f` by Jazz account `8dd42164-44a5-4e74-9935-74afb346c433`, editor note `98df0c01-872d-42e6-b34d-af9ebe8b157c` by Jazz account `42c4a937-5cbd-4bd6-875b-4517fdf91e5f`. Every identifier belongs to the **disposable staging store**.

Evidence on the MacBook:
- `/tmp/patchboard-pr6-public-upgraded-proof.log` — full public-hostname SDK/browser test with exact-ID author restart markers.
- `.../patchboard-private-oauth-public-staging/evidence/private-oauth-live.json` — actual author names, IDs, coordinates and WSS evidence.
- `.../patchboard-private-oauth-public-staging/evidence/private-oauth-restart.json` — exact-ID restart/recovery for the original two-browser note.
- `.../patchboard-private-oauth-public-staging/evidence/{owner,viewer}-{live,after-restart}.png` — UI screenshots.

The final demonstration still requires a **separate off-tailnet browser** and **two real ChatGPT accounts** creating notes through their own OAuth-authorized connectors. The loopback OAuth callback used by the SDK test cannot substitute for the actual redirect URI presented by ChatGPT.

## 21 November: RFC 8414 path-based OAuth issuer discovery

**Architect P1:** protected-resource metadata advertises an OAuth issuer with the `/patchboard-auth` path, so a standards-compliant MCP connector must discover its AS metadata at `/.well-known/oauth-authorization-server/patchboard-auth`, not only at the Better Auth internal URL. The Node handler serves the official provider's existing JSON document at that standard path, without changing the issuer, token URL, JWKS, scopes or signatures. Its alias matches **only that exact path** and supports GET/HEAD.

The additional Funnel route on port 443 is scoped to the exact metadata path, preserving all existing routes and other services:

    tailscale funnel --bg --https=443 \
      --set-path=/.well-known/oauth-authorization-server/patchboard-auth       http://127.0.0.1:8794/.well-known/oauth-authorization-server/patchboard-auth

Before applying, back up `tailscale funnel status --json` and text status. Verify the entire mapping after; do **not** reset Funnel or replace its root mount. The public service remains backed by a single MacBook Node instance and Jazz/SQLite. Do not target the guest's 8791 or the private 8792 service.

The automated `apps/web/test/private-oauth-mcp-proof.mjs` now starts **only with the private MCP URL**, checks an unauthenticated HTTP 401 and its `WWW-Authenticate resource_metadata`, loads RFC 9728 protected-resource metadata, obtains the issuer from `authorization_servers`, constructs the RFC 8414 well-known URL from that issuer's path, verifies the issuer exactly, and discovers the provider's **actual** registration, authorize and token endpoints. Then it executes dynamic client registration, passkey login, PKCE, board-limited consent, MCP writes and the existing independent-authorship/restart tests. No provider endpoint is passed into the test manually. The regression also runs the installed **official MCP SDK** `discoverOAuthServerInfo(mcpURL)` from the same initial URL and asserts its issuer, resource, registration/authorization/token endpoints match. A separate public HTTPS invocation of that SDK function returned `OFFICIAL_MCP_SDK_AUTO_OAUTH_DISCOVERY_PASS`.

**P1 CLOSED — PUBLIC PROOF PASS (21 November).** The disposable 8794 service was stopped, and its auth/Jazz SQLite root was backed up to `/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging-before-rfc8414-20261121` (0700) before restarting at PR #6 code commit `efdff72`. Only the exact AS metadata path was added in Funnel. The public RFC 8414 URL returned **HTTP 200 JSON**, with the unchanged issuer `https://tests-macbook-air.tail70b8a.ts.net/patchboard-auth`. The unauthenticated MCP endpoint still returns **401**. The entire existing Funnel route table, guest 8791, and private-board 8792 remained intact.

The complete SDK/Playwright proof **started with only** `https://tests-macbook-air.tail70b8a.ts.net/patchboard-private-mcp` and followed the WWW-Authenticate resource metadata to the standard issuer-based AS metadata, discovered registration/authorize/token endpoints, dynamically registered an OAuth client, completed passkey + PKCE + consent, and created real board-scoped notes through public HTTPS. The test additionally passed one-owner/two-board isolation, refresh, viewer denial, owner/editor notes with a shared request ID but distinct authors, actual Jazz WSS HTTP 101 for both browser profiles, and exact IDs/authors/coordinates after restarting only port 8794.

Live sample board: `01a1fa79-8777-7880-8666-a4577a31f60f`; owner note `4b7a08f9-b850-4d96-8222-8b4d24d4647e`, editor note `e76a85a1-ad2a-46a4-93bf-43e5178c9157`. Log: `/tmp/patchboard-rfc8414-public-proof.log`. The private OAuth GitHub CI job at `efdff72` passed; review GitHub for the separate complete check suite.

The outstanding **independent** proof is an off-tailnet browser and two actual ChatGPT.com client grants/tool calls. The SDK test's localhost OAuth callback is a test fixture, not ChatGPT's real callback. Do not claim the ChatGPT demonstration is complete based on SDK evidence.

## Start or recover the disposable staging service

Do not point these commands at /Users/test/work/patchwork/demo/patchboard-private-nov21 (the existing private board) or patchboard-nov21 (guest). The first invocation creates a new auth secret, database, and Jazz store; keep that directory private.

    cd /Users/test/work/patchwork/agent-staff-board-private-public
    export PATCHBOARD_PRIVATE_ROOT=/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging
    export PATCHBOARD_PRIVATE_ORIGIN=https://tests-macbook-air.tail70b8a.ts.net
    export PATCHBOARD_PRIVATE_PORT=8794
    pnpm install --frozen-lockfile
    pnpm auth:migrate:private
    pnpm demo:private

Migrate only the dedicated staging store (and back up its database before a future schema change). The demo command builds the private browser assets first, then starts the loopback Node listener. Never start two server instances against the same SQLite directory. Check /health on the loopback port, not the public root /health (which belongs to another service).

If the staging process is already running, do not start a second copy. To restart intentionally, identify only the PID listening on 8794, confirm its command ends in src/private-demo.ts in the private-public worktree, SIGTERM it, wait for the port to release, and restart with the exact same env/store.

The **public-domain test** without automatic restart:

    cd /Users/test/work/patchwork/agent-staff-board-private-public
    PATCHBOARD_PRIVATE_ORIGIN=https://tests-macbook-air.tail70b8a.ts.net pnpm test:private:oauth

Only the dedicated disposal staging environment permits automated restart, and only with all these exact flags:

    PATCHBOARD_PRIVATE_ORIGIN=https://tests-macbook-air.tail70b8a.ts.net \
    PATCHBOARD_PRIVATE_ROOT=/Users/test/work/patchwork/demo/patchboard-private-oauth-public-staging \
    PATCHBOARD_PRIVATE_PORT=8794 \
    PATCHBOARD_OAUTH_STAGING_RESTART=1 \
    pnpm test:private:oauth

The test refuses to restart if the origin/root/port do not exactly match the staging constants, or if the listening process does not look like src/private-demo.ts. It never touches 8791/8792. Do not run the restart test during a live demonstration.

## Remaining public release gates

- **Off-tailnet:** verify from a phone on cellular with Tailscale disabled, not just the MacBook's public hostname. Check private sign-in and board presence, web asset load, and actual Jazz WSS.
- **ChatGPT.com:** connect the custom MCP plugin in an eligible workspace using the protected MCP URL and OAuth; complete ChatGPT's real sign-in/consent flow; ask it to create a uniquely marked note and record the actual tool call + returned note ID. Availability depends on workspace/plan plugin permissions. No real ChatGPT tool invocation has been proven.
- **Hardening before real user data:** token revocation immediately after user disconnect (JWT remains valid for up to 15 minutes); DCR limits and abandoned-client pruning; trusted proxy IP handling and rate limiting; invalid audience/expired token tests; editor membership revocation through public MCP; backups, secret rotation, data retention, public security audit.
- **Promotion to private user data:** only after backing up existing 8792 auth/Jazz data, reconciling migrations, and rehearsing rollback. Do not mix staging identities and private production accounts.
- **Access minimization:** a viewer approving write scope is still a viewer; OAuth grants must be intersected with live board membership. Do not expose generic SQL or unrestricted call-api-write, even though Teable supports such advanced APIs.

See TEABLE_ADOPTION_ROADMAP.md for Teable patterns and deferred features and PRIVATE_OAUTH_MCP_CHECKPOINT.md for the original local OAuth release gate.
