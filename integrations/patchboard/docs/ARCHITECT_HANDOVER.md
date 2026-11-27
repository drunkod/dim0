# Patchboard handover to the incoming architect

> **Historical letter (20 Nov 2026).** Follow the signed-off implementation at `main` `6f36a35` and [the current human acceptance runbook](HUMAN_ACCEPTANCE_RUNBOOK.md) for today's status. The earlier uncommitted work, “not delivered” declarations and next-architecture assignment below record the starting point, not the current capabilities. [Commit-by-commit change diagrams](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md) show what actually shipped.

20 November 2026 · From the Patchboard product owner

Dear Architect,

Patchboard is a shared board that people can edit in a browser and agents can update through two MCP tools, `read_board` and `create_note`. Our next deliverable is a private board where two people can independently authorize ChatGPT to act on their behalf. I want to see whose account created each note and whether a third person can access either the board or its live updates.

Please keep the complete application on my MacBook. A single Node process in the current demo serves the built Foldkit UI, Jazz synchronization and the MCP SDK. Jazz owns the board data and persists to local SQLite. Tailscale Funnel supplies HTTPS. Keep that deployment model for private collaboration. A separate local SQLite file for Better Auth will hold credentials, sessions and OAuth grants. Jazz remains authoritative for board ownership, membership and notes.

### Where to start

| Question | Read this in the repository |
|---|---|
| What should we build now? | The companion `PRIVATE_COLLABORATION_PLAN.md` is the active assignment for private collaboration. The M2 runbook still governs the guest demo. |
| How do we develop and review? | Root `AGENTS.md`, `docs/DEVELOPMENT_CYCLE.md`, the playbooks under `.agents/skills/`, and the issue and PR templates under `.github/`. |
| Where are the original plans? | `docs/ROADMAP.md`, `docs/MVP_PLAN.md`, `docs/ARCHITECT_LETTER_LOCAL_FIRST.md` and `docs/M1_START.md`. Their earlier deferral of authentication applied to the disposable demo. |
| How do we run and verify the demo? | `docs/M2_DEMO_START.md`, `docs/M2_LOCAL_MCP_CHECKPOINT.md`, and especially `docs/M2_PUBLIC_FUNNEL_RELEASE.md` on `feat/m2-local-mcp`. |
| Where are the design decisions? | Branch `docs/macbook-demo` contains `docs/ADR-001-macbook-demo.md`, `docs/M2_ARCHITECTURAL_SPEC.md` and `docs/ADR-002-eidos-reference.md`. Eidos can wait. |

### What the evidence supports

I would keep the guest demo available for the handover. Its checkout is `/Users/test/work/patchwork/agent-staff-board-m2-mcp` at `f4df0d4`. Local health on 8791 returned `ok` during this inspection. The committed release report records a public-domain SDK write, two already-open Chromium profiles with Jazz HTTP 101 upgrades, and exact-ID recovery after a controlled process restart. That report leaves a separate off-tailnet device and a real ChatGPT.com call open. Neither two-person OAuth nor private Jazz access has passed acceptance.

Development has started in `/Users/test/work/patchwork/agent-staff-board-auth`. Its uncommitted change gives separate verified actors independent request-ID namespaces in the domain function. The new test first showed the same note ID for two actors. All six MCP/domain tests then passed. This is evidence for retry behavior only. The full verification run stopped during a browser reload. Review the trace before stacking changes.

Please use the CAFE cycle for every change. Start with one observable failing assertion, make the smallest change and repeat that assertion. Foldkit update and view stay pure. Put writes in named Effect operations and long-lived subscriptions in managed resources. Test Model/Command behavior with Story, rendered interactions with Scene, permissions and persistence against real Jazz, and the built UI in independent browsers. Each English PR should contain the failing assertion, passing command, exact revision and observable evidence. Require a green `pnpm verify` before pushing implementation.

For November 21, authorize only the demonstration whose gates pass. Two authenticated SDK clients are a valid intermediate result. Two separate ChatGPT accounts each creating an attributed note is the product acceptance event.

Best regards,
Patchboard Product Owner

[Implementation branch and release documents](https://github.com/drunkod/agent-staff-board/tree/feat/m2-local-mcp/docs) · [Architecture branch](https://github.com/drunkod/agent-staff-board/tree/docs/macbook-demo/docs)
