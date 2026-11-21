# Opt-in Dim0 ↔ Jazz canvas integration — engineering test guide

Status: **experimental development branch, not a delivered migration**. Existing Dim0 boards use their original storage/sync unless the environment variable below is set. This development path does NOT yet support durable offline writes, group/frame metadata, cross-layer subtree operations, all agent writes, Jazz-only authentication storage, or full MCP/Tailscale acceptance.

## Safety boundaries

- Use a **fresh empty Jazz test data directory**, **unused local ports**, and a **throwaway Jazz board**. Do not point this test at a working Patchboard database, current Funnel, or existing Dim0 users.
- Private Patchboard Jazz backend binds to loopback; Dim0's Vite development proxy routes `/patchboard-private` and `/patchboard-auth` to that private origin. There are no new exposed Tailscale endpoints here.
- `VITE_DIM0_JAZZ_CANVAS=1` globally selects Jazz for **non-local** Dim0 board URLs. It does not migrate local-only boards or replace other database-backed APIs. Stop before deployment.
- In this mode `/boards/$id` checks the Better Auth session at `/patchboard-private/api/me`, not a Dim0 JWT, then server-sides validate membership on every canvas access. The `/jazz-signin` page links to the existing Patchboard passkey sign-in, not a second auth implementation.
- JSON node/link payloads are versioned with CAS on writes. The live server uses `Db.subscribe` to emit full snapshots over authenticated SSE, revalidating session and membership.
- For now, **all writes should be treated as at-risk on a network outage**. Conflicting writes suspend editing rather than silently overwriting another user, but there is no durable offline outbox.

## Reproducible local test (new isolated fixture only)

From the fork checkout:

```sh
cd integrations/patchboard
pnpm install --frozen-lockfile
PATCHBOARD_PRIVATE_DEV=1 \
PATCHBOARD_PRIVATE_ROOT=/tmp/dim0-jazz-isolated-fixture \
PATCHBOARD_PRIVATE_ORIGIN=http://127.0.0.1:5178 \
PATCHBOARD_PRIVATE_PORT=8798 \
pnpm demo:private
```

In a separate shell (use the repository-recommended Node 20 or 22):

```sh
cd webui
npm ci
VITE_DIM0_JAZZ_CANVAS=1 PATCHBOARD_PRIVATE_PORT=8798 APP_PORT=5178 npm run dev
```

Sign in at `http://127.0.0.1:5178/jazz-signin` (links to the private passkey sign-in via Vite proxy), create/access a **Jazz-backed** board, then navigate to `http://127.0.0.1:5178/boards/<JAZZ_BOARD_UUID>`. The URL uses the Jazz board UUID, not the ID of an existing Dim0 Postgres graph.

## Acceptance gates still REQUIRED

1. Two independent passkey sessions show each other's create, text edits, move, links and deletions without reload; viewers never write.
2. Applet source and styles persist byte-for-byte through reload, a remote MCP update, and another browser's Jazz stream.
3. Mid-edit concurrent MCP changes trigger visible recoverable conflict resolution, with no silent loss.
4. Lost network / tab close / browser restart replays a durable local outbox to Jazz without duplicating entities. **Currently NOT implemented.**
5. Nested folders, cross-layer links, groups, frame order, off-scene editors, shared thumbnails, attachment/document bytes, user/board metadata and non-canvas APIs are backed by Jazz. **Currently NOT implemented.**
6. Verify Better Auth and OAuth MCP against the new Dim0 UI, then validate the intended Tailscale HTTPS route using an isolated path while leaving existing services/routes untouched. **Currently NOT tested.**

## Quick verification

```sh
node --test webui/src/features/board/jazz/jazz-canvas-api.test.mjs
pnpm -C integrations/patchboard --filter @patchboard/server typecheck
pnpm -C integrations/patchboard test:private:ci
npm --prefix webui run type-check
```

All commands must complete in a clean checkout and the two-browser test must pass before changing the default sync engine or declaring a ready-to-use application.
