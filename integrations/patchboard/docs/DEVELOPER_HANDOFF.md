# Patchboard developer handoff — historical developer baseline (20 November 2026)

> **Update 21 Nov:** The active implementation is now on merged `main` at `6f36a35`. The private OAuth MCP and note edit/move server authorization work; one real ChatGPT account connected via OAuth, read, created and retried a note. The next **human** acceptance is a second real ChatGPT account plus an independent off-tailnet browser and Firefox private passkey QA. See [HUMAN_ACCEPTANCE_RUNBOOK.md](HUMAN_ACCEPTANCE_RUNBOOK.md) and [ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md). Historical “current assignment” sections below are not today's release checklist.

**Current implementation assignment:** [Single-process demo acceptance](M2_DEMO_START.md#current-assignment). The original milestone description below provides background.

**Architect / developer communication language: English.**

**Current baseline:** M1 Shared board is already implemented and pushed to `main` in commits `0175b2c` and `64a82f2`. The M1 local Jazz SQLite server, two-profile browser synchronization, note editing/movement, reload/reconnect and automated checks were previously verified. Do **not** restart M1.

**New immediate deliverable:** implement a **ChatGPT.com custom remote MCP plugin**, without OAuth, that creates a Jazz note **directly** on one seeded Patchboard demo board via Tailscale Funnel. This is not a desktop `stdio` MCP demo and does not require proposal review.

**First read [the English architect letter about permanent MacBook self-hosting and the fastest extensible architecture](ARCHITECT_LETTER_LOCAL_FIRST.md).** Then use [the MCP architecture brief](ARCHITECT_BRIEF_CHATGPT_MCP.md) and [M2 checklist](M2_START.md). Public accessibility must include the Patchboard browser UI and Jazz WebSocket as well as MCP. Account/role/ChatGPT OAuth linking is a defined second phase on the same MacBook, not cloud hosting. Review the [current MVP plan](MVP_PLAN.md), [roadmap](ROADMAP.md), and [agent contract](../AGENTS.md).

## Baseline project and checks

```sh
cd /Users/test/work/patchwork/agent-staff-board
pnpm install --frozen-lockfile
pnpm generate
pnpm verify
```

To run the M1 Jazz server manually: `pnpm --filter @patchboard/server dev` (localhost:3001); browser development: `pnpm dev` (typically localhost:5173). The Playwright M1 test uses its own preview server, shared Jazz proxy and isolated fixture data. Do not claim the current default browser session is connected to the shared fixture without configuring it.

## Changed implementation decisions

| Area | Previous handoff | Current assignment |
|---|---|---|
| M1 Shared board | Build and prove two-profile collaboration | **Completed**; preserve regression coverage |
| M2 MCP client | Desktop/stdio `read_board`, `propose_note` | **Remote Streamable HTTP custom MCP for ChatGPT.com**, public HTTPS via Tailscale Funnel, `read_board` and **direct `create_note`** |
| Write behavior | Agent proposes; human approval creates the note | **Create the note immediately** in Jazz; review feature is deferred |
| Target board | User/agent identity would scope operations | One preconfigured, seeded demo board; **no per-user identity mapping** |
| Transport | Local adapter only | Dedicated localhost MCP port and new `/patchboard-mcp` route on existing HTTPS 443 without touching `/orbit-mcp` |
| Persistence | Existing Jazz sync server | Reuse the **same M1 Jazz app**, its `shapes` data model and browser subscriptions |
| Demo gate | Suggestion review and approval | ChatGPT call → MCP tool → Jazz note → two live browsers → reload persistence |
| Security | Deferred | Still deferred: OAuth, roles, sign-in, invitations, hardening; sample board only and backend secrets server-only |
| Verification | Local desktop MCP | SDK protocol smoke locally and over Funnel, M1 regression, two-profile E2E and a manual **real ChatGPT.com plugin call** |
| Schedule | 4–6 days (old desktop workflow assumption) | Re-estimate after the Jazz backend-write spike and MCP public endpoint verification |

## Reference projects on the development Mac

**Transport reference:** `/Users/test/Documents/work/cafe-mcp-live` — a tested no-auth ChatGPT remote MCP integration, `docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md`, `packages/live-mcp/server/mcp.ts`. Its existing `/orbit-mcp` route must not be reused.

**Jazz connector reference:** `/Users/test/Documents/work/jazz-tools-mcp-v2` — privileged backend Jazz 2 query and insert examples, but stdio-only transport; adapt compatible code, and do not expose generic admin operations on the public endpoint.

## Handoff criteria

Provide the actual tested URL, precise startup and fixture commands, an English implementation report, SDK test output, browser evidence and a real ChatGPT note-creation demonstration. Never report a planned route as live before it works. Keep all preexisting M1 tests passing.

The older [Patchboard-MVP-Proposal.md](Patchboard-MVP-Proposal.md) and [M1_START.md](M1_START.md) are retained for historical research and the original milestone; current M2 decisions in the architect brief take precedence.
