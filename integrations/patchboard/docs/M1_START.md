# M1 · Shared board

**Assignment:** two independent browser profiles edit the same seeded sample board on a local Jazz server. The existing browser smoke test exercises device storage and establishes the starting point.

## Open the project

If starting from the source ZIP, extract it first. The ZIP omits Git history. Initialize its baseline once so schema drift checks and worktrees have a commit to compare against:

```sh
git init -b main
git add .
git commit -m "chore: import Patchboard development template"
```

On the configured MacBook checkout, start directly with dependency installation. From the repository root, use Node 24 and pnpm 12.11.2. Run the following once per checkout:

```sh
pnpm install --frozen-lockfile
pnpm --filter @patchboard/web exec playwright install chromium
pnpm verify
```

Use `pnpm dev` for interactive development. Run `pnpm test` during UI edits. Run `pnpm test:e2e` to rebuild and exercise the production bundle. Each browser run writes an HTML report and video in apps/web. On Linux CI, install Chromium with the Playwright --with-deps flag.

Run `pnpm test:integration` for the baseline Jazz SQLite restart test in packages/jazz-schema/test/runtime.test.mjs. Extend it with the M1 board read/write fixture.

## First coding-agent assignment

> Implement the M1 two-profile acceptance test first. Use two fresh browser contexts with different fixture participants. Give both membership on one sample board. A creates a note. B sees it, edits its text and moves it. A sees those changes. Reload both pages and assert identical text and position. Show the initial failure and the eventual passing command. Use the existing Jazz policies and a local, per-test data directory.

| Slice | Implementation entry point | Completion evidence |
|---|---|---|
| 1 · Test and fixtures | Add the acceptance case beside apps/web/browser/board.spec.ts. Define two reproducible fixture sessions and seed one board. | Independent contexts with independent storage. Capture the failing shared-board assertion. |
| 2 · Real sync endpoint | Use the pinned Jazz StagePlan example, especially server/jazz.ts and server/index.ts, to implement the local Jazz runtime under apps/server. Exercise the runtime and generated schema in an integration test. | Open server, seed, write, read through another session, close server, reopen using the same temporary data path and read again. |
| 3 · Wire the UI | Adapt openSession in apps/web/src/main.ts to the fixture session and endpoint. Scope subscriptions to board and session. Add the edit command beside createNote and moveNote in board/jazz-effects.ts. | Story/Scene coverage for edits, save failure and stale events. Two-profile acceptance passes against real sync. |
| 4 · Rehearse and review | Add the fixture start/reset commands to README and CI in the same PR. Update the scenario recording. | CI exercises the real endpoint. After reload/reconnect both profiles agree. PR includes replayable evidence. |

**Isolation.** Give each test or worktree its own Jazz data directory, fixture IDs and available ports. Start and stop its server in the test harness with cleanup on failure. For the current single-profile suite set PATCHBOARD_TEST_PORT to use another port; PATCHBOARD_TEST_URL runs against an already running build. For shared sync, supply the fixture backend address when building Vite.

**Scope.** Build M1 before MCP and decisions. Security engineering, invitations, hosted deployment and cloud credentials remain on the deferred roadmap. See [MVP plan](MVP_PLAN.md), [ticket mapping](ROADMAP.md) and [source references](CODE_REFERENCES.md).
