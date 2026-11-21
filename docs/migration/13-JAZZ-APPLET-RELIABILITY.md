# Jazz applet reliability — deterministic and browser acceptance

Baseline: `drunkod/dim0@5d899993`
Branch: `sprint/jazz-applet-reliability-20261121`
Date: 21 November 2026

This change touches **only the Dim0 frontend and QA tests**, not the Jazz
table, transaction service, OAuth/MCP runtime, or the earlier
`sprint/dim0-plugin-modular-20261121` package branch.

## Fix 1: failed save, actionable Retry

The applet state hook keeps three distinct values:

- `attemptedRef`: value sent by the last (possibly unacknowledged) POST.
- `pendingRef`: **latest** draft, including any clicks while POST is pending.
- `versionRef`: highest accepted canonical Jazz revision.

A rejected older request never replaces a newer draft. A failing POST shows
`Unsaved` with a real `Retry` button; the failed draft is preserved.
No automatic retry can overwrite another editor after a network outage.
`Retry` reads the current Jazz version **before** another write:

| Server readback | Decision |
|---|---|
| Same version/value as last confirmed Jazz state | Save latest draft using this version; show `Saved` only after POST 200 |
| Higher version whose value matches the unacknowledged attempted POST | Treat prior write as committed; if a later click exists, write it against that higher version |
| Higher version matching even the newest desired value | Treat latest draft as already committed without duplicate POST |
| Higher version with different value | Surface `State conflict`, show peer's JSON value, preserve/copy latest local draft; never silently overwrite |
| Stale read lower than last known version | Ignore; keep `Unsaved`/conflict state |
| New write returns 409 | Return to the same explicit conflict flow, loading peer value if available |

The `Retry` and conflict buttons live inside Dim0's canvas node.
The **real-browser rehearsal discovered** that a pointer click on the new
Retry button was captured by the canvas gesture listener before React.
Both notices are now mounted as dedicated components that attach the
existing `useStopCanvasGesture` **native pointerdown** guard to their own
ref at mount time. Actual Playwright `locator.click()`, not synthetic DOM
`.click()`, now triggers Retry successfully.

## Fix 2: monotonic Jazz poll responses

Each `(boardId, noteId)` effect creates a request generation. Cleanup
invalidates that generation, so responses from a left applet are discarded.
The latest accepted revision remains monotonic: normal polls with
`incoming.version <= versionRef.current` are ignored. Reads cannot replace
a pending, saving, failed, retrying or conflicted draft. Manual refresh may
rehydrate the *current* revision, but cannot install an older one, and only
discards the draft after a successful canonical read.

## Verification

| Test | Result |
|---|---|
| 9 deterministic hook tests, including 503 before commit, ack lost after commit, second click during in-flight write, peer divergence, 409, delayed v2-after-v3 poll, left applet, viewer | PASS |
| Existing React interpreter/hydration tests | 16/16 PASS |
| TypeScript + targeted ESLint | PASS |
| Production Vite Jazz build | PASS |
| Isolated loopback Dim0 QA: real two-browser pointer-click counter 0→1→2 | PASS |
| Owner/peer reload and Jazz count 2 version 2 | PASS |
| Injected owner POST 503, visible `Unsaved · Retry`, peer still at 2 | PASS |
| **Physical Retry click** then both browsers at 3, Jazz version 3 | PASS |
| Delayed owner version-3 GET delivered after peer version 4; owner stays 4 | PASS |
| Owner then saves 5 against version 4; peer and Jazz agree version 5 | PASS |
| `pnpm test:private:ci`, including OAuth/MCP applet-state read/write/grants | PASS |
| Browser-origin ChatGPT connection's two new state tools discovered | NOT YET |
| Independent friend on their own ChatGPT account | NOT YET |

Isolated QA uses `http://localhost:5196`, backend `8896`, and only
`/tmp/dim0-applet-reliability-qa-20261121`. The public presentation data
and OAuth issuer are unchanged during test.

### Repro/verification commands

```sh
cd /Users/test/work/patchwork/dim0-applet-reliability-20261121
cd webui
npm run type-check
./node_modules/.bin/vitest run \
  src/features/applet/render/use-applet-initial-state.test.tsx \
  src/features/applet/render/render.test.tsx
cd ../integrations/patchboard
pnpm test:private:ci

# Start the separate test backend from the repo root (in a separate terminal):
cd ../..
APP_PORT=5196 JAZZ_PRIVATE_PORT=8896 \
 PATCHBOARD_PRIVATE_ROOT=/tmp/dim0-applet-reliability-qa-20261121 \
 ./scripts/run-jazz-mvp-local.sh

cd integrations/patchboard
DIM0_SHARED_APPLET_QA_ORIGIN=http://localhost:5196 \
 DIM0_FAULT_QA=1 pnpm --filter @patchboard/web exec node \
 test/dim0-shared-applet-ui-proof.mjs
```

The script's fault mode is strictly limited to `localhost` and creates new
test accounts and a disposable board, not the presentation board.

## ChatGPT: independent acceptance is distinct

The **server** source registers `get_applet_state` under board:read and
`update_applet_state` under board:write. The isolated authenticated
private-MCP acceptance suite passes with both tools.

The ChatGPT connection currently named `Dim0 Jazz Sprint Demo` can read
`Live MCP Board · Sprint Demo`, but this ChatGPT session discovers only
**eight older canvas tools**, omitting both new state tools. This indicates
tool-discovery staleness on the connected ChatGPT side if the live OAuth
grant and current server's list agree; it is **not** evidence that a new
friend has connected. Refresh or reconnect a QA ChatGPT plugin session and
inspect its tools list before advertising the counter segment.

Final end-user acceptance requires a friend to consent **in their own
Dim0 browser profile using their own passkey**, not the owner's active
session. On a QA board they must read a counter, increment with its exact
state version, read back, and see the result persist on the owner's browser
after reload. A successful `list_boards` alone does not satisfy this gate.

## Release and rollback

The existing presentation frontend bundle and database remain intact until
a candidate is promoted. This sprint uses **no schema migration** and has no
server changes. Rollback is swapping the static frontend bundle to the
last known good copy and reloading the board; the Jazz values themselves
must not be rolled back to undo a frontend bug.

The temporary Cloudflare HTTPS hostname remains temporary; the permanent
domain and real-friend ChatGPT authorization are tracked separately.
