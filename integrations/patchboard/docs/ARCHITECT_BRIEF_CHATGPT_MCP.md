# Architect brief — ChatGPT-to-Patchboard live MCP demo

**Current implementation assignment:** [Single-process demo acceptance](M2_DEMO_START.md#current-assignment). The original milestone description below provides background.

**Date:** 2026-11-20  
**Priority:** P0, next implementation milestone after the completed M1 shared-board milestone  
**Target repository:** `/Users/test/work/patchwork/agent-staff-board` — `drunkod/agent-staff-board`  
**Audience / communication:** Architect and developer discussions, plans, issues, PRs and implementation reports must be **in English**.

**Non-negotiable permanent deployment constraint and architectural question:** Read [the letter to the architect](ARCHITECT_LETTER_LOCAL_FIRST.md) first. The web UI, Jazz sync and durable storage, MCP, and future registration/roles/OAuth server all run on the owner's MacBook. The application is exposed through Tailscale Funnel, with **no external application hosting in either phase**. The architect must explicitly recommend the fastest implementation that keeps authentication and multi-board extension straightforward.

## 1. Decision and objective

Deliver the shortest functional end-to-end demo: **a user asks ChatGPT.com to create a note, the connected custom Patchboard MCP plugin invokes `create_note`, the note is persisted in Jazz, appears on the already open Patchboard board in real time in two browsers, and remains after both reload.**

This is a **ChatGPT custom remote MCP server** reachable via public HTTPS, **not** a local desktop/stdio-only MCP client. The **first demo has no OAuth and no per-user Patchboard login/account mapping**. The MCP service targets **one known seeded demo board** by server-side configuration. Authentication, authorization hardening, invitations, roles and account linking are expressly post-MVP. Use disposable demo data only.

**Product decision vs old roadmap:** A new note is created **directly**, without requiring Accept/Reject. The older `read_board`/`propose_note` and human-review feature remains an optional, separate *post-demo* product workflow and is not a dependency or acceptance gate for this demo. Do not conflate the two flows.

## 2. Confirmed starting point and reference implementations

- **Patchboard M1 implemented, pushed:** `0175b2c` and `64a82f2`, shared Jazz SQLite sync server at `apps/server/src/index.ts`, browser editor, two independent browser-context test for edit/move/reconnect/reload, `shapes` Jazz table in `packages/jazz-schema/schema.ts`. The repository's documented checks include `pnpm verify`. Treat M1 as a baseline, not an assignment to rebuild.
- **Working no-auth ChatGPT MCP reference (18 Nov):** `/Users/test/Documents/work/cafe-mcp-live/docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md`; `packages/live-mcp/server/mcp.ts` and `server/index.ts`. Official MCP TypeScript SDK, stateless Streamable HTTP, a no-auth public `/mcp` route, and a Tailscale Funnel HTTPS 443 path. This reference demonstrably works with a ChatGPT custom MCP plugin, but its tools edit a CAFE demo and **do not** implement Jazz note creation.
- **Existing Jazz v2 data connector reference:** `/Users/test/Documents/work/jazz-tools-mcp-v2`, especially `src/connector.ts`, `src/server.ts`, `README.md`. It uses Jazz v2 app-scoped schema discovery and WebSocket backend context; it runs MCP over **stdio**, and generic writes are gated off by default. Reuse the Jazz connector ideas **only after validating compatibility** with Patchboard's pinned Jazz `2.0.0-alpha.69` and the M1 server.
- **Current Tailscale routes, previously verified:** `https://tests-macbook-air.tail70b8a.ts.net/orbit-mcp` is the other project's MCP. HTTPS 443 root proxies to port 3000, 10000 to the other demo. **Do not modify, overwrite or reset those existing routes.**
- Development conventions remain anchored to `AGENTS.md`, `docs/DEVELOPMENT_CYCLE.md` and the CAFE `AGENTS.md`/README reference. Preserve Foldkit + Effect + Jazz; no React or second database.

## 3. Intended end-to-end architecture

```text
User in ChatGPT.com (Patchboard custom MCP plugin enabled)
       |
       | HTTPS Streamable HTTP, no OAuth
       v
Tailscale Funnel HTTPS 443 /patchboard-mcp   [new path]
       |
       v
127.0.0.1:<MCP_PORT>/mcp                    [new isolated service, e.g. port 8791]
       |
       v
Patchboard MCP tools: read_board, create_note
       |
       | typed, server-side Jazz v2 API / context
       v
Existing M1 Jazz server at 127.0.0.1:3001/jazz
       |
       v
Existing Jazz app / boards + shapes tables / SQLite durability
       |
       +------> Open browser A and browser B via existing Jazz subscriptions
                 |
                 +----> Note appears without refresh, remains after restart/reload
```

The diagram is the intended topology, **not an already verified running Patchboard MCP service**. The architect must validate that the existing `createJazz` server can accept the backend context used by the adapter. Prefer a dedicated `apps/mcp` package on a separate local port. If the pinned Jazz SDK makes a shared in-process adapter substantially simpler, mounting MCP in `apps/server` is acceptable, provided it does not create a second SQLite store or disrupt Jazz's `/jazz` route. The MCP writes must pass through the **same Jazz app and sync layer** as the UI. **Do not** write directly to the SQLite file, use browser automation to create notes, or add a JSON/SQL business-data store.

One early technical spike must establish and document: the correct Jazz app ID / runtime credentials or server-owned context; schema availability and compatibility; board fixture ID; whether a backend write reaches the existing clients; and the achieved remote durability tier. Never publish admin/backend credentials inside ChatGPT tool descriptions, HTTP responses, web bundles or Git commits.

## 4. Minimum MCP contract

Expose only the following domain-specific public tools initially (no unrestricted `jazz_insert`, `jazz_update`, `jazz_delete`, arbitrary SQL, permissions changes or code execution):

### `read_board`
Input: none for the single-board demo. Read the server-configured demo board.  
Result: `{ board_id, title, notes: [{ id, text, x, y }] }` (reasonable result-size bound). Use Jazz `boards` + `shapes`, returning note shapes only.

### `create_note`
Input: `{ text: string, x?: number, y?: number, request_id?: string }`. Text must be nonempty; default position chosen by server and documented. `request_id` enables retries for the same logical operation.  
Effect: create `shapes` row with `boardId` fixed by configuration, `kind: "note"`, `text`, `x`, `y`, `width`, `height`, `fill`, `zIndex` conforming to the current schema. Match the UI's default note size / colors rather than inventing a different model. Use the installed Jazz API and wait for a durability tier that survives browser reload and server restart.  
Result: `{ ok: true, board_id, note_id, text, x, y, persisted: true }` only **after successful persistence**; otherwise return a useful MCP error, not a false success. If repeat calls supply the same request ID, aim for one created note and one returned note ID; use Jazz data (not a new store) for any deduplication. Document any transaction/uniqueness limitation honestly and test it.

The single demo board ID is configured **server-side** (e.g. `PATCHBOARD_DEMO_BOARD_ID`), not guessed from a ChatGPT identity or an arbitrary user-selected board. If it is not seeded, fail explicitly with a fixture-setup error. Neither tool may claim to know the current logged-in Patchboard user.

## 5. Transport and Tailscale runbook

Implement the public MCP endpoint using official `@modelcontextprotocol/sdk` Streamable HTTP; prefer the same stateless transport approach in `cafe-mcp-live/packages/live-mcp/server/mcp.ts`. Add a separate local health route and an SDK-based smoke test that performs `initialize`, `tools/list` and `tools/call`.

First validate the adapter locally at `http://127.0.0.1:<MCP_PORT>/mcp`, then add a **new path** to HTTPS 443:

```bash
tailscale funnel status
tailscale funnel --bg --https=443 --set-path=/patchboard-mcp http://127.0.0.1:<MCP_PORT>/mcp
tailscale funnel status
```

The intended ChatGPT custom MCP URL on this development machine is:

```text
https://tests-macbook-air.tail70b8a.ts.net/patchboard-mcp
```

This is a **planned route**, not a verified live endpoint. Confirm the real path/hostname after configuration. Do **not** call `tailscale funnel reset`, reuse `/orbit-mcp`, or replace the root 443 listener. Choose a free new port; confirm no port collision. A bare GET to a Streamable HTTP `/mcp` may correctly return HTTP 406; validate via the MCP SDK, not by treating a browser GET as the only health check.

In ChatGPT, navigate to its custom MCP plugin/server creation UI, enter the verified HTTPS URL and select the available **no authentication** option (previous UI referred to “OAuth or no authentication”). Plugin creation or availability may depend on the ChatGPT workspace/account; if unavailable, this is not evidence that the local MCP server is broken. The final manual acceptance must nevertheless include a **real ChatGPT.com plugin call**, not only a custom client smoke test.

## 6. Implementation work packages (TDD / CAFE development cycle)

1. **Spike / fixture:** inspect M1 schema and server; seed or reuse exactly one demo board; verify backend-write compatibility with the existing Jazz instance. Record concrete working commands and configuration (without secrets).
2. **Contract-first tests:** write a failing MCP transport + `read_board` + `create_note` integration test against the real local Jazz runtime. Include invalid text and missing fixture cases. Do not mock away the data boundary in the acceptance test.
3. **Domain implementation:** write thin, typed MCP handlers delegating to named Effect/Jazz operations; reuse existing shape defaults and schemas. Test persistence, idempotency with a repeated `request_id`, and real-time visibility.
4. **Public endpoint:** run MCP on a free local port; create `/patchboard-mcp` Funnel route; test `tools/list` and `create_note` over public HTTPS with an SDK client.
5. **Browser E2E:** open two independent browsers on the same M1 fixture, invoke MCP from an external client, assert the note appears in both without reload, then restart/reload and verify persistent text and position. Preserve existing M1 tests.
6. **ChatGPT demo:** connect the Patchboard custom MCP plugin using no auth. Ask: **“Use Patchboard to create a note on my demo board: Prepare the customer demo.”** Verify the plugin executed `create_note` and the same new note is visible on the running board. Capture instructions and reproducible evidence.
7. **Quality and report:** run `pnpm verify` (or explain clearly if an environment-dependent gate cannot run), ensure existing Story/Scene/Jazz/Playwright checks remain green, provide changeset, runbook, known gaps and final URLs. Follow small red/green PR discipline from `AGENTS.md`.

## 7. Hard acceptance criteria

- Real **ChatGPT.com custom MCP plugin**, **no OAuth**, calls a live remote `create_note` tool via **Tailscale Funnel**.
- The tool writes to the **existing M1 Jazz schema/store**, not a parallel store, and returns its real `note_id`.
- Both independently open browser profiles see the note on the same board without manual refresh.
- After both browser reloads and the appropriate Jazz persistence/restart check, the note still exists.
- Public MCP endpoint exposes a **small domain-scoped tool set** only; no admin power exposed through tools.
- Existing M1 behavior and automated verification remain functional.
- The repo contains an English startup and troubleshooting runbook, with all concrete URLs labelled tested or planned.

## 8. Not required for this MVP

OAuth, sign-up/sign-in, SSO, user-to-board account mapping, multi-tenant isolation, invitation/revocation, formal roles enforcement, rate limits, security audit, hardened production deployment, hosted cloud release, agent proposal review/approval, Kanban, presence and comments. Do not introduce any of these as a dependency that prevents the demo.

**Minimal operational boundary:** the no-auth Funnel URL is publicly reachable, even outside the tailnet. Restrict this experiment to a disposable board, narrow tool surface, local-only backend credentials and non-sensitive data. Authentication security engineering stays in the post-MVP backlog.

## 9. Expected deliverables

- MCP service source and tests in `agent-staff-board`, compatible with the pinned dependency set.
- Reproducible demo fixture and startup commands for the Jazz server, Patchboard UI and MCP.
- Working dedicated Funnel route; verified no-auth ChatGPT plugin connection.
- Automated SDK + two-browser integration evidence and a manual ChatGPT-to-board demonstration.
- Updated `docs/ROADMAP.md`, `docs/MVP_PLAN.md`, `AGENTS.md`, `README.md` and a clear implementation report **in English**.

**Architect instruction:** Execute the direct-create path first and make the MacBook web UI + Jazz WebSocket publicly reachable through Funnel as well as MCP. Do not spend the **first-demo** cycle implementing OAuth, generic Jazz admin tools or proposal review. **However, plan a subsequent, still MacBook-hosted implementation of registration, account mapping, roles and ChatGPT MCP OAuth, with minimal stable extension points created now.** Answer the question in [the architect letter](ARCHITECT_LETTER_LOCAL_FIRST.md): what is the fastest path today that remains architecturally correct and extensible? Explicitly state which acceptance criteria are verified and which still require testing.
