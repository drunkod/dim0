# Sprint 2 acceptance — Dim0 Canvas ↔ Jazz ↔ MCP

Date: 2026-11-21. This is a **working MVP prototype**, not a complete Dim0 database migration.

## What is running

- **Local:** http://localhost:5178/jazz-signin (Vite on 5178, Better Auth + Jazz on loopback 8798).
- **Temporary public HTTPS:** the hostname in `/tmp/dim0-jazz-mvp-cloudflared.log` via Cloudflare Quick Tunnel, linked to a separate production-like Vite preview on 5180 and an isolated private Jazz server on 8800.
- **MCP OAuth resource:** `<PUBLIC_ORIGIN>/patchboard-private-mcp`. The issuer and scopes are dynamically discovered via RFC 9728 / RFC 8414. The client must authorize the **new** Jazz board; the old connected Patchboard QA board is not the fork prototype.
- Existing Tailscale Funnel routes and original Dim0 `main` were **not changed**.

## Real acceptance evidence

1. `node --test webui/src/features/board/jazz/jazz-canvas-api.test.mjs` — 9/9.
2. `pnpm -C integrations/patchboard --filter @patchboard/server typecheck` — passed.
3. `pnpm -C integrations/patchboard --filter @patchboard/server exec tsx --test test/canvas-entity.test.mjs` — passed, including 32-character Dim0 IDs round-tripped with canonical Jazz storage UUIDs.
4. Authenticated SSE contract tests — 3/3.
5. `npm --prefix webui run type-check` — passed.
6. Chromium `pnpm --filter @patchboard/web exec node test/dim0-jazz-local-mvp-proof.mjs`: passkey signup, Jazz board creation, remote entity rendered in actual Canvas, local mouse-created text node persisted, independent invited viewer sees updates without reload, and reload retains IDs and payloads. Verified against both localhost and HTTPS temporary preview.
7. `pnpm -C integrations/patchboard test:private:ci` — `PRIVATE_CI_ACCEPTANCE_PASS`, including OAuth MCP canvas CRUD, roles, multi-browser Jazz live updates, and restart attribution. Public-tunnel OAuth SDK discovery, PKCE consent, and MCP canvas create/get/update/delete/conflict tools were also independently verified.

## Run locally from a checked-out fork

First install dependencies in the corresponding subprojects, then:

```sh
cd /Users/test/work/patchwork/dim0-jazz-port
./scripts/run-jazz-mvp-local.sh
```

Open **http://localhost:5178/jazz-signin**. Create a private passkey account, return to that page and select **Create Jazz board**. To reopen, use the recent-board link or paste the Jazz board UUID. The browser URL is `/boards/<JAZZ_BOARD_UUID>`.

To connect ChatGPT to the temporary HTTPS prototype, create/reconnect a custom MCP app pointing to `<PUBLIC_ORIGIN>/patchboard-private-mcp`, approve the OAuth flow and **select the specific Jazz board**. Reusing the already-installed QA-board OAuth grant does not grant this new board.

## Architecture limits (not release blockers for this MVP)

- Native Jazz `Db.subscribe` drives an authenticated SSE endpoint. Initial REST hydration and a 1.5s bounded fallback poll keep clients responsive behind edge proxies that buffer SSE.
- Canvas edits are optimistic versioned transactions with fail-closed conflicts, **not** a durable offline queue or CRDT rebase. Offline edits and collisions require a later sprint.
- Nested folders, cross-layer operations, full agent headless persistence, applet execution isolation, uploads, documents, board metadata, chat history and search are not completely migrated.
- The experimental Quick Tunnel URL changes when restarted. Production should use a stable hostname and a separately audited deployment, not promote the temporary preview or open guest data stores.
- Build output `webui/dist-jazz-public` is local, ignored by git; no large generated files should be committed.
