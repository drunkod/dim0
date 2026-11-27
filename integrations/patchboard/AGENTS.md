# Patchboard agent development contract

**Language:** All communication with the architect/developer, technical plans, issues, pull requests, code review reports and handoffs must be **in English**.

**Permanent infrastructure constraint:** [Architect's letter and architecture decision question](docs/ARCHITECT_LETTER_LOCAL_FIRST.md). The web app, Jazz server/data, remote MCP and **implemented passkey login/roles/OAuth** run on the owner's MacBook. External access is exclusively through Tailscale Funnel; do not add hosted application/server/database dependencies. Private security and identity remain server-owned; do not regress to guest-mode trust.

**Current acceptance workstream (21 November 2026):** [Human release runbook](docs/HUMAN_ACCEPTANCE_RUNBOOK.md) and [architecture/commit review](docs/ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md). Merged `main` at `6f36a35` includes private passkey roles, board-scoped OAuth MCP and server-authorized edit/move; one **real ChatGPT account** completed private OAuth read/create/retry. **Still pending:** a *second person's own ChatGPT account*, independent cellular off-tailnet access, Firefox private passkey and full two-human acceptance. Keep the [unauthenticated guest demo](docs/M2_PUBLIC_FUNNEL_RELEASE.md) separate; private Jazz reads require identity and direct private browser writes remain DENIED by policy. Do not claim production security or two-human acceptance.

Reference practices: `../cafe/AGENTS.md` at commit `24b11ca8` and `../cafe/.agents/skills/`. Do not modify pinned upstream `../cafe` or `../jazz` source trees.

## Development cycle

Follow [CAFE workflow adapted for Patchboard](docs/DEVELOPMENT_CYCLE.md) **and the mandatory [Effect TS 4 practices](docs/EFFECT_TS_PRACTICES.md)** for every new Effect service, command, stream or runtime boundary. The Effect addendum differentiates original project rules from newly researched official v4 guidance; check the installed types before using new APIs. Each coherent change starts with a failing test, ends with real runtime evidence and uses issue/PR templates. Run `pnpm verify` before pushing; report any environment-dependent failures explicitly. Local agent playbooks live in `.agents/skills/`. Parallel agents use isolated worktrees, ports and fixture paths.

## Required architecture

- **UI:** Foldkit / Effect Elm architecture. No React or alternative app state manager. `Model` is ephemeral UI state and snapshots from Jazz; `update` and `view` stay pure.
- **Persistence:** Jazz remains the only persistent source for boards, shapes, collaboration, proposals (if built later), and agent records. No parallel application database, local file/JSON store, direct SQLite mutation or browser LocalStorage business records.
- **Domain logic:** Named `Effect.fn("Domain.operation")` functions, typed payloads and `jazz-tools/effect` or the compatible pinned Jazz backend API. Validate actual installed SDK APIs before implementing.
- **Subscriptions:** Scoped Jazz Effect Streams/managed resources dispatch typed Foldkit messages. Preserve M1 two-browser synchronization and reconnect behavior.
- **M2 integration:** The **guest sample-data** MCP uses a dedicated `/patchboard-mcp` Funnel path and official Streamable HTTP SDK for `read_board`/`create_note`. The **private** MCP is now separately implemented at `/patchboard-private-mcp`, with passkey/OAuth PKCE, DCR, board-scoped consent and per-actor attribution. See the current [human runbook](docs/HUMAN_ACCEPTANCE_RUNBOOK.md).
- **Direct creation:** `create_note` is **immediate** in M2 and does **not** wait for human approval. The historical `propose_note`/Accept/Reject feature is optional post-demo M3, not an MVP dependency. This deliberate scoped exception supersedes the original “all agent writes require review” rule.
- **Fixture identity:** The *guest* no-auth demo has no user account linkage and uses one server-configured sample board. In the *private* track, OAuth grants bind one board to a verified subject/client and live membership. Never use a guest fixture identity as a private authority.
- **Narrow public boundary:** Never expose Jazz admin/Inspector/generic CRUD, admin credentials, or server code execution through no-auth public MCP. Backend secrets never enter browser bundles, ChatGPT tool data or Git.
- **Versions:** Keep pinned Jazz 2 alpha, Effect 4, Foldkit 0.165.0 unless the architect documents and verifies a compatibility reason for a change. No deprecated Jazz Classic 0.x APIs.

## Test-first loop (CAFE)

1. Write the first failing Story (pure update), Scene (UI interaction), backend Jazz integration/MCP protocol, or Playwright browser assertion for the observable behavior.
2. Make the specific test pass with the minimum implementation, reusing the running M1 Jazz server and the existing Jazz schema.
3. Run schema drift check, typecheck, lint, Story/Scene tests, real Jazz integration, and two-browser E2E as applicable; `pnpm verify` is the final local gate.
4. For M2: verify local MCP SDK client; public HTTPS Funnel SDK client; live two-browser Jazz sync and persistence; then an actual ChatGPT plugin call. A plain GET `/mcp` returning 406 is not a valid failure signal.
5. Provide reproducible English startup commands, an SDK smoke test, exact tested endpoints, a browser recording or trace and a clear status of each acceptance criterion.
6. Commit small coherent changes and avoid modifying unrelated repositories or any other Funnel route.

## Code conventions

- One responsibility per file, grouped by domain (`board/`, `agent/`, MCP service modules).
- Browser-safe shared API/schema packages contain no Node-only imports or server secrets.
- Typed Message unions with past-tense names (Clicked, Updated, Received, Failed, Succeeded).
- Commands handle errors and dispatch failure messages; ManagedResources own long-lived scoped connections.
- Preserve the source compatibility baseline; inspect installed types rather than relying on old examples.
- Never claim a prototype production-ready or an MCP/plugin endpoint live before real verification.

## Reference locations

- `../cafe` — CAFE development rules and Foldkit testing; `../jazz` — Jazz source/examples.
- `/Users/test/Documents/work/cafe-mcp-live` — **working no-auth remote ChatGPT MCP/Funnel** reference (`docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md`, `packages/live-mcp/server/mcp.ts`). Do not change its `/orbit-mcp` route.
- `/Users/test/Documents/work/jazz-tools-mcp-v2` — Jazz 2 backend connector examples (stdio, not remote HTTP). Validate compatibility with current pinned version.
- `docs/CODE_REFERENCES.md` — research and pinned Jazz source examples.

## Demo-only risk position

The **guest/no-auth demo** remains disposable sample data. The private OAuth path is now implemented for disposable **staging**, but token revocation/disconnect, rate limits, security audits, recovery and production readiness still require separate human acceptance. Tailscale Funnel is public; neither a successful guest MCP SDK call nor one real private ChatGPT user authorizes real sensitive data. See [the human acceptance and operations runbook](docs/HUMAN_ACCEPTANCE_RUNBOOK.md).
