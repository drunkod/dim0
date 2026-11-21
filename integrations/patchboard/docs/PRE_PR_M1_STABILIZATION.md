# Pre-PR M1 stabilization and backend Jazz proof

**Date:** 20 November 2026  
**Baseline:** `main` at `218e85b`  
**Repair branch:** `fix/m1-reload-and-backend-proof`  
**Architect's draft:** [PR #1](https://github.com/drunkod/agent-staff-board/pull/1) (`docs/macbook-demo`, `1291ca8`), **not modified or merged by this work**.

## Verified fixes

1. **Selected board URL and reload.** A selected Jazz board now has a canonical `?board=<id>` route; Foldkit reads it at initialization and updates it through an Effect command. A regression creates **two boards with the same title**, adds distinct notes and confirms the requested ID and matching note survive reload.
2. **Edit draft recovery.** A note editor stays open with its text while a Jazz update is in flight; the draft remains on failure and closes only after a successful write. Story tests cover both paths.
3. **No stale notes from a prior board.** Live note snapshots carry their board ID. Late events from a different board are ignored after switching.
4. **Reachable note controls.** New note defaults use a spaced grid instead of overlapping the first five notes; the same pure defaults are shared by UI and backend.
5. **Independent test ports and fixture directories.** Playwright defaults to Jazz 43171 and web 44171, not occupied M1 demo ports 3001/4173. Override with `PATCHBOARD_TEST_JAZZ_PORT` and `PATCHBOARD_TEST_PORT`. Each invocation uses a unique temporary SQLite data path (or `PATCHBOARD_TEST_DATA_PATH`).
6. **Backend lint and typecheck.** `pnpm check` and `pnpm lint` also check `apps/server`. Package lockfile updated.
7. **Backend write/restart proof.** `apps/server/src/http-server.ts` owns the existing Node HTTP listener and Jazz instance; `apps/server/src/board-service.ts` inserts a note using **that exact instance's `jazz.db`**, not a second Jazz session, direct SQLite mutation, or MCP placeholder. `apps/server/src/index.ts` is now a thin startup wrapper.

## Reproducible proof

```sh
cd /Users/test/work/patchwork/agent-staff-board
pnpm install --frozen-lockfile
pnpm verify
# Or specifically:
pnpm test:backend-proof
```

The proof harness `apps/web/test/backend-write-proof.mjs` launches the **real Node/Jazz server factory** with its own temporary SQLite directory, spawns the built web preview with a Jazz WebSocket proxy, and opens two truly independent Chromium browser contexts. The test then:

1. Inserts a board via the backend's Jazz Db.
2. Opens **both browsers** at the board's ID URL and waits for their subscriptions.
3. Inserts a note via `createNoteFromBackend(running.jazz.db, ...)`.
4. Asserts **both already-open browsers show the note live, without refresh**.
5. Releases browser connections, stops and restarts the same Node/Jazz service against the same path.
6. Reads the row by its exact original ID, and checks ID, board ID, text and coordinates.
7. Reopens both browser contexts and confirms the note is still rendered.
8. Closes browser/server processes and deletes the **test's own** temporary directory; never touches existing demo data.

**Results from the verification run:** 14/14 Foldkit Story/Scene tests, 2/2 Jazz SQLite tests, 3/3 Playwright tests, web/server typechecks and web/server lint all pass. The backend note proof logged:

```
LIVE_SYNC_PASS {"boardId":"01a1f881-a51a-7dd1-84f9-0c71b3e5938f",
"noteId":"01a1f881-a679-7a31-a526-016eec53740d","port":63108,"webPort":63109}
RESTART_EXACT_ID_PASS {"boardId":"01a1f881-a51a-7dd1-84f9-0c71b3e5938f",
"noteId":"01a1f881-a679-7a31-a526-016eec53740d","browserProfiles":2,"persisted":true}
```

These IDs were created in a disposable fixture; the fixture is removed after success. Exact ID verification was against the reopened SQLite dataset.

## Not implemented in this repair branch

The architect's selected **single Node process topology** is retained, but it has **not yet been extended to serve the static Foldkit build or MCP**. The public UI/WS Funnel paths, `read_board` / `create_note` MCP transport, no-auth ChatGPT connector and future accounts/OAuth are all still PR #1's planned work. Do **not** represent them as live. There are no Funnel route changes, no production account security changes and no changes to the draft PR branch.

## Recommended merge sequence

Review and land this isolated M1 repair branch **before** using ADR 001 and programmer instructions from PR #1 for the next implementation. Rebase or update the draft PR branch after these fixes land, and then start Phase A of the architectural plan.

**Scope caution:** `jazz.db` here uses backend authority and must not be exposed as arbitrary public CRUD. The future no-auth MCP adapter should expose only narrow demo-board operations, with an explicit resolver and separate disposable data store as specified in ADR 001.
