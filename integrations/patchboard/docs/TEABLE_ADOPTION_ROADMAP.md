# Teable reference architecture and staged Patchboard adoption

**Recorded 20 November 2026.** The source-of-truth repository is Patchboard; Teable is a researched reference, **not** a proposed replacement for Jazz, Foldkit, or the MacBook-only self-hosting model.

## Research register (pin versions and revisit before each milestone)

| Reference | Studied version | What to examine | Local research checkout |
|---|---|---|---|
| [teableio/teable](https://github.com/teableio/teable) | develop at bd8cfc054f521f6f9019f62dec2f9fcb1273ecec | OAuth, permissions, ShareDB authorization, board/view UX, collaboration, typed API, versioning, undo, imports, clean architecture | /Users/test/work/patchwork/research/teable |
| [teableio/teable-mcp](https://github.com/teableio/teable-mcp) | main at 5446050 (20 Nov 2026) | Official MCP client manifest, read/write tool taxonomy, annotations, examples, plugin packaging | /Users/test/work/patchwork/research/teable-mcp |
| [DeepWiki full Teable study](https://deepwiki.com/teableio/teable) | indexed bd8cfc05, supplied by project owner on 20 Nov | Architectural and feature catalog; verify claims against upstream before implementing | User-supplied full-wiki markdown in Patch work chat |

**Source hierarchy:** upstream source code and own integration tests > official README > DeepWiki overview. The official teable-mcp README describes tools but does not include handlers. Avoid claiming the tool implementations were audited when only their public contract was inspected.

## Directly studied upstream implementation

- [OAuth dynamic registration](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/oauth/oauth-registration.service.ts): RFC 7591 registration for ChatGPT and other clients; PKCE, callback URL validation, rate limiting, pruning unused clients.
- [OAuth endpoints](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/oauth/oauth-server.controller.ts): distinct login/authorization, registration, consent, token and device-flow endpoints.
- [OAuth permissions](https://github.com/teableio/teable/blob/develop/packages/core/src/auth/oauth.ts): explicit domain-action scopes, with sensitive account-level actions excluded for MCP.
- [Resource permission guard](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/auth/guard/permission.guard.ts) and [permission service](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/features/auth/permission.service.ts): scope ceiling and current user rights must both pass. Share links must not widen rights.
- [ShareDB authorization](https://github.com/teableio/teable/blob/develop/apps/nestjs-backend/src/share-db/auth.middleware.ts): authorize presence subscriptions, read/listen-only public channels, and user-specific notifications; do not treat WebSockets as implicitly trustworthy.
- [Teable MCP tool list](https://github.com/teableio/teable-mcp/blob/main/README.md): read metadata/records; create/update/delete records; generic API bridge. Read-only grants omit write tools from discovery.
- [V2 clean-architecture core](https://github.com/teableio/teable/tree/develop/packages/v2/core): domain commands/queries and ports, with persistence and realtime adapters at outer layers.
- [Teable testing setup](https://github.com/teableio/teable/tree/develop/apps/nestjs-backend/test): real HTTP/e2e, database and collaboration checks, not only unit tests.

## Nonnegotiable architecture decisions

1. **All Patchboard application processes and databases remain on the MacBook.** No cloud container, hosted PostgreSQL, managed Redis, remote identity store, or SaaS application runtime. Tailscale Funnel is the public HTTPS ingress to selected loopback endpoints, not an application host.
2. Keep one Node.js listener for the private application, its Jazz WebSocket backend, the Better Auth OAuth provider, and the protected MCP endpoint. Private SQLite authentication and Jazz stores are distinct and persistent; the guest demo store remains disposable and inaccessible to the private tools.
3. Browser identity: verified passkey -> Better Auth session -> server maps subject to Jazz user account -> Jazz policy enforces board reads; authoritative HTTP service controls private writes. Do not blindly accept device accounts in the private environment.
4. MCP identity: OAuth 2.1 Authorization Code + PKCE + explicit consent -> separate audience-bound short-lived Bearer access token -> cryptographic signature, issuer, audience and expiry verification -> subject to Jazz account -> current board membership and role -> same Jazz domain command. No passkey cookie fallback. Do not trust caller-supplied actor IDs.
5. Explicit read/write scopes (board:read and board:write) must narrow, not widen, an owner's/editor's/viewer's rights. A viewer who approves board:write still cannot write. Remove all write tools from tool discovery on a read-only grant.
6. Keep the existing authoritative create-note Effect and atomic idempotency receipt; isolate receipts by caller and board, and recheck membership on every replay. Future edit/delete commands get equivalent guards and replay semantics.
7. Public exposure must be scoped: future Funnel mounts for /patchboard-private/, /patchboard-private/jazz, /patchboard-private-mcp, /patchboard-auth/ and OAuth discovery at /.well-known/oauth-*. Do not replace the existing guest Funnel routes, root route or /orbit-mcp. Protect the private Jazz WSS handshake; do not publish an unrestricted sync service.
8. Audit source licenses before reuse: Teable apps/plugins are AGPL-3.0; some shared libraries are MIT. Learn design patterns and implement independently unless a license review explicitly authorizes copying code.

## Delivery plan: prioritized, gated, source-linked

| Priority | Capability and Teable inspiration | Patchboard implementation target | Acceptance evidence |
|---|---|---|---|
| **P0 now** | OAuth dynamic client registration, PKCE, consent, JWT verification, resource audience; Teable oauth-registration + oauth-server controller | Better Auth MCP OAuth provider and protected /patchboard-private-mcp, scoped list_boards/read_board/create_note | Full actual code grant, audience and expiration failures, missing/invalid token 401, scopes and current role enforced, note appears in two browsers and survives restart |
| **P0 now** | Scope-permission intersection; Teable PermissionGuard | Board owner/admin/editor/viewer/outsider checks for every MCP operation, not just browser REST; prevent session-cookie MCP | Denied viewer/outsider writes, missing read scope, revoked member retry denial, no cross-board leaks |
| **P0 ingress** | Self-hosted OAuth metadata and client lifecycle | Publish only required paths through existing Mac Tailscale Funnel; verify HTTPS+WSS and ChatGPT authorization in an eligible workspace | Real external HTTPS metadata, OAuth sign-in + consent, real ChatGPT tool call, no guest/private data crossover |
| **P1 collaboration** | ShareDB presence ACL + live-user information | Member-authorized ephemeral cursors, presence TTL, live edits and viewer-safe subscriptions on Jazz | Two editors concurrent, viewer observes but cannot mutate, outsider neither sees data nor presence; disconnect clears presence |
| **P1 board actions** | Teable CRUD + command/permission boundaries | update_note, move_note, delete_note + task changes as explicit domain commands, not generic SQL/REST proxy | Per-action role/scopes, idempotence, conflict behavior, browser sync and restart, destructive action confirmation |
| **P1 activity** | Teable record history, comments and notification isolation | Append-only activity log and attributed comments per board/task; follow-user mentions later | Authored actor matches session, private board boundary, timestamps, replays, subscriber access checks |
| **P1 undo/recovery** | Teable undo/redo, trash, cold archive | Board-local undo/redo command history and soft-delete/restore before hard delete; checkpoints | A/B conflicting edits, undo only authorized changes, restore same IDs; retention documented |
| **P2 views** | Teable grid, kanban, form, gallery, calendar | Native Patchboard canvas + task list/kanban views over shared Jazz model; filters, sort, grouping and saved views | Two browsers see same base data with individual saved views; no duplicate models |
| **P2 search and scale** | Teable filter/query model and typed OpenAPI contracts | Small typed query module, board-local search and pagination, strict Zod contracts with generated clients where useful | Restricted board read, stable pagination and filtering, deterministic index tests |
| **P2 import/export** | Teable import/export and attachment services | Board-local JSON/CSV import/export, validated previews, bounded batches, later local attachment storage | Dry-run/confirmation, roundtrip IDs, rollback after invalid input, filesystem quotas |
| **P2 sharing** | Teable public view/share permission ceilings | Explicit board-specific readonly links with expiration; optional anonymous view only after policy review | Share token cannot escalate signed-in account role, never reveals private author details or presence |
| **P2 extensibility** | Teable plugin architecture and teable-mcp tool taxonomy | MCP tools for tasks, comments, proposal approval with narrow schemas and relevant annotations; avoid call-api-write wildcard | Least-privilege discovery, destructive confirmation, independent tool tests |
| **P3 intelligence** | Teable formulas, lookups, rollups, derived data and outbox | Optional board automation/derived fields with bounded local worker or SQLite task table | Recompute determinism, cycle detection, restart recovery, bounded resource use |
| **P3 scale/maintenance** | Teable V2 ports/CQRS, projections, feature flags and integrity dry-run | Isolate domain commands from Jazz transport, add storage adapters only when needed, canary rollout and integrity scans | Same contract over browser, MCP and tests; dry-run migration, rollback and production-like recovery |

## Implementation discipline

- Begin each feature by linking its upstream module, writing a Patchboard capability contract and adding a failing functional test. Prefer simple Effect commands + Jazz rather than transplanting a 40-package architecture.
- Never expose Teable-style generic call-api-write, SQL access, or arbitrary board/user override to ChatGPT until individual domain permissions, audit and confirmation are proven.
- Make tools discoverable according to granted scopes; keep board authorization per invocation because membership may change after OAuth consent.
- Every externally initiated change must preserve author identity, exact-id synchronization and idempotence across retries/restarts. Include signed-in viewer and outsider tests, websocket ACL tests and no-CORS-cookie tests.
- Run pnpm verify plus isolated OAuth integration and production-style two-browser tests before changing any public Funnel configuration. Treat private ingress and ChatGPT plugin onboarding as separate go/no-go gates.
- Teable-referenced UX features are backlog candidates, **not promises of current support**. Update this document and the implementation roadmap with evidence when each is delivered.
