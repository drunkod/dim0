# Web MVP sprint closeout — 27 November 2026

**Final main:** `aa80a38b5814ac8c25a199b842dea3d387a0b2b1`. All 23 web PRs merged with merge commits under repository-owner authorization; #23 and #24 remain drafts. All original branches retained. No independent approval fabricated. Main tree equals reviewed PR #28 at `66789d1a59f14ea35b6c1629fd4880ea3ce5159b`.

## Merge and Jazz gates

Each child was retargeted after its parent landed. Original and retargeted binary diffs were identical; GitHub changed-file lists matched; proposed and actual merge trees matched the reviewed head. Seven historical no-CI cases (#3, #5–10) received fresh focused local checks on exact heads; other PRs reused green attached checks after tree comparison. Retarget did not trigger new PR workflows for the no-check cases. Main push CI runs were allowed to run normally. No conflict resolution, dependency changes, application source edits or deployment. Project-local Jazz skill read, alpha.69 retained, schema and private policy generation passed without drift. CodeGraph traced createTextTable, querySavedTypedView and runReservedMcpWrite on the identical final tree.

## One continuous disposable Owner/board proof — PASS

Native passkey signup (virtual test authenticator), authenticated HTTP board creation, visible Data table creation and Add row, dropped successful table and row responses followed by identical retries, actual clipboard view share to independently signed-in nonmember, two permitted rows / three canonical, restart/readback, revoke via Share, same Owner and board OAuth DCR/PKCE consent and MCP SDK replay of the identical browser table request, native Settings disconnect, fresh HTTP write 401, Owner retained all three rows. Feature-off native routes return 404 and ordinary invitation creation returns 201; no persisted changes. All performed on checked-out final main SHA.

| Durable object | Initial | After restart | After MCP disconnect / feature off |
|---|---:|---:|---:|
| Datasets | 0 | 1 | 1 |
| Fields | 0 | 1 | 1 |
| Views | 0 | 2 | 2 |
| Records | 0 | 3 | 3 |
| Catalog receipts/events | 0/0 | 1/1 | 1/1 |
| Row receipts/events | 0/0 | 3/3 | 3/3 |

Dataset `e356941e-4994-5449-90c6-f4481fb0edd0`, field `884f77c8-3997-5cf7-a520-fe5c87147354`, default view `150a97d0-2b75-5231-9180-f0d82fb2488e` unchanged across browser and SDK replay. Grant version 2 revoked; disconnect 200; fresh HTTP 401. Existing actual installed browser-native ChatGPT evidence from #28 applies to identical source tree, and was not repeated. The new smoke uses SDK and native browser controls, not a new installed ChatGPT session.

## Reproduce

Use final main SHA in a clean checkout with the frozen dependencies (same alpha.69). The test-only adaptation in this evidence packet combines the existing native-empty-catalog and native-mcp-table-create proof helpers. Copy `combined-web-smoke.mjs` temporarily to `integrations/patchboard/apps/web/test/.sprint-combined-web-smoke.mjs`; run from repo root:

```sh
CI=1 NODE_OPTIONS=--no-experimental-webstorage WEB_MVP_MAIN_SHA=$(git rev-parse HEAD) pnpm --dir integrations/patchboard --filter @patchboard/web exec node test/.sprint-combined-web-smoke.mjs
```

Remove the temporary test after execution. It creates and removes disposable stores, never changes live routes. The actual tested source digest is in web-mvp-closeout.json.

## Acceptance scope

Disposable web MVP only. Persistent public writable catalog and filtered sharing are not shipped as one profile. #30 reload-before-confirmation remains open; #31 diagnostics non-blocking unless reproduced sign-in failure; #32 desktop backlog. Typography and beta.5 separately deferred. Main-hosted status is recorded separately in issue #29; prior attached PR checks are not a claim of completion of new main runs.
