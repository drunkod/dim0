# Patchboard implementation roadmap

> **Active release decision, 21 Nov 2026:** `main` at `6f36a35` includes guest MCP, private passkey collaboration, protected OAuth MCP and authorized private edit/move. **One real ChatGPT OAuth account** has performed a private-board read, create and idempotent retry. The two-human demo and off-tailnet phone gates **remain open**. The milestone language below (e.g. M2 “NEXT”, OAuth “defer”) is **historical**, retained for rationale, not the current implementation status. Start with [the up-to-date human runbook](HUMAN_ACCEPTANCE_RUNBOOK.md) and [architecture/commit review with diagrams](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md).

**OAuth discovery P1 (21 Nov) — PASS through public HTTPS:** The standard path `/.well-known/oauth-authorization-server/patchboard-auth` now returns HTTP 200 from a narrowly scoped Funnel mount. The official MCP SDK/browser suite started with only the MCP URL, discovered RFC 9728 and RFC 8414 metadata, completed passkey + PKCE, board-scoped author writes, live WebSocket 101, and exact-ID/author persistence after staging restart. [Full public proof, timestamps, backup and routing](PRIVATE_OAUTH_PUBLIC_FUNNEL_QA.md). **Still pending:** an off-tailnet independent browser and two actual ChatGPT.com accounts/redirect grants.


**Two-writer verification (21 Nov):** PR #6 and PR #5 have passing CI. A three-profile OAuth acceptance test also passed through the public Tailscale HTTPS hostname after 8794 was upgraded to commit `943d40d`: board-scoped grants, owner/editor separate author IDs despite shared request ID, viewer denial, live WSS HTTP 101 and exact-ID author persistence after restart. [Detailed evidence and staging backup](PRIVATE_OAUTH_PUBLIC_FUNNEL_QA.md). **Still pending:** a browser independently outside the tailnet, and two real ChatGPT.com connector calls with the client's actual OAuth redirect URI.


**Private OAuth HTTPS staging (20 November):** [Public-Funnel runbook and tested OAuth/Jazz acceptance](PRIVATE_OAUTH_PUBLIC_FUNNEL_QA.md). A disposable MacBook-owned store on port 8794 was exposed via four narrowly scoped Funnel mounts. Real HTTPS PKCE and consent, protected MCP write, an invited viewer denied write, two subscribed browsers with WSS HTTP 101, and exact-ID restart have passed. **No off-tailnet device or real ChatGPT.com plugin call has been verified; no existing 8792 private user data was exposed.**

**Private OAuth MCP, local QA (20 Nov):** [Implementation, OAuth acceptance evidence and outstanding public-release gates](PRIVATE_OAUTH_MCP_CHECKPOINT.md). Passkey-confirmed OAuth Authorization Code + PKCE, scoped private board MCP tools and live Jazz note creation are proven in isolated local QA. Public OAuth ingress and a real ChatGPT connection remain pending.

**Reference architecture added 20 November 2026:** [Teable code study and staged adoption roadmap](TEABLE_ADOPTION_ROADMAP.md), covering teableio/teable and teableio/teable-mcp, OAuth/PKCE, scoped MCP tools, authorized collaboration/presence, views, history, undo, import/export and future automation. This plan supersedes the historical *defer OAuth* note below for the new private-board development track; the guest demo track remains isolated and unchanged.

**Active private-collaboration assignment (20 November):** [Architect programmer plan](PRIVATE_COLLABORATION_PLAN.md) and [verified browser checkpoint](PRIVATE_COLLABORATION_CHECKPOINT.md). Four passkey browser roles (owner, editor, viewer, outsider), private Jazz denial, invite redemption, author attribution and exact-ID restart are now demonstrated locally on an isolated 8792 instance. Private OAuth + ChatGPT and public private-board ingress are NOT delivered. The original M2/M4 roadmap below is historical and continues to govern only the disposable, unauthenticated guest demonstration on 8791. [Public guest release runbook](M2_PUBLIC_FUNNEL_RELEASE.md).

**Current status (20 Nov 2026):** M1 shared board **implemented** and pushed in commits `0175b2c` and `64a82f2`. **Next priority: M2 — remote no-auth ChatGPT MCP direct note creation.**

**Start here:** [English architect letter and architecture choice question](ARCHITECT_LETTER_LOCAL_FIRST.md), then [MCP acceptance contract](ARCHITECT_BRIEF_CHATGPT_MCP.md). **Permanent deployment constraint: all Patchboard services (including future auth/OAuth) are self-hosted on the MacBook, exposed by Tailscale Funnel; no third-party application hosting.** The prior desktop-stdio `propose_note` path is **superseded for the first demonstration**. A working ChatGPT.com plugin + Tailscale Funnel + direct Jazz note creation is the release gate.

## Release sequence

