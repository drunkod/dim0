# Letter to the Patchboard Architect — local-first architecture, Tailscale Funnel, and future authentication

**Date:** 20 November 2026  
**Subject:** Mandatory MacBook self-hosting constraint and request for the fastest extensible architecture

Dear Architect,

Please treat the following as the **non-negotiable product and infrastructure constraint** for Patchboard:

**The entire Patchboard application must be hosted on my own MacBook, with no external application hosting.** This applies both to our first MVP/demo and to the later stages in which we add user registration, roles, account linking, and OAuth for the ChatGPT.com MCP integration. We are not planning to deploy the application backend, frontend, Jazz server, or MCP service to a VPS, Cloudflare Worker, managed application host, or third-party database.

The MacBook should serve the **Patchboard web application**, **Jazz sync and locally durable SQLite data**, **our remote MCP HTTP server**, and, when implemented, **registration/login, user and board permissions, and the OAuth authorization endpoints**. External browsers and ChatGPT.com reach the MacBook over **public HTTPS via Tailscale Funnel**. Tailscale Funnel is our connectivity/tunnel layer, not application hosting. We accept that the service is unavailable when the MacBook is offline, asleep, or the processes are stopped. The architecture must make it practical to start, stop, and recover the complete stack locally.

## What already exists

- Repository: `/Users/test/work/patchwork/agent-staff-board` (GitHub `drunkod/agent-staff-board`).
- **M1 shared board is already implemented and pushed**: existing local Jazz server, SQLite persistence, and collaborative notes tested in two browser profiles. Preserve this implementation.
- **Working reference:** `/Users/test/Documents/work/cafe-mcp-live`, especially `docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md` and `packages/live-mcp/server/mcp.ts`. This project has demonstrated a **no-auth ChatGPT.com custom MCP plugin** reached through a public Tailscale Funnel URL on the same MacBook.
- **Jazz backend reference:** `/Users/test/Documents/work/jazz-tools-mcp-v2`. Reuse its compatible Jazz v2 adapter ideas, but note that its existing transport is stdio and its generic admin tools are not appropriate for the public demo MCP interface.
- Existing Tailscale Funnel routes already serve other applications, including `/orbit-mcp`; **do not overwrite the existing root, reset Funnel, or reassign somebody else's path/port**.

## Mandatory development methodology — Effect TS, Foldkit and CAFE (21 November clarification)

**This is a binding architectural and implementation requirement, not optional background reading.** The architect, developers and coding agents **must** follow the repository's existing [CAFE development cycle](DEVELOPMENT_CYCLE.md), [root development contract](../AGENTS.md), and [pinned code examples](CODE_REFERENCES.md) for every new component or material refactor. Apply the version-specific [Effect TS 4 practices](EFFECT_TS_PRACTICES.md) in addition to the original rules. Do not substitute React, a second application state manager or an ad-hoc Promise/SQLite architecture for our existing Foldkit + Effect + Jazz design.

In particular, the proposed ADR, implementation plan and pull requests **must** demonstrate:

1. **Test first, then prove it live.** Start from one observable failing assertion; change the smallest coherent behavior; show the passing Story (pure Model/Command), Scene (rendered interaction), Jazz permission/durability, MCP/OAuth protocol and independent-browser evidence as appropriate. Run `pnpm verify` and, for private OAuth changes, the separate `pnpm test:private:ci` suite. Record the exact tested revision and any unverified manual acceptance.
2. **Pure Foldkit UI, Effectful domain.** Keep `update` and `view` pure, state and messages typed, writes in Commands, named business operations in `Effect.fn("Domain.operation")`, and Jazz reads in scoped Effect Streams/managed subscriptions. Prefer `Effect.gen` for domain orchestration and avoid launching Effects deep inside reusable domain code.
3. **Typed boundaries and explicit dependencies.** Validate all untrusted inputs; distinguish recoverable typed errors from unexpected defects. Use service interfaces and Layers where dependencies cross architectural boundaries, with real and test implementations. Keep browser-safe contracts separate from Node-only adapters and credentials.
4. **Safe lifecycle, concurrency and security.** Define acquisition/cleanup for WebSockets, subscriptions and sessions; use bounded fan-out and deliberate, idempotent retries. Preserve private Jazz's read-only browser policy, server-checked board membership, OAuth scope/consent and original note authorship. Never “fix” an authorization error by broadening database permissions.
5. **Pinned compatibility and review.** Target the **installed Effect 4.0.0** / TypeScript 7 / Foldkit 0.165.0 / Jazz 2 alpha APIs. Check current installed types and official **Effect 4** references, not Effect 3 snippets. Use isolated worktrees and fixtures, preserve local Funnel routes/data, and document any necessary exception in English with evidence before approval.

