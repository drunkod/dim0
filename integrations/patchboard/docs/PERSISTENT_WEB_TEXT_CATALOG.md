# Persistent web text catalog — first #33 increment

Draft, not production rollout. Keep the self-hosted Node/Jazz backend, Better Auth,
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

This slice permits Owner table and row creation and Owner grid readback.
100-view/500-row bounds remain. Saved-view creation/sharing, unrestricted typed
records, typed patch, and MCP table:create remain disabled in this profile.
No QA flag, grant, or permissions artifact is repurposed. Feature-off keeps
ordinary private boards/Share and does not delete persisted objects.

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
device are outside this guarantee. Non-idempotent QA saved-view creation
persists a review marker, never replays automatically, and remains locked until
the list successfully refreshes and the Owner explicitly acknowledges review.
This is a manual review boundary, not a saved-view idempotency receipt.

This is a local staging-profile proof, not a public-hostname or persistent
production deployment. Later #33 increments cover persistent sharing
and scoped MCP, then supported staging/production operation, branding and a
combined journey. #24 upgrade remains separate.
