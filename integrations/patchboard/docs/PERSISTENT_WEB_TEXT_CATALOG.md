# Persistent web text catalog — first #33 increment

Opt-in staging profile, not production rollout. Keep the self-hosted Node/Jazz backend, Better Auth,
private permissions and pinned Jazz 2.0.0-alpha.69. No schema change or migration
reset is needed: reuse createTextTable/addTextRow (serializable receipt/event
transactions and authority wait), listOwnerSavedTypedViews and querySavedTypedView.

## Profile

Default off. Provision a separate, existing absolute non-temporary directory
with mode 0700 on a durable disk. A real staging origin must be canonical HTTPS
and served through the existing native frontend/backend proxy. Preserve the Host
and WebSocket route. Do not change an existing Funnel or use a live/guest store.

Backend and native preview environment:
- PATCHBOARD_PRIVATE_ROOT: separate operator-provisioned directory
- PATCHBOARD_PRIVATE_ORIGIN: canonical HTTPS origin
- PATCHBOARD_PRIVATE_PORT: dedicated loopback backend port
- PATCHBOARD_PRIVATE_DIM0_ONLY=1
- PATCHBOARD_PERSISTENT_TEXT_CATALOG=1
- PATCHBOARD_PRIVATE_DEV, PATCHBOARD_OAUTH_CI_RESTART, PATCHBOARD_QA_TYPED_RECORD,
  PATCHBOARD_QA_HTTPS_TEXT_TABLE and PATCHBOARD_ACC051_INFLIGHT_QA must not be 1.
  No test PID file. Invalid enabled config aborts startup.

Native build: VITE_DIM0_JAZZ_CANVAS=1, VITE_DIM0_PERSISTENT_TEXT_CATALOG=1;
do not enable VITE_DIM0_QA_NATIVE_SAVED_VIEW or
VITE_DIM0_QA_NATIVE_CATALOG_READONLY. Set DIM0_JAZZ_PUBLIC_HOST and the preview
port for the intended origin. Run existing auth migration against only the
new designated directory before starting the private server. Stop the existing
authority before restarting it; never use two writers or reset the directory.
Back up the complete stopped root (auth, Jazz and blobs) before any upgrade.

The text-catalog-only profile permits Owner table and row creation and Owner
grid readback. 100-view/500-row bounds remain. Unrestricted typed records,
typed patch stay disabled; MCP table:create requires its own separate opt-in.
No QA flag, grant or permissions artifact is repurposed. Feature-off keeps
ordinary private boards/Share and does not delete persisted objects.

## Optional persistent filtered sharing (#33)

In addition to the text-catalog backend and frontend flags, explicitly set
PATCHBOARD_PERSISTENT_FILTERED_SHARING=1 at backend startup and
VITE_DIM0_PERSISTENT_FILTERED_SHARING=1 at native build. Both default off.
Backend refuses sharing without a valid persistent text-catalog profile.
The same canonical HTTPS origin, private non-temp root and QA exclusions apply.

Owner Data exposes Save view with Title prefix and the same primary text grid.
Owner Share exposes create/copy/revoke links and metadata. A separate signed-in
nonmember landing reads the server-projected rows and fields, never joins
the board or gains an OAuth grant. Existing versioned SQLite share ledger
persists the digest, not the bearer token. The copied link keeps its secret in
the fragment; the bearer is submitted only with the authorized query. The
recipient can refresh or paginate; each request rechecks the live share and
definition. Revocation removes the grid/count on the next fetch, not via push
and cannot retract already seen data. Restart must preserve active and revoked
links and canonical records. Keep both Jazz and auth stores and the auth secret
in the stopped-root backup.

Only existing browser create, issue, list, revoke and query operations are
newly enabled; definition revision remains QA-only. The sharing flag does not
add MCP tools or scopes. This remains a bounded primary-text MVP with
100-view, 100-share-list and 500-row query limits, not an unbounded catalog
engine. No schema or migration changes.

Reproduce the persistent sharing journey from integrations/patchboard:
```sh
pnpm test:native:persistent-filtered-sharing
```
This uses the same isolated HTTPS harness, with no QA gates enabled. A native
Owner creates a table, three rows, and a filtered view, copies a real link from
Share and an independent virtual-passkey account opens it. It observes two
filtered rows and only Title, rejects hidden record and extra-field queries,
checks no board membership or OAuth grant, restarts on the same stores,
reopens the active link including an old cursor, revokes through Share, verifies
next-fetch/reload/restart denial, and checks the Owner retains all three rows.
The real hidden-column fixture is covered separately by typed-shared-view.test.mjs.
Disable sharing alone and rebuild; table/row Data and ordinary board invites
still work, share routes return 404, and the stored catalog is unchanged.
No public endpoint or production data are used.

## Optional persistent MCP table creation (#33)

