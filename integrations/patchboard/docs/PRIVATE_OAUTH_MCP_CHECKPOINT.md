# Patchboard private OAuth MCP checkpoint — 20 November 2026

## Implementation boundary

Separate **private** MCP at /patchboard-private-mcp is implemented on branch feat/private-oauth-mcp. The original unprotected /patchboard-mcp endpoint remains a guest-fixture demonstration only. This milestone does not change Tailscale Funnel routes or expose private databases on public ingress.

- Identity source: self-hosted Better Auth passkeys, separate auth SQLite under PATCHBOARD_PRIVATE_ROOT/auth; Jazz data under PATCHBOARD_PRIVATE_ROOT/jazz.
- OAuth: Better Auth 1.7.1 mcp() + jwt() plugins, OAuth 2.1 authorization code with mandatory PKCE for public clients, explicit consent and dynamic registration.
- Canonical protected resource: PATCHBOARD_PRIVATE_ORIGIN + /patchboard-private-mcp. OAuth metadata is served under /patchboard-auth/.well-known/oauth-authorization-server; protected-resource discovery also lives under /.well-known/oauth-protected-resource/patchboard-private-mcp.
- Bearer verification: official requireMcpAuth checks JWT signature, issuer, protected-resource audience and expiry. The access token lasts 900 seconds. Cookie-only requests receive an RFC 9728 WWW-Authenticate challenge, not MCP access.
- Server maps verified JWT subject to a current Better Auth user row and that user's Jazz account. Client inputs cannot override actor IDs.
- list_boards and read_board require board:read; create_note requires board:write. Tools are omitted from MCP discovery when the grant lacks the relevant scope.
- Every board read or note write checks current board membership. Owner/admin/editor can write; viewer/outsider cannot. Retrying an idempotent request by a revoked member is blocked by the Jazz transaction recheck.
- The note uses the same Effect + Jazz serializable transaction as the existing backend, with server-owned author attribution and durable actor-scoped request receipts.
- OAuth consent UI uses signed Better Auth query parameters, an authenticated session and a nonce-based CSP. Successful OAuth redirect is returned by the local OAuth provider, not invented by the browser.
- /patchboard-auth/ OAuth endpoints, discovery, consent, private Jazz and MCP share the existing private Node listener; no external identity provider, SaaS runtime, PostgreSQL, Redis, or external service is required.

## Local tests already performed

1. Isolated QA instance at http://localhost:8793 with PATCHBOARD_PRIVATE_ROOT=/tmp/patchboard-private-oauth-qa-20261120, separate from the active 8791 guest and 8792 private demos.
2. Better Auth OAuth/JWT/passkey schema migrations applied successfully with pnpm auth:migrate:private in the disposable QA root.
3. MCP without Bearer returns HTTP 401 and WWW-Authenticate with proper protected resource metadata; passkey cookie alone also gets HTTP 401.
4. OAuth discovery returned the expected issuer, JWKS, authorization, token, registration, introspection and revocation endpoints. The protected resource document advertised only board:read/board:write.
5. Dynamic registration succeeded for a public native client, with exact loopback redirect validation. OAuth Authorization Code + PKCE + explicit passkey-authenticated consent and token exchange succeeded for read-only and read/write grants.
6. Official MCP SDK discovered exactly list_boards/read_board for a read-only grant, and all three private tools for a read/write grant.
7. OAuth-protected create_note made an actual Jazz note visible in a subscribed browser; the identical retry returned the original note ID; arbitrary other-board write was denied. Cold OAuth from a signed-out browser also succeeded after explicit passkey login.
8. An invited viewer registered a separate passkey account, accepted their invitation, consented to OAuth board:read + board:write, and **read** the board via MCP. The same access token was refused for create_note with BOARD_WRITE_DENIED; a scope does not elevate a board role.
8. Original M1/M2 guest sync/restart proof and the new private role/permissions tests are preserved; full verification must pass again after final edits.

Test runner: apps/web/test/private-oauth-mcp-proof.mjs. Run only after starting a disposable private demo server and configuring PATCHBOARD_PRIVATE_ORIGIN. This test creates disposable passkey accounts and boards in whichever private store it points to. Do not run it against a personal/production store.

