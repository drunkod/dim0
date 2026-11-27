# Sprint 4 — Jazz shared applet state, browser + MCP

Date: 21 November 2026. Dim0 feature branch:
`feat/jazz-mcp-tailscale-migration`.

## Scope

This sprint replaces **per-device IndexedDB state for Jazz-hosted applets**
with a shared, server-authorized Jazz row. Local boards continue to use
IndexedDB. There is **no global legacy-board data import**.

- A new `appletStates` Jazz table stores `boardId`, `noteId`,
  `value` (JSON), `version` and `updatedBy`, indexed by board/note.
- A generated additive schema migration connects the previous Jazz hash to
  the new version. The private permissions allow members to read; browser
  mutation is denied; only authenticated backend commands may write.
- REST: authenticated `GET/POST /patchboard-private/api/applet-state`,
  requiring actual board membership, an existing `style.type=applet` node,
  valid JSON (16 KiB maximum), and owner/editor rights for writes.
- Serializability and `expected_version` reject concurrent stale writes with
  409. Applet state versioning is independent of canvas geometry versions.
  Deleting the canvas node also removes its state in the same Jazz transaction.
- Dim0 React `useAppletInitialState` hydrates a Jazz applet when visible,
  polls its shared version every 1.5 seconds, and remounts the interpreter
  when another writer publishes a change. Writes are debounced and serialized.
  A 409 displays a conflict warning and lets the user copy their local state
  before explicitly refreshing. This is **not** automatic merging.
- New OAuth-bound ChatGPT tools `get_applet_state` (board:read) and
  `update_applet_state` (board:write) call the **same** Jazz state service as
  the web app. Permission and scope checks happen in the backend.

## Acceptance evidence

| Verification | Result |
|---|---|
| Generated Jazz private permission and schema checks | PASS |
| Server TypeScript | PASS |
| Frontend TypeScript | PASS |
| Applet renderer tests incl. peer revision hydration | 16/16 PASS |
| Real authenticated Jazz state API on disposable MacBook backend | PASS |
| Two separate local Dim0 browsers, live increment 0→1→2 | PASS |
| Browser 2 receives browser 1 increment | PASS |
| Reload preserves state | PASS |
| Stale writer expected version rejected | PASS, HTTP 409 |
| Viewer read and denied viewer write | PASS, HTTP 403 |
| Malformed/oversize/non-applet state handling | PASS |
| Original private OAuth/MCP integration CI incl. new tools | PASS |
| MCP applet state read/write/cross-board-denial/version-conflict | PASS |
| Production Vite build | PASS |
| Migration of *copy* of current public Jazz store to new schema | PASS |
| **Public HTTPS production bundle**: two freshly registered browsers, shared counter 0→1→2, reload and server version 2 | **PASS** |
| Existing authorized ChatGPT MCP grant after restart | PASS: list_boards identifies the presentation board |
| Public friend with independently connected ChatGPT account | NOT TESTED |

### Local acceptance commands

```sh
cd /Users/test/work/patchwork/dim0-jazz-port
# Disposable browser + Jazz applet QA instance; separate from presentation.
APP_PORT=5185 JAZZ_PRIVATE_PORT=8885 \
 PATCHBOARD_PRIVATE_ROOT=/tmp/dim0-shared-applet-ui-qa-20261121 \
 ./scripts/run-jazz-mvp-local.sh

cd integrations/patchboard
pnpm --filter @patchboard/web exec node test/dim0-shared-applet-ui-proof.mjs
pnpm test:private:ci
```

The private server test `test/dim0-shared-applet-state-proof.mjs` expects
an independent loopback-only private backend and creates disposable
identities/boards. Do **not** point it at the presentation database.

## Deployment and rollback

Before any public restart, a consistent SQLite backup of the live Jazz and
Better Auth stores, plus Jazz identity secrets and blobs, was created and
integrity-checked at:

`~/Library/Application Support/Dim0/PrivateBackups/20261121-202616-pre-shared-applet/`

The old presentation frontend bundle is preserved under
`~/Library/Application Support/Dim0/PreviousBuilds/20261121-202820-before-shared-applet/dist-jazz-public`
for rollback. The same HTTPS origin now serves the migrated Jazz schema, the
updated Dim0 frontend and the two MCP applet-state tools. Production port 8800,
frontend proxy 5180, and the existing Cloudflare tunnel were kept unchanged.

The existing Cloudflare origin, MCP OAuth issuer and passkey RP ID must
remain unchanged. Do not repurpose the currently occupied Tailscale Funnel;
a separate stable Dim0 route still requires its own rollout.

Current limitations: state is polled, not a direct client CRDT subscription;
two writers conflict via CAS rather than semantic merge; delayed offline writes
are not supported; migration of other original Dim0 domains remains incomplete.
Existing ChatGPT clients may need to **reconnect/refresh tool discovery** to
see the two new applet-state tools.