Set PATCHBOARD_PERSISTENT_MCP_TABLE_CREATE=1 with the validated persistent
text-catalog backend profile. Default off. Independent of filtered sharing;
no frontend flag beyond the text catalog is required. Invalid or QA-mixed
profile fails startup. OAuth supports explicit table:create only when the
profile permits it (or in existing QA); default registration scopes are
unchanged. Existing board:write grants do not acquire this operation.
Consent must include both board:write and table:create on the selected board;
discovery and invocation require current Owner, the live grant and exact board.
Only call-api-write / dataset.create.v1 is enabled, not generic API writes,
typed patch or shared-view MCP read. The same authoritative createTextTable,
stable request ID, receipt/event, and durable write reservation apply.
Native Data reads the same objects. Disconnect uses the existing drain
protocol and revokes the selected grant only. Unknown commit outcomes retain
the reservation; the process-level reconciliation helper still requires
verified writer exit. Production scheduling/fencing remains a release gate.

Reproduce:
```sh
pnpm test:native:persistent-mcp-table-create
```
Actual native passkey/consent + MCP SDK over the isolated HTTPS fixture, one
board and one non-temporary store, no QA flags. Check legacy grant, missing
board:write, Viewer, wrong board, unsupported operation and actor override
denials; create/replay/conflict; same native table and column IDs after restart;
disable MCP alone with live grant; re-enable and disconnect from Settings;
fresh SDK writes must return HTTP 401 even after restart, while the Owner
retains access and an independent grant remains usable. The durable catalog
contains one dataset, primary field, default grid, receipt and event, no rows.
This is SDK acceptance, not a new installed ChatGPT-client rehearsal or a
public deployment. Existing #28 installed-browser evidence is separate.

## Reproduce the first acceptance gate

From integrations/patchboard, with frozen workspace and webui dependencies:
```sh
pnpm test:native:persistent-text-catalog
```

The test uses the actual native build and an isolated HTTPS loopback reverse
proxy with a fixture TLS certificate, virtual passkeys and a new non-temp
directory in the test user's home. The test owns and removes only that directory
at teardown. It starts with the profile disabled; then enables it on the same
store. Owner creates the board, table, Title field/default grid and row through
visible controls. The browser deliberately loses the committed Add row response,
reloads the same tab and retries the frozen input; the response must be a replay
of the original row/receipt/event IDs. A stopped-authority read-only audit and backend restart,
followed by sign-out/sign-in and reopening native Data, must preserve all four
object IDs, writer and row value, with exactly one catalog and one row
receipt/event. Nonmember mutation/read is denied; unsupported QA operations and
feature-off routes return 404. Reopening the same store with the profile off
leaves data unchanged. Set DIM0_PERSISTENT_CATALOG_EVIDENCE to save redacted trace
and synthetic screenshots in an operator-owned evidence folder.

## Browser retry boundary (#30)

Table and row intents are validated and saved synchronously in sessionStorage
before dispatch, scoped to the current verified Better Auth subject, Jazz
account and board. The same tab can reload and explicitly retry the exact
input; no automatic retry and no new request ID while the outcome is unknown.
The server remains authoritative and uses its existing durable receipts.
Confirmed replies clear only the matching intent. A rejected retry does not
prove the original attempt failed and therefore retains the intent. A missing
or changed session, malformed journal or failed storage operation blocks the
submission rather than silently allocating a replacement request.

The journal contains the pending definition or row text (not auth tokens or
share credentials). It is tab/origin-scoped browser storage, not encrypted
backup or a server outbox; tab closure, storage clearing, another browser or
device are outside this guarantee. Non-idempotent saved-view creation
persists a review marker, never replays automatically, and remains locked until
the list successfully refreshes and the Owner explicitly acknowledges review.
This is a manual review boundary, not a saved-view idempotency receipt.

This is a local staging-profile proof, not a public-hostname or persistent
production deployment. Later #33 increments cover supported staging/production operation, branding
and a combined journey. #24 upgrade remains separate.

## Native SashAI presentation

The native web delivery title, PWA manifest name, consent heading, and new
passkey/account presentation use SashAI. Existing display names, provider
identifiers, storage keys, OAuth scopes, board IDs and data are unchanged.
The retired Patchboard UI and desktop release identity are separate.

Settings offers English and Russian with the existing BCP 47 preference field
for other language tags. A confirmed preference save updates the current UI;
startup reads the authenticated preference without a device-wide language
cache. Regional English/Russian tags select their respective catalog; other
valid tags remain saved but render English. Sign-out clears account-derived
language. Consent reads the same verified subject preference server-side;
only presentation is localized. Board/table/view/field names, row contents and
protocol scope identifiers are not translated. Coverage is the native board
list/navigation, profile, catalog Data, Share, shared-view landing and OAuth
consent, not all canvas tools, assistant UI or desktop surfaces.

Reproduce the presentation rehearsal from integrations/patchboard:

```sh
pnpm test:native:sashai-presentation
```

It uses a disposable local persistent HTTPS profile with all three persistent
flags enabled, two independent virtual-passkey accounts and real OAuth/SDK
consent. The same board/table and bilingual row value survive Russian locale
save, reload, restart and switching back to English. The actual selected
board and scopes remain identical in both consent languages. It also checks
the independent recipient locale and unsupported-tag fallback. Reuse the
combined web engineering proof for the unchanged replay/disconnect behavior.
