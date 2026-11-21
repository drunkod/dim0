# M2 START — ChatGPT remote MCP to Jazz note creation

**Current implementation assignment:** [Single-process demo acceptance](M2_DEMO_START.md#current-assignment). The original milestone description below provides background.

**Audience:** Patchboard architect and implementation engineer (**English only**).  
**Authoritative specification:** [ARCHITECT_BRIEF_CHATGPT_MCP.md](ARCHITECT_BRIEF_CHATGPT_MCP.md), plus [the MacBook-only hosting letter and architect's decision question](ARCHITECT_LETTER_LOCAL_FIRST.md). The public **Patchboard web UI AND Jazz WebSocket sync** must also be reachable through Funnel, not only the MCP endpoint. Preserve clean future extension points for user accounts, roles, account mapping and OAuth without deploying them as a blocker for this initial demo.  
**Prerequisite M1:** complete (`0175b2c`, `64a82f2`).

## Assignment

Implement a **custom remote MCP server usable by ChatGPT.com**, hosted on the development Mac with **no OAuth**, exposed over **Tailscale Funnel** at a new `/patchboard-mcp` path, using Jazz as the only persistence and synchronization layer. `create_note` must create a real note directly, not a proposal requiring approval.

## First red test

Using the official MCP SDK, call `create_note({ text: "Created by ChatGPT demo", request_id: "m2-sample-1" })` against the service (initially locally). Before the code exists, the test must fail for tool discovery or creation. Once implemented, assert:

- The response includes a real note ID and the seeded board ID.
- The `shapes` table of the **existing** Jazz M1 app has one note with the expected text.
- Two independent browser profiles already viewing the shared board render the note without a page refresh.
- Reload both browsers and confirm the exact note is still visible.
- Repeating the same `request_id` returns the same result where the installed Jazz API can support reliable deduplication; document any non-atomic limitation.

## Technical starting points

1. Inspect `apps/server/src/index.ts`, `packages/jazz-schema/schema.ts` and `apps/web/browser/shared-board.spec.ts`. Establish how a server-owned Jazz context can create a note visible on the existing app sync connection. Do not write SQLite directly.
2. Study `/Users/test/Documents/work/jazz-tools-mcp-v2/src/connector.ts` for Jazz 2 backend context API patterns; check version compatibility. It is **stdio only** and exposes generic high-privilege writes, so do not mount it publicly as-is.
3. Study `/Users/test/Documents/work/cafe-mcp-live/packages/live-mcp/server/mcp.ts` and `docs/CHATGPT_MCP_NOAUTH_TAILSCALE.md` for the **verified** stateless Streamable HTTP no-auth transport and ChatGPT plugin runbook. Its data model and `/orbit-mcp` route are not part of Patchboard.
4. Add a dedicated Patchboard MCP service/port, e.g. `apps/mcp` at localhost:8791 (only if available); expose `read_board` and `create_note` with validated inputs and typed outputs. Fixed server-side seeded board ID; no user login inference or OAuth.
5. Validate local tools using the official MCP SDK, then add exactly one new Tailscale 443 path: `/patchboard-mcp`. Never reset Funnel or alter the existing `/orbit-mcp` or root 443 routes.
6. Validate an MCP SDK call through public HTTPS, then connect the **actual ChatGPT.com custom MCP plugin** in no-auth mode and create a note. Save exact tested URL and results.
7. Run `pnpm verify`, document all commands and submit English evidence of tests, two-browser live updates and reload persistence.

## Required exclusions

Do not add OAuth, sign-up, invitation workflows, permission hardening or human Accept/Reject gates. Do not expose generic database mutation/admin/Inspector tools. Use sample-only board content because Funnel is reachable on the public internet. Keep backend secrets server-only.

**Definition of done:** “Create a note on my demo board” in ChatGPT.com makes one durable note appear on the Patchboard board in two open browsers without refreshing.
