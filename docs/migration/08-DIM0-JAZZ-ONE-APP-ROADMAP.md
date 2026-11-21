# Dim0-first, Jazz-authoritative migration: sprint register

Date: 2026-11-21. Working branch: `feat/jazz-mcp-tailscale-migration`.
Target: **one application based on the Dim0 fork**. Patchboard source remains in
`integrations/patchboard/` only as a temporary **backend implementation library**;
its old board and login UI are not part of the shipped experience.

## Sources followed

- User-provided Jazz 2 invitation research: keep invite digests in a private Jazz
  table; put the bearer code in a URL fragment; authenticate before redemption;
  use a serializable transaction for membership/consume; never downgrade roles;
  enforce permissions at the Jazz server, not in the UI; treat link revocation
  and membership removal separately.
- User-provided research on upstream Dim0: original
  `backend/topix/api/router/sharing.py`, `backend/topix/sharing/acceptance.py`
  and `webui/src/features/sharing/share-dialog.tsx` already support reusable
  owner-minted editor/viewer links, upgrade-only membership and live kicks.
- Jazz recipe references: `garden-co/jazz` invite-links recipe, PosterShop
  (atomic redemption), BandBook (resource-scoped authorization), StagePlan
  (code cleanup), EpicDrop (server-enforced permissions).

## The single user journey

1. Visit `/jazz-signin` or a `/jazz-invite/<board>#invite=<code>` link.
2. Create/sign in with a passkey **inside Dim0 React**, not in the copied
   Patchboard UI. The same Better Auth session establishes the verified Jazz identity.
3. After sign-in, redeem the invite with an authenticated
   `POST /patchboard-private/api/join` and wait for the Jazz transaction;
   then navigate to `/boards/<board>` in Dim0.
4. Dim0 Share dialog issues owner-approved editor or viewer links. Link secrets
   never leave the invite creation response except the URL fragment.
5. Each friend independently adds the OAuth MCP server to their ChatGPT account,
   signs in with **their own** Dim0 passkey identity, selects the **same** board
   at OAuth consent and authorizes their account's scopes. The agent's tool
   calls use Jazz membership and versioned canvas entity APIs.
6. Jazz `Db.subscribe` -> authenticated Canvas SSE -> Dim0 CanvasStore and
   versioned mutations. The app still uses REST hydration/fallback behind buffering proxies.

## Implementation checklist

| Domain | Owner/authority | Verified state / release gate |
|---|---|---|
| Canvas notes, applets and connectors | Jazz `canvasEntities` | Full CRUD and owner/editor/viewer roles tested, live updates and mini-app rendering |
| Board records/memberships | Jazz `boards`, `boardMembers` | CRUD/list API and role checks; native Dim0 React board list |
| Invite links/roles/expiry/revoke | Jazz `boardInvites` | SHA-256 digest only, URL fragment, serializable redemption, 7-day reusable link, explicit revocation |
| User-facing sign-in | Better Auth, Dim0 React | Native passkey UI; `PATCHBOARD_PRIVATE_DIM0_ONLY=1` redirects copied Patchboard root |
| ChatGPT MCP tools | OAuth 2.1 + Jazz authorization | Individual consent per board; same-origin issuer, separate connection per friend |
| Applet runtime/state | Dim0 UI; partial Jazz source | Source sync works; complete shared runtime state not migrated |
| Rich docs, uploads, file blobs | Mixed original Dim0 services | Not migrated to Jazz canonical storage |
| Full backend chat/agent history | Python/Postgres/Qdrant & browser code | Not migrated |
| Presence and live cursor UX | Original Dim0 WebSocket | Not unified with Jazz presence |
| Search and embeddings | Original Qdrant/local indexes | Not migrated |
| Offline conflict rebase/outbox | Current Jazz CAS & SSE fallback | Not implemented; do not claim full local-first CRDT editing |
| Passkey/OAuth sessions | Better Auth SQLite | Still an explicit secondary identity store; full Jazz-only constraint not met |
| Tailscale stable external origin | Existing Funnel targets legacy services | **No cutover yet**: needs isolated permanent mount and host/origin OAuth audit |

## Next gates (do not label complete before all are green)

P0: **PASSED ON MACBOOK HTTPS**. Real Helium/Playwright test
`integrations/patchboard/apps/web/test/dim0-jazz-friends-share-proof.mjs`:
owner creates reusable link, two newly registered passkey users land directly
on Dim0, editor A creates, editor B updates, owner sees changes, viewer cannot
write, removed user cannot read, revoked link fails. Same-origin
`/patchboard-private/` responds HTTP 302 to `/jazz-signin` in unified mode.
`pnpm test:private:ci` returned `PRIVATE_CI_ACCEPTANCE_PASS`, including OAuth
MCP grants, two-writer attribution and restart persistence. Frontend Vite
production-style build also passed. WebUI TypeScript full check should be
re-run separately on the MacBook if the long-running process is interrupted.

P1: Test external ChatGPT OAuth with a *second actual ChatGPT account*.
Testing two independent Jazz passkeys with an MCP SDK is useful but not a
substitute for clicking Connect in two different ChatGPT accounts.

P2: Configure a **new isolated Tailscale Serve/Funnel mount** pointing at
Dim0 and its private Jazz/OAuth services, without replacing existing Patchboard
routes until exact origin and callback acceptance passes.

P3: Migrate remaining upstream domain tables incrementally into Jazz: choose
canonical schema+permissions and generated bindings, implement small adapters,
write negative permission/role tests, migrate data with counts/checksums, only
then disable original backend writers. Do not treat a JSON payload mirror
as complete migration.

P4: Replace Better Auth's SQLite backing only after supported Jazz adapter
semantics, issuer continuity and token revocation are proven, with a migration
and rollback path. Otherwise declare identity-store exception explicitly.

## Local commands

```sh
cd /Users/test/work/patchwork/dim0-jazz-port
./scripts/run-jazz-mvp-local.sh
# http://localhost:5178/jazz-signin
```

The local helper sets `PATCHBOARD_PRIVATE_DIM0_ONLY=1` for one-app UI mode.
For the separate HTTPS presentation instance, set the same flag **on its
private Jazz backend** while keeping `VITE_DIM0_JAZZ_CANVAS=1` on Vite.
Do not change existing Tailscale Funnel configuration before P2 acceptance.
