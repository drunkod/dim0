# Patchboard private collaboration — verified local checkpoint

**Date:** 20 November 2026
**Branch:** feat/private-collaboration-implementation
**Status:** Private **browser** workflow verified. OAuth/ChatGPT per-person connection not yet delivered.

## Demonstrated on the MacBook

A new **private** single-process Node/Jazz/Better Auth instance is running on loopback port **8792**. It has its own local Better Auth SQLite credentials/session database and separate Jazz SQLite data directory. The original public guest server on **8791** and its Tailscale Funnel mappings remain untouched.

The end-to-end test (apps/web/test/private-collaboration-proof.mjs) uses four independent Chromium profiles with genuine WebAuthn passkey registration. They represent A (board owner), B (invited editor), V (viewer), and C (outsider).

A creates a private board through Foldkit. A clicks **Invite an editor** and shares the generated link; B opens it, explicitly clicks **Accept invitation**, and receives an editor membership. The consumed token is removed from the URL. Replay of the same token by B or C returns 404. A also invites V as Viewer.

B and A create separate notes through the browser interface, not through direct Jazz writes. Both notes appear in all authorized browsers without refresh via real Jazz WebSockets. The notes display the server-verified user label and persist the corresponding distinct Jazz account IDs as authors. V sees notes but is denied writing (403). C connects to Jazz (HTTP 101) but receives no private notes, and private read/write APIs return 403.

During the same browser test, **only the private process** is stopped and restarted against its **original** Better Auth and Jazz SQLite directories. A, B, V and C reload their browser pages. Both notes retain exact original IDs, text, positions, author IDs and author labels. C still receives no private board data. Browser page errors: zero.

The separate tests apps/web/src/private-policy.test.ts and apps/server/test/private-authz.test.mjs enforce a default-deny Jazz policy, prevent direct browser writes or membership forgery, isolate request-ID receipts by actor and refuse a previously authorized retry after a member has been revoked.

**Evidence folder on MacBook:**
/Users/test/work/patchwork/demo/patchboard-private-nov21/evidence/

This includes private-collaboration-proof.json, browser screenshots for A/B/V/C and private-restart.log. Do not attach session cookies, WebAuthn challenges, or invitation secrets to PR logs.

## Source map

| Concern | Implementation |
|---|---|
| Better Auth passkeys and user sessions | apps/server/src/private-auth/auth.ts |
| Persistent auth SQLite and secret controls | apps/server/src/private-auth/config.ts and db.ts |
| Single-use passkey enrollment intents | apps/server/src/private-auth/enrollment.ts |
| Node fetch-API adapter and CSRF/Origin check | apps/server/src/private-auth/http.ts |
| Local isolated private server, protected Jazz | apps/server/src/private-demo.ts |
| Owner boards, invitations, reader/writer API | apps/server/src/private-board-routes.ts |
| Author-scoped receipt, revocation-aware replay | apps/server/src/board-service.ts |
| Deny-by-default Jazz permissions | packages/jazz-schema/private-permissions.ts and private.permissions.json |
| Optional note authorship/invite expiry migration | packages/jazz-schema/migrations/20261120T155543-private-authorship-and-invite-expiry-2c29659a4c13-5658a06fb349.ts |
| Foldkit private login, invitation and board UI | apps/web/src/main.ts and private-auth-client.ts |
| Browser collaboration/restart proof | apps/web/test/private-collaboration-proof.mjs |
| Permissions and actor-retry tests | apps/web/src/private-policy.test.ts and apps/server/test/private-authz.test.mjs |

**Jazz identity rule:** Better Auth user.id is a stable UUID. Jazz session.user is a separate Jazz account ID. The private server persists the relationship using Jazz createAccountFor(user.id). Board ownership, membership and note authorId use the verified Jazz account ID. Neither client input nor a ChatGPT display name is evidence of identity.

**Public guest remains different:** The existing guest endpoint has no authentication and can only operate on a disposable demo board. It must NEVER resolve to any private board. The private process does not expose a private MCP tool until bearer verification is complete.

## Run the private browser milestone locally

MacBook source directory:
/Users/test/work/patchwork/agent-staff-board-private-collab

Set the following environment variables in a terminal:

    export PATCHBOARD_PRIVATE_ROOT=/Users/test/work/patchwork/demo/patchboard-private-nov21
    export PATCHBOARD_PRIVATE_ORIGIN=http://localhost:8792
    export PATCHBOARD_PRIVATE_PORT=8792
    export PATCHBOARD_PRIVATE_DEV=1

Then:

    pnpm auth:migrate:private
    pnpm demo:private

The private website will be at http://localhost:8792/patchboard-private/ and local health at http://localhost:8792/health. The passkey RP ID in this mode is localhost. This HTTP loopback exception is **development only**; a public deployment needs a stable trusted HTTPS hostname and re-enrollment of accounts for that RP ID.

To restart, inspect the listener with lsof -nP -iTCP:8792 -sTCP:LISTEN. Verify its command is private-demo.ts. Send SIGTERM to that PID alone, wait until port 8792 is free, and restart with exactly the same private root. Never terminate the existing guest server or modify other Funnel routes.

Run tests from a second terminal while the private process is up:

    pnpm test:private:policy
    pnpm test:mcp
    pnpm test:private:browser
    pnpm verify

CAUTION: test:private:browser creates disposable passkey accounts and boards and performs a controlled restart of the private port 8792; NEVER run it against real user data. It is intentionally excluded from ordinary offline CI. pnpm verify builds the web test version in this worktree; rebuild the private UI with pnpm demo:private before demonstrating it.

## Outstanding release gates (not implemented in this checkpoint)

1. Better Auth OAuth authorization-code + S256 PKCE, discovery, consent, grant-to-board binding, access/refresh token verification and revocation.
2. A separate **protected private MCP** endpoint which verifies every bearer and calls existing read_board/create_note under the authorized Jazz account and board. The no-auth guest endpoint stays separate.
3. Scoped HTTPS Funnel publication of the private UI, Jazz WSS, OAuth issuer and protected MCP, only after checking other applications' routes and same-origin trust. Off-tailnet browser proof.
4. Two **real ChatGPT.com accounts**, each granting access to the same board and creating a separate note under its own verified Patchboard identity; exact IDs and author IDs after restart.

Other hardening before a production launch: session expiry/revocation on active WebSocket subscriptions, abuse controls, account profile UI, private edit/move controls, backup and restore, and a third-party security review. The private browser milestone must not be marketed as the complete ChatGPT integration.

**Release choice:** Keep the tested public guest demonstration available as fallback for November 21. The current passkey/browser result is a genuine partial implementation; continue with docs/PRIVATE_COLLABORATION_PLAN.md sections 5–6.
