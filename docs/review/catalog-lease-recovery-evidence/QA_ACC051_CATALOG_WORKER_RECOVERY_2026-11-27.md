# ACC-051: terminated catalog writer lease recovery

Tested source SHA: `483373aaa173fc3272ae4ab73e8474b4d57cf8f4`. Parent #26 `850f2778b8221a6248cb51508c50630738d5e18e` passed [all five hosted jobs](https://github.com/drunkod/dim0/actions/runs/45887262796). Historical reference `d8eb84e8`.

## Scope and authority

This increment adds a server-only, privileged reconciliation primitive; no production scheduler, HTTP route, CLI, API or automatic unlock. The test supervisor derives the trusted termination assertion only after observing the exact child's SIGKILL exit. This does not implement production writer fencing. The isolated topology opens one Jazz authority at a time. The writer reserves both admitted write scopes and performs createTextTable with its submission guard; marker PID and lease ID must match the actual child. Recovery opens a new authority and reads existing Jazz evidence; never calls createTextTable. The primitive assumes a quiescent authoritative Jazz store; SQLite and Jazz are not atomically locked together.

CodeGraph and exact-source inspection identify the recovery helper's only caller file as test/grant-drain-worker.mjs. It reuses textTableOperationIdentity and settleProtectedMcpWriteLease, not createTextTable. Strict identity keys, string types, UUIDs, request ID, operation and fingerprint; original grant subject/board and trusted Better Auth to Jazz mapping; optional admission client/subject/board and both scopes. Exact receipt/event links plus current primary-text/default-grid definition. SQL compare-and-settle under BEGIN IMMEDIATE rechecks the lease and mapping after remote reads. Missing/altered/unsupported evidence never clears a lease. No Jazz schema or lockfile change.

## Durable counts (same tested SHA, process-level proof)

| Object | Before-commit crash: before | After recovery | After-commit crash: before | After recovery |
|---|---:|---:|---:|---:|
| datasets | 0 | 0 | 1 | 1 |
| fields | 0 | 0 | 1 | 1 |
| views | 0 | 0 | 1 | 1 |
| receipts | 0 | 0 | 1 | 1 |
| events | 0 | 0 | 1 | 1 |
| records | 0 | 0 | 0 | 0 |
| leases | 1 | 1 | 1 | 0 |

The full persisted Jazz rows, not just counts, are equal before/after each attempted recovery. The committed case changes ONLY the SQL lease (1 to 0) before the separate revoke retry. No new catalog receipt or event.

### Crash before submission
Writer PID 2558, observed SIGKILL, lease `ecb9546f-087c-43c9-a9ea-21c8f2a536b7`. Zero objects, recovery `NO_RECEIPT`, original disconnect intent version 1 stays pending (503 then 503).

### Crash after commit, before release
Writer PID 2588, observed SIGKILL, lease `6eaf64e7-360d-49f6-8155-d1ce58d3bc6b`. Same writer wrote the authoritative table and signaled committed with exact lease/PID. Live unfenced check returns `WORKER_MAY_STILL_COMMIT`. A separate recovery worker (observed exit proof) returns `PROVED_COMMITTED` after actual ledger admission pruning; repeat returns `ALREADY_SETTLED` (last recovery PID 2894). Original disconnect is 503 then 200, grant version 2, identical revoke replay, revoked admission denied, unrelated client's board:read admission usable. The server disconnect service is called from a separate process, returning status-equivalent results; not an HTTP/browser interaction in this crash test.

Independent Owner readback uses a separate grant/client for the same actual board Owner, derives the actor from the trusted mapping, then calls the Owner Data list and grid projection after restart in process 2904. It is not a browser login in this crash fixture.

| Object | Stable persisted ID |
|---|---|
| Dataset | `7b52c116-6a58-5c2b-9a7f-f54ea3d0951e` |
| Primary field | `9bc1fa64-7a9a-513d-9bb8-93e98a3f9e97` |
| Default grid | `f41ac962-c5c1-5990-94aa-302c5f012d96` |
| Receipt | `fbac1bc4-6fc0-5a93-b7df-a595cc24a311` |
| Event | `0ed14c2d-b5c9-51a0-85a8-03771b4b5871` |

Grid definition v1, primary Title column, 0 rows.

### Negative controls
- 24 altered/malformed/unsupported lease and grant/admission/mapping controls, all retained the lease. Temporary fixture mutations are restored before positive recovery.
- Missing actual persisted event (privileged fixture-only deletion), genuine receipt still exists; `RECEIPT_MISMATCH`, lease 1, 503/503.
- Legitimate Owner changes the default grid using changeSavedTypedView, version 1 to 2, title Owner revised view, prefix Demo, descending sort. Current original-definition fingerprint/proof is no longer sufficient: `RECEIPT_MISMATCH`, 503/503, one lease retained. The complete edited view survives recovery and reopen. Recovery does not recreate or revert the table; this conservative limitation requires manual review, not an auto-unlock.

## Verification
- Exact-head requested focused process/canvas/drain/catalog suite: 25/25 passed.
- Initial development rehearsal found an assertion bug (grid fields are IDs; columns hold id/name objects). Fixed the assertion and reran the suite on this SHA. No production recovery change was needed for that test issue.
- Separate native MCP browser regression: passed. Both prescribed private CI configurations: passed. Full `pnpm verify`: passed, including 99/99 server integration tests, 6/6 MCP tests, typecheck, lint, browser E2E and backend/demo proofs.

## Separate native browser regression (no worker crash)
Real OAuth PKCE and SDK create/replay, real native Data DOM IDs after restart, both Settings disconnect orderings, disabled-feature cached invocation. This uses different disposable board/object IDs:
- Dataset: `8f490c83-fd46-59af-9064-e0fb5f927222`
- Primary field: `31262dae-16c3-5b2d-9c52-6fc546c80ff4`
- Default grid: `87680627-26c3-5b0c-a295-2e98384df84a`

Native Settings reservation-first POST 503/200, disconnect-first POST 200 with denied resumed callback, fresh requests 401. These are actual browser/HTTP observations, not the crash fixture's service statuses.

## Boundaries
Separate native browser regression exercises real OAuth/MCP SDK, Data and Settings ordering without worker crash; it does not prove browser recovery after actual worker death. The process test proves the crash window, service-level drain and independent Owner projection. Installed ChatGPT-plugin acceptance and production supervisor fencing/scheduling remain separate. No merge or deployment.

Hosted Tests: [run 45888378725](https://github.com/drunkod/dim0/actions/runs/45888378725) — 2/5 passed, in_progress (not final).
