# Operational restore rehearsal — 2026-11-27

Base application: 82c1f9a74a3fe8cc2ae975ab6f44f6eba6d505a9.
Node 24.22.3; pnpm 12.11.2; Jazz 2.0.0-beta.5. Project-local Jazz skill,
upstream backup/restore guidance, pinned beta.5 signal implementation and
CodeGraph used. Both baseline post-merge workflows passed (5 + 3 jobs).

Before fix: actual isolated direct Node SIGTERM exited by signal (-15);
the first native restore rehearsal failed its clean-stop check before
taking any copy. The pinned SDK removes its own drain listeners, awaits
Jazz close and re-raises a signal if no other listener remains. The private
application's once-listener was removed before HTTP/auth close. The fix
retains guarded application handlers until both closes complete.
After fix: SIGTERM and SIGINT regression, server typecheck, lint (one
pre-existing unused-import warning), schema/private-policy generation and
initial native backup/restore passed. A synthetic launchd job passed
bootstrap, health, bootout, new PRIVATE_AUTH_STOPPED marker and lsof no
open files (418 ms bootout-to-marker/check). No real service modified.


## Exact application candidate

Tested commit: `cbb8bf5e268dfedb53c939fa421a906de937ea5f`. Node 24.22.3; beta.5; same Mac isolated
staging, not a second physical host. The subsequent evidence-only commit
does not change executable code.

| Measurement | Milliseconds |
| --- | ---: |
| Graceful stop | 19 |
| Verified backup helper | 264 |
| Verified restore helper | 257 |
| Restore copy wall clock | 302 |
| Restore to healthy | 1565 |
| Restore to same authenticated Owner grid | 2786 |
| Stop to recovered Owner grid | 3117 |

The full local rehearsal exited 0 (about 45 seconds including fixture setup/build). Verified 9 files, 1,945,860 bytes. The restore directory was new; the original stayed stopped. The same Owner signed out before backup, signed in with the original virtual passkey after restoration at the same HTTPS origin, and opened the original board, table and row.

| Recovered object | Original and restored ID |
| --- | --- |
| Board | `01a21d44-63f7-7321-b2be-4d91ba46394f` |
| Table | `10353bf5-3e86-5c62-8810-ad90302c53ff` |
| Primary field | `d5569781-9af4-584f-b56c-5e0d106c7037` |
| Default grid | `96a5bfa5-4649-56be-8e86-58259c656e23` |
| Row | `e7a91e25-c9ea-55af-9787-aa0b7cf25123` |
| Catalog receipt | `e867b8b4-6bfe-51ed-a2e1-e0b58a436887` |
| Catalog event | `85f7b0fb-20cb-59e5-8258-bb332c24485a` |
| Row receipt | `0d99c0e8-605b-5485-be42-66aa055a4382` |
| Row event | `f3f17af8-1f06-5dd6-a963-5ca9c37806b5` |

Row text: Beta.5 stopped-store restore. Each catalog count was exactly one,
including both kinds of receipts/events; authoritative snapshots identical
before backup and after restore. Live-source copy rejected with open-handle
error, existing destination rejected, altered backup rejected with integrity
error. No production data was copied. The fixture root, both generations and
the temporary backup were retired at teardown. The published trace contains
only synthetic object IDs, booleans, counts and timings.

Exact-head SIGTERM/SIGINT regression, server typecheck and schema/private
policy check passed; no generated artifacts or migrations changed. Separate
synthetic backend launchd bootstrap/health/bootout/marker/no-open-handles
smoke passed (421 ms). An intermediate repeat of that smoke used the wrong
working directory and exited before migration/launch; rerun from repository
root passed. Full pre-merge upgrade and main CI evidence reused; no local
repeat of the entire catalog/MCP suite.

[Machine trace](rollout-restore-trace-20261127.json) ·
[Inspected recovered native grid](rollout-restore-native-grid-20261127.png).

The operator commands are reviewed and shell syntax checked; the production
Caddy/ingress jobs are proposals, not executed. Independent human rehearsal,
realistic volume and encrypted backup/restore, actual hostname, supported
front door, available disk, monitoring/correlation, and release permission
remain outstanding. Public rollout NO-GO. This is not a production RTO.

## Follow-up: hosted private CI shutdown diagnosis

Candidate 2ca194054d669b063b051bb01680ed7e946309e5 had 7/9 green,
with both private OAuth/MCP matrix jobs failing at the same first assertion:
`Disposable Jazz process must exit before offline audit` in
`restartPrivateCiFixture` (private-oauth-mcp-proof.mjs:236), called
from acc051-live-typed-record.mjs:69. Both completed the preceding live
canvas patch and race proof. See [QA off](https://github.com/drunkod/dim0/actions/runs/46010624233/job/140544883000)
and [QA on](https://github.com/drunkod/dim0/actions/runs/46010624233/job/140544883396).
The exact candidate reproduced locally (feature off, Node24). A fixture-only
HTTP observer recorded three standalone MCP GET 200 event streams still
open at HTTP close, zero upgraded sockets, and those same three streams
still open after ten seconds. The failure was not an exit-code expectation
or starting the replacement too early; the listener closed, but process
exit was blocked by the open HTTP responses.

The patch keeps the SIGTERM/SIGINT application handlers and clean marker.
The private entry point stops new requests and aborts passive application
streams; the MCP SDK's closeStandaloneSSEStream is applied only to GET,
and native canvas read subscriptions unsubscribe/end on shutdown.
The original process-exit assertion and offline audits are unchanged.
No active MCP POST is canceled by this read-stream mechanism. Operators
must still fence writes and reconcile any unknown lease before backup.
The initial traced feature-off rerun passed, with all 5 observed HTTP
close starts reporting no pending requests or upgraded sockets. The updated
native restore test holds a real authenticated canvas SSE response through
SIGTERM and asserts EOF and exit zero before the backup. It signs out of
the restored session and uses the original passkey to reauthenticate,
then verifies identical catalog/row/receipt data and negative copy controls.
The pre-commit rehearsal on the follow-up code passed (restore to Owner
grid 2.786 s; stop to grid 3.091 s, 9 files/1945860 bytes).
Transient HTTP 503s during deliberate shutdown are expected; not the
historical #31 sign-in 500. The final candidate's exact test results and
IDs will be recorded in the PR closeout comment.

Independent human review and restore signoff remain **PENDING**.
The public launch remains NO-GO. This test is a tiny isolated fixture on
the same Mac, not an encrypted representative-volume backup or an
independent operator's rehearsal.