| Milestone | Scope | Evidence required |
|---|---|---|
| **M1 · Shared board — DONE** | Existing local Jazz SQLite runtime, two independently open browser profiles, shared create/edit/move, durable reload/reconnect. | M1 Playwright acceptance previously passed; preserve this regression test. |
| **M2 · ChatGPT remote MCP direct create — NEXT / P0** | Implement no-auth Streamable HTTP MCP (`read_board`, `create_note`) against the exact same Jazz app and one seeded board. Publish a dedicated HTTPS 443 `/patchboard-mcp` route via Tailscale Funnel, without modifying other routes. Connect the actual ChatGPT.com custom MCP plugin. | ChatGPT says “create a note”, the plugin invokes `create_note`, two browsers show it immediately and retain it after reload. An SDK test must independently exercise the public MCP URL. |
| **M4 · Repeatable demo — P0** | Single-board fixture, documented startup/health/runbook, isolated tests, cold start, reconnect, two-browser evidence and a complete ChatGPT-to-Jazz-to-UI walkthrough. | Fresh sample fixture supports repeatable demonstration; relevant Story/Scene/Jazz/Playwright gates pass. |
| **M3 · Proposal/review workflow — POST-DEMO OPTIONAL** | `propose_note`, pending proposals, Accept/Reject, exactly-once approval, reviewer attribution. Keep design work available, but do not require this to create an immediate note through ChatGPT. | Schedule separately after the direct-create demo, if user review is valuable. |

Milestone numbering retains the historic IDs to avoid breaking references; **execution order for MVP is M1 → M2 → M4**, with M3 optional after the demo.

## M2 implementation checkpoints

1. Inspect M1's `apps/server` Jazz runtime and `packages/jazz-schema/schema.ts`. Establish a server-owned Jazz v2 write path into the same app; validate it against installed pinned versions before adding MCP transport.
2. Seed/configure a single board ID (backend config, not inferred from a user's ChatGPT/Patchboard login). Use fixed-size note defaults matching the Foldkit UI.
3. Add contract-first integration tests and small domain-specific `read_board`/`create_note` tools using the official MCP SDK's stateless Streamable HTTP transport. Avoid exposing generic database/admin methods.
4. Run MCP on a dedicated localhost port; add only `/patchboard-mcp` on public HTTPS 443 via Tailscale Funnel. Verify with an MCP SDK client, not a plain GET request.
5. Validate both independent browsers receive and persist a new note via actual Jazz synchronization.
6. Set up and manually exercise the **real ChatGPT.com custom MCP plugin without OAuth**; record exact working URL and visible outcome.
7. Run `pnpm verify`, update the English runbook, attach test and demo evidence.

## Reference projects already present on the development Mac

- `/Users/test/Documents/work/cafe-mcp-live` — **verified no-auth remote MCP + Tailscale Funnel** implementation. See `docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md` and `packages/live-mcp/server/mcp.ts`. The existing `/orbit-mcp` path belongs to that project; do not reuse it.
- `/Users/test/Documents/work/jazz-tools-mcp-v2` — **Jazz 2 backend connector** and schema discovery/query/write examples. This is a stdio MCP adapter and **not** a finished Patchboard remote server; adapt only compatible parts.
- `/Users/test/work/patchwork/agent-staff-board` — authoritative Patchboard implementation and M1 baseline.

## MVP prioritization

**Defer security engineering** — OAuth, logins, account linkage, invitations, revocation, multi-user authorization, role hardening, security audit, rate limiting and hosted production hardening are **not** launch blockers for this sample-data demo. A public unauthenticated endpoint does not determine which Patchboard account the user is signed in to, so the demo explicitly uses a fixed board. Keep all sensitive credentials server-only and never use actual private/user data on the public demo route.

**Defer optional product features** — proposal review, assignments/status, Kanban, comments, presence, checkpoints and canvas resizing. **External hosting is not a deferred milestone: it is explicitly excluded from the chosen MacBook-first and future operating model.** After the first demo, plan **self-hosted registration, roles, user-to-board account linking and ChatGPT-compatible OAuth** as a separate phase; see [the architect's letter](ARCHITECT_LETTER_LOCAL_FIRST.md). Focus M2 on direct note creation, publicly accessible board UI, Jazz synchronization, and demo reliability.

Any earlier 4–6-day estimate assumed a desktop stdio client and is no longer a reliable estimate. Re-estimate after the Jazz backend-write spike and the public MCP SDK smoke test.

## Developer process

Read `AGENTS.md` and `docs/DEVELOPMENT_CYCLE.md`. Use one failing test per behavior, implement the smallest change, run Story/Scene/Jazz integration/Playwright tests, record working behavior, and report in **English**. Never describe the planned Funnel endpoint or ChatGPT plugin as live until verified.
