# Patchboard MVP implementation plan

> **Current acceptance status (21 Nov 2026):** The guest demo is implemented and isolated. Private passkey collaboration, OAuth-protected MCP and private edit/move are merged; **one real ChatGPT owner account** successfully used private MCP read/create/retry. The early **no-auth** flow described below is a historical **guest** MVP contract, not the private-board security architecture or final two-person acceptance. See [the human runbook](HUMAN_ACCEPTANCE_RUNBOOK.md) and [architecture review](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md). — ChatGPT remote MCP demo

**Current implementation assignment:** [Single-process demo acceptance](M2_DEMO_START.md#current-assignment). The original milestone description below provides background.

**Architecture handoff:** [the architect's local-first letter and explicit architecture question](ARCHITECT_LETTER_LOCAL_FIRST.md), followed by [ARCHITECT_BRIEF_CHATGPT_MCP.md](ARCHITECT_BRIEF_CHATGPT_MCP.md). **The MacBook remains the actual web, Jazz, MCP and future OAuth host in every phase.** Tailscale Funnel provides public ingress; external app hosting is not part of the plan.

**Current state:** M1 shared Jazz board is implemented; next milestone is M2 direct creation from ChatGPT.com through a no-auth remote MCP plugin. The original desktop MCP proposal + approval flow is not on the MVP critical path.

## Definition of done

From ChatGPT.com, with the Patchboard custom MCP plugin enabled, the user says “Create a note on my demo board: Prepare the customer demo.” ChatGPT invokes the remote `create_note` MCP tool through Tailscale Funnel and receives a real persisted note ID. **Two independent already-open Patchboard browser profiles display the same newly created Jazz note without manual refresh**; the note survives browser reload and Jazz persistence/restart checks. No OAuth, signup or user account mapping is required.

## Architecture and scope

- **UI:** Foldkit Model/Message/update/view with Effect commands and scoped Jazz subscriptions. Preserve M1 create, edit, move and keyboard controls. Do not replace Foldkit with React.
- **Persistence:** Jazz is the only source of truth. Existing `boards` and `shapes` schema and M1 sync/server must be reused. The MCP service must write through the same Jazz application, not directly into SQLite or a separate datastore.
- **MCP:** Official SDK Streamable HTTP service, available to ChatGPT.com as a **custom remote plugin**, not just a desktop stdio adapter. Public no-auth tool set: `read_board` and `create_note`. A dedicated new Funnel path `/patchboard-mcp` maps to a free local port. Do not change existing `/orbit-mcp` or website routes.
- **Demo routing:** A single `PATCHBOARD_DEMO_BOARD_ID` or equivalent server-configured seeded board is targeted by both tools. Without authorization, the MCP plugin **cannot know** which real Patchboard account is logged in. Per-user account linkage is a post-MVP feature.
- **Reliability:** Validate nonempty text, choose deterministic note defaults, use the installed Jazz v2 backend APIs, confirm persistence before reporting success, and exercise a repeated `request_id` for deduplication where supported. Make any known atomicity limitation explicit.
- **Credentials:** Back-end-only Jazz administrative or backend secrets, if required; never send them to ChatGPT or the browser. The no-auth public endpoint is for disposable sample data only.

## Build order and acceptance

| Step | Implementation | Required proof |
|---|---|---|
| M1 — complete | Shared Jazz server, two-browser edit and move | Preserve existing green Playwright M1 acceptance |
| M2a — spike | Use pinned Jazz v2 context/backend interface to read and insert `shapes` for the seeded board | A direct backend-inserted note appears in existing browser clients |
| M2b — service | Standalone or shared-process MCP Streamable HTTP with typed `read_board` and `create_note` | Local MCP SDK integration calls return true Jazz data |
| M2c — public endpoint | Route only `/patchboard-mcp` via Tailscale Funnel 443 | Public SDK discovery and note creation succeed without OAuth |
| M2d — real ChatGPT | Enable custom MCP plugin in ChatGPT.com and call `create_note` | Manual request creates one real note visible in both browsers and after reload |
| M4 — rehearsal | Fixture reset, startup runbook, browser reconnect, tests | Full repeatable demo plus `pnpm verify` output |
| M3 — after demo | Optional `propose_note` and human Accept/Reject | Separate roadmap item, not a direct-create requirement |

## Reference implementations

- Local `cafe-mcp-live` project and `docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md` — working custom ChatGPT no-auth Streamable HTTP / Tailscale Funnel path on this Mac. Reuse the **transport pattern**, not the unrelated CAFE UI / demo store.
- Local `jazz-tools-mcp-v2` project — schema discovery, app-scoped WebSocket context and back-end Jazz read/write examples. It is **stdio only** and may use a different alpha version; verify compatibility first.
- `apps/server/src/index.ts`, `packages/jazz-schema/schema.ts`, `apps/web/browser/shared-board.spec.ts` — Patchboard M1 server, contract and regression coverage.
- `docs/CODE_REFERENCES.md` — pinned broader Jazz research and examples.

## Engineering process and security scope

Use the existing CAFE-style red/green TDD workflow, named Effect operations, browser-safe contracts, schema generation and lint/typecheck/Story/Scene/Jazz/Playwright gates. Keep M1's test fixtures separate from any public demonstration. Documentation and discussions with the architect are in **English**.

Security-specific work is deferred: OAuth, identity proof, invitations, revocation, roles, multi-tenant isolation, permission audit, abuse controls and production hardening. The demo does not need these to pass. Do not expose open generic admin/data tools or place actual user data on the publicly reachable no-auth endpoint.

## Product backlog after the MVP

Review-driven agent suggestions (historical M3), assignment/status, Kanban, comments, presence, checkpoints and richer canvas shapes remain post-demo decisions. **Self-hosted user registration, roles, account-to-board linking, and ChatGPT MCP OAuth are explicitly planned for the next phase** and must be supported by clean domain boundaries. **No external application hosting is planned in any phase.**