**Production-assets caution:** \`pnpm verify\` builds the shared \`apps/web/dist\` directory for the guest paths. The private QA server also serves that directory. After running \`pnpm verify\`, rebuild the private assets before exercising the QA server: \`PATCHBOARD_WEB_BASE=/patchboard-private/ VITE_JAZZ_SERVER_URL=/patchboard-private/jazz VITE_PATCHBOARD_PRIVATE=1 pnpm build\`. Keep other worktree instances and their dist directories unchanged. This is a test-build interference issue, not a private-server authentication failure.

## Deployment and operation boundaries (still pending)

Before promoting the branch to the existing private 8792 service, back up the existing auth SQLite and Jazz directories, perform the Better Auth OAuth schema migration against that exact store, and rehearse restart. Do not overwrite the private identity database. A private OAuth provider requires publicly reachable HTTPS and accurate issuer metadata.

For ChatGPT or other remote OAuth MCP clients, use only narrowly scoped Tailscale Funnel routes, preserving existing public endpoints:
- /patchboard-private/ (login, consent, application)
- /patchboard-auth/ (OAuth authorize/token/register/JWKS and passkey APIs)
- /.well-known/oauth-protected-resource and /.well-known/oauth-protected-resource/patchboard-private-mcp (OAuth resource discovery)
- /patchboard-private-mcp (authenticated MCP)
- /patchboard-private/jazz (authorized Jazz HTTP/WSS, if browser collaboration is needed remotely)

Verify external reachability from a device outside the tailnet, inspect correct issuer/resource and WSS upgrades, and exercise real ChatGPT authorization and create_note with two authenticated browser profiles. **This has not yet been demonstrated.** The local QA instance is bound only to loopback.

## Known hardening and next steps

- Cold passkey sign-in during an OAuth request is now tested end-to-end, including resume to consent and a read/write MCP call. Viewer-token writes are now denied by real MCP SDK integration. Add dedicated wrong-audience and expired JWT tests, editor revocation through the public MCP route, and OAuth grant revocation tests.
- Better Auth JWT access tokens expire after 15 minutes; consider online revocation checks for immediate OAuth grant revocation. Membership revocation is already evaluated on each private board action.
- Enforce registration limits and cleanup of unused dynamic clients, inspired by Teable OAuthRegistrationService; configure a **trusted** proxy IP chain rather than blindly accepting arbitrary forwarded headers. The local QA runtime reports a shared rate-limit bucket when no trusted IP can be resolved.
- The private board's REST and Jazz WebSocket policies remain independently authorized; never derive MCP authority from their browser cookies.
- See TEABLE_ADOPTION_ROADMAP.md for the complete source-linked feature backlog. No Teable AGPL-licensed application code has been transplanted.


## Architect's merge-blocker remediation — 20 November (PR #5)

**P1 board-specific consent:** The user chooses exactly one board. A successful provider-signed OAuth authorization transaction obtains a fresh opaque Patchboard grant ID stored in the private auth SQLite file with subject, client, selected board, and revocation status. The official Better Auth consent reference persists through the authorization code and refresh token, and custom access-token claims place the reference inside the signed JWT. Private MCP checks signature, issuer, audience, expiry, grant ID, subject, OAuth client and live Jazz board membership. A missing, mismatched or revoked grant fails closed. Discovery lists only the selected board; reads, writes and idempotent retries cannot target a different board. Per-request AsyncLocalStorage isolates simultaneous consent tabs.

**Test:** One passkey user owns two boards, consents to A, and cannot list/read/write B. Board B remains unchanged. A second grant for B does not widen the first. Refreshing A's token with offline_access preserves its A-only boundary.

**P1 CI:** A separate required-in-workflow private-oauth GitHub Actions job invokes pnpm test:private:ci, with pinned dependencies, fresh disposable private auth and Jazz stores, migration, Chromium virtual passkeys, local loopback OAuth, official MCP SDK checks and enrollment tests. This independently builds the private bundle and avoids the guest/QA dist collision. The external Funnel and real ChatGPT calls remain separate release gates.

**P2 enrollment:** New pending passkey intents are stored in bounded, SHA-256-digest-only SQLite records, not files. BEGIN IMMEDIATE cleans expired intents and caps active issuance (default 128; maximum 500). A full bucket returns HTTP 429 and Retry-After. Legacy unexpired file tickets migrate into SQLite and expired ones are removed on the upgraded service's startup. DELETE ... RETURNING enforces at-most-once consumption. Recovery after an interrupted, already-created Better Auth user is exercised by the enrollment test.

**Next gate:** PR #6 must demonstrate two separate owner/editor OAuth grants and author identity, display names, actor-scoped identical request IDs and persistence after restart. The old disposable public staging service on 8794 must be upgraded before it reflects this new protection; private 8792 user data is deliberately untouched. No real two-ChatGPT-account run or independent off-tailnet browser is claimed.