The Effect-specific additions are sourced from the [official Effect 4 guides](EFFECT_TS_PRACTICES.md#official-upstream-references-checked-21-nov-2026); the **original project policy remains authoritative**. The letter's historical phase descriptions below are retained as a design record, not a claim that already shipped private OAuth work is still pending. Any architecture proposal that conflicts with these requirements must explicitly explain the exception, alternatives, risks and verification plan before implementation.

## Requested delivery sequence

**Phase A — fast working demo (highest immediate priority).** Locally serve a Patchboard web URL that people can open from outside the MacBook, including its **real-time Jazz WebSocket sync**. At the same time, serve a dedicated no-auth custom MCP endpoint reachable from ChatGPT.com through Tailscale Funnel, with `read_board` and **direct `create_note`** tools. For this first demonstration the MCP server can target one seeded sample board by server-side configuration, with no OAuth or per-user account mapping. A ChatGPT plugin call must create an actual Jazz note visible to two already-open browsers and surviving reload and a restart. Use only disposable demonstration data and keep backend secrets local. Do not make the old proposal/approval flow a blocker.

**Phase B — user accounts and ChatGPT linking, still self-hosted on the MacBook.** Add registration, login, roles, memberships/permissions and a way for a user to connect their ChatGPT.com MCP plugin to **their own Patchboard account and authorized board**. The MCP connection should support the OAuth flow expected by ChatGPT's MCP integration, with an authorization endpoint, redirect/callback handling, tokens, and stable account-to-board identity mapping, **all implemented by the locally running Patchboard backend and exposed via Tailscale Funnel where needed**. These features are deferred from the *initial demo*, but they are an explicit requirement for the subsequent product, not something to drop. The initial implementation must leave clean extension points for them; avoid hard-coding the sample-board assumption throughout the domain layer.

**Phase C — scalable product features.** Expand boards, agents, collaborative workflows and access control using the same domain services and Jazz data model. Our **chosen deployment for these stages is still the MacBook**, even if the design keeps environment-independent interfaces so that hosting could be reconsidered only after a separate explicit decision. Do not introduce cloud services as implicit dependencies.

## The main architectural question — please answer explicitly

**What is the quickest and simplest way to implement this now, while keeping it architecturally sound and easy to extend later?**

In your answer, please evaluate at least **two concrete implementation approaches** and **recommend one**, based on the code we already have rather than an abstract greenfield design:

1. Should we host the static web app, Jazz sync, MCP Streamable HTTP and future OAuth endpoints behind a **single local HTTP gateway/origin**, or is it faster and safer to keep independently running local services and publish separate, non-conflicting Funnel paths/ports?
2. How should we make **both the public board UI and the Jazz WebSocket endpoint** work through Funnel without breaking current Tailscale routes, and without relying on `localhost` URLs inside remote users' browsers? Please propose the URL/path layout, reverse-proxy handling, headers, WebSocket upgrades, and a repeatable MacBook startup command.
3. How do we implement the **demo's fixed-board MCP service** as a thin adapter over Jazz/domain operations so the later **OAuth identity → Patchboard user → board permissions** path can be added without rewriting those tools or the existing Foldkit UI?
4. What is the simplest realistic **self-hosted authentication/OAuth** strategy for the subsequent stage (registration, roles, account-linking and ChatGPT MCP authorization)? Which minimal interfaces, schema fields and endpoints should be designed now, and which can safely be implemented only after the demo?
5. Which parts of `cafe-mcp-live` can be reused almost verbatim, and what specifically must be adapted for the Patchboard Foldkit + Effect + Jazz stack?
6. What are the **smallest implementation steps, first working proof, test plan, and estimated effort**? Identify concrete files/modules to change, risks specific to Jazz alpha compatibility, and any browser/MCP constraints.

**Required output:** a short Architecture Decision Record (ADR) comparing options, a recommended topology and component boundaries, an ordered implementation plan with tests and acceptance gates, the exact intended public URL/path map, and a separate list of minimal demo features vs. postponed account/OAuth features. Explicitly explain why the chosen approach is the **fastest route to the working demo without creating migration or extension debt**.

You **must follow** `AGENTS.md`, `docs/DEVELOPMENT_CYCLE.md` and `docs/EFFECT_TS_PRACTICES.md` as mandatory review criteria, communicate in **English**, and distinguish *already tested*, *planned*, and *not yet verified* capabilities. Do not claim the public Patchboard URL, remote MCP endpoint, or OAuth integration are live until tested end to end.

Best regards,  
Patchboard product owner
