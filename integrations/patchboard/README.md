# Patchboard — shared visual workspace for staff and AI agents

**Architecture:** [Foldkit](https://github.com/foldkit/foldkit) for pure Model/Message/update/view, [Effect](https://effect.website) for typed commands and scoped resources, and [Jazz](https://jazz.tools/) as the only persistent data and sync layer.

## Current status — 21 November 2026

**M1, guest M2 and private OAuth staging are implemented on merged `main` (`6f36a35`).** The public MacBook-hosted demo, Jazz sync, private browser passkey/roles, board-scoped OAuth MCP, protected private note edit/move and exact-ID restart tests have passed their stated automated or staging acceptance boundaries.

**One real ChatGPT.com account has successfully connected to the private OAuth MCP, read the authorized board, created an author-attributed note, and retried its request ID without duplication.** This is **not** a two-person sign-off: a second person's own ChatGPT OAuth authorization, a genuinely off-tailnet phone and Firefox private passkey acceptance are still manual gates. No real private user data is approved.

**Start with the [current human acceptance runbook](docs/HUMAN_ACCEPTANCE_RUNBOOK.md)** and [architecture/commit diagrams](docs/ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md). The older [M2 local demo checkpoint](docs/M2_DEMO_START.md) and [guest public release log](docs/M2_PUBLIC_FUNNEL_RELEASE.md) document historical, intentionally unauthenticated sample-data milestones.

See [roadmap](docs/ROADMAP.md), [MVP plan](docs/MVP_PLAN.md), [development cycle](docs/DEVELOPMENT_CYCLE.md) and [agent development contract](AGENTS.md). Communicate with the architect and write technical handoffs **in English**.

## Working repository and commands

- Authoritative code: [GitHub `main`](https://github.com/drunkod/agent-staff-board/tree/main); MacBook development worktrees are separate checkouts, and the original `/Users/test/work/patchwork/agent-staff-board` can remain on an **older branch**. Use an isolated fresh worktree or explicitly verified `main` for current runbook and CI.
- Upstream references: `../cafe`, `../jazz`
- Jazz code reference index: [CODE_REFERENCES.md](docs/CODE_REFERENCES.md)

```bash
pnpm install
pnpm generate
pnpm --filter @patchboard/server dev  # in a separate terminal; localhost:3001
pnpm dev                              # development Vite frontend, typically :5173
pnpm verify                           # schema checks, lint, tests, typecheck, E2E
```

The existing M1 Playwright setup builds/serves the app with the Jazz proxy and isolated fixture data. The production preview URL, when launched by that test harness, is `http://127.0.0.1:4173`. Do not mistake the default device-local browser store for the two-profile shared fixture; follow the M1 test and shared-server setup.

## Guest MCP (implemented, deliberately unauthenticated sample-data track)

The verified **reference** implementation on this Mac lives at `/Users/test/Documents/work/cafe-mcp-live`; its existing ChatGPT remote MCP route is `/orbit-mcp`. A separate Jazz data connector reference lives at `/Users/test/Documents/work/jazz-tools-mcp-v2`.

The **guest** service already publishes `/patchboard-mcp` over Funnel and exposes `read_board` and `create_note` against a fixed disposable board, with **no user-account mapping or OAuth**. In contrast, the **private** service publishes `/patchboard-private-mcp` with board-scoped OAuth, passkey identities and role checks. Keep the existing Tailscale routes untouched and credentials server-only. See [the operational runbook](docs/HUMAN_ACCEPTANCE_RUNBOOK.md).

## Development rules

- Do not add a second persistent business-data store or directly modify Jazz's SQLite file for agent writes.
- Keep Foldkit + Effect + Jazz and the installed pinned compatibility baseline (Jazz 2.0.0-alpha.69, Effect 4.0.0, Foldkit 0.165.0).
- Use CAFE-style red/green tests, real M1 Jazz integration and two-browser Playwright evidence.
- The historical guest demo defers user-account authorization by design. **Private OAuth and passkey roles are now implemented in staging**, but security hardening, final manual acceptance and the optional proposal/approval workflow remain outstanding.
- Never claim the planned ChatGPT plugin or Funnel path works until an actual end-to-end invocation passes.
