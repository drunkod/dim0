# Installed Dim0 ChatGPT catalog acceptance — attended disposable QA

**Status:** local engineering preflight and installed-client acceptance are
distinct. A package build or MCP SDK result is never a ChatGPT installation.
This is not a production deployment or a way to expose a presentation store.

## Preconditions and scope

- Use a clean, exact reviewed candidate commit. Record git HEAD, native build
  asset SHA-256, fresh QA origin and archive digest. Use locked dependencies:
  pnpm install --frozen-lockfile in integrations/patchboard; npm ci in webui.
- The dedicated QA origin must be a fresh HTTPS hostname on a **separate**
  Tailscale node, explicitly enrolled by the operator. Its daemon socket,
  state, serve/Funnel config and local target must be separate from the primary
  node. Snapshot the primary Funnel JSON before and after. Never reset,
  redirect or turn off the primary 443/8443/10000 routes. Never reuse a historical
  hostname, board, store, key, archive or expired time window.
- Have a signed-in ChatGPT QA account with permission to upload a plugin
  archive and a disposable Dim0 Owner using a separate browser profile. The
  operator must explicitly install/connect and approve the OAuth grant. If
  no isolated node or authorized QA account is available, stop before public
  exposure. Do not attempt to use the ordinary/presentation app instead.
- Attended maximum window 30 minutes **from fresh root creation**. Use an
  independent supervisor with a deadline and guaranteed cleanup of ONLY the
  dedicated route, process groups, node state and disposable store. Prepare
  build dependencies and the native bundle before opening the window.
- Catalog QA is separate from the loopback typed-record flags. Only the
  selected Owner board gets catalog discovery, consent and native projection.
  Browser catalog mutation and view-share routes stay off. All catalog
  storage writes still use the existing server-only Jazz transaction.

## Local preflight (no public endpoint)

Use Node 26 (or a compatible Node release supporting node:sqlite and the
process-local TLS CA API), openssl, and installed Playwright Chromium.
Run these in the reviewed checkout:

    node --test scripts/test-package-dim0-openai.mjs
    cd integrations/patchboard
    pnpm test:qa:https-catalog
    pnpm test:native:mcp-table-create
    PATCHBOARD_QA_TYPED_RECORD=0 pnpm test:private:ci
    PATCHBOARD_QA_TYPED_RECORD=1 DIM0_QA_LIVE_SETTINGS=1 pnpm test:private:ci
    pnpm verify

The HTTPS fixture uses a reserved .localhost hostname, real loopback TLS
and a disposable certificate trusted only by the test process/children.
Its archive is for package validation only; never upload it to ChatGPT.
Virtual passkeys and an SDK client are not installed-client evidence.

## Prepare a dedicated public window

Build webui in a clean environment with VITE_DIM0_JAZZ_CANVAS=1,
VITE_DIM0_QA_NATIVE_CATALOG_READONLY=1,
VITE_DIM0_QA_NATIVE_SAVED_VIEW=0. Keep all other QA/presentation flags off.
Use a fresh output directory. Confirm the JS entry asset hash from index.html
and compare the actual HTTPS bytes after the route is opened.

The operator first enrolls a separate Tailscale daemon under a separate
socket and verifies its DNSName is the approved QA hostname and differs
from the primary daemon. Confirm there are no routes on the new daemon.
Do not persist credentials or auth keys in the repository or evidence.
Choose two unused loopback ports for private backend and native Vite preview.
The preview must use --host 127.0.0.1 --strictPort, an exact
DIM0_JAZZ_PUBLIC_HOST, the selected PATCHBOARD_PRIVATE_PORT,
VITE_DIM0_JAZZ_CANVAS=1 and PATCHBOARD_QA_HTTPS_TEXT_TABLE=1 **in the preview
process** so the four existing proxy prefixes preserve Host; the backend
initially has PATCHBOARD_QA_HTTPS_TEXT_TABLE=0 for enrollment only.
Forward the dedicated node's HTTPS root to this preview, never a backend
or frontend running against another store.

Fresh store setup (replace placeholders with verified values; run in a
dedicated shell with no inherited application environment):

    umask 077
    export PATCHBOARD_PRIVATE_ROOT="$(mktemp -d "${TMPDIR%/}/dim0-plugin-https-qa-XXXXXXXX")"
    export PATCHBOARD_PRIVATE_ORIGIN="https://<dedicated-node>.ts.net"
    export PATCHBOARD_PRIVATE_PORT=<unused-backend-port>
    export PATCHBOARD_PRIVATE_DEV=1 PATCHBOARD_PRIVATE_DIM0_ONLY=1 PATCHBOARD_OAUTH_CI_RESTART=1
    export PATCHBOARD_QA_TYPED_RECORD=0 PATCHBOARD_QA_HTTPS_TEXT_TABLE=0 PATCHBOARD_ACC051_INFLIGHT_QA=0
    cd integrations/patchboard
    pnpm auth:migrate:private
    pnpm --filter @patchboard/server exec tsx src/private-demo.ts

The auth store and Jazz store are separate under that root. Check auth
user/passkey/grant counts are zero before signup. Start the native preview
on the separate port. Use the dedicated socket only, e.g. verify
tailscale --socket="$QA_SOCKET" status --json then
tailscale --socket="$QA_SOCKET" funnel --bg --https=443 "http://127.0.0.1:$QA_UI_PORT".
A separately owned supervisor must turn off this route and stop/retire the
node on exit or the deadline. Do not run these commands on the primary node.

Check HTTPS /signin returns the native build and the old /patchboard-private/
entry returns 302 to /signin. Create a disposable Owner by passkey, and create
one board using the native /boards controls. Verify Owner role and zero
datasets. Stop the **dedicated backend**, retain the same root, then seal the
one approved board using the helper below. It creates the mode-0600 marker
and a private shell environment file; it refuses an existing seal, symlink,
wrong root or wrong origin. Do not print or commit the private shell file.

    cd integrations/patchboard
    node apps/server/test/seal-https-catalog-profile.mjs <owner-board-uuid>
    . "$PATCHBOARD_PRIVATE_ROOT/.qa-catalog-env"
    pnpm --filter @patchboard/server exec tsx src/private-demo.ts

The preview continues with Host-preserving proxy. Recheck actual HTTPS
asset, /boards/<id>, native empty Data panel, browser Create table absent
and authenticated direct records/tables/create POST 404. Server must not
advertise table:create before the seal. Wrong Host must return 421.
Use a separate off-tailnet device or approved external probe for public
reachability; do not infer it from a local socket.

## Package, upload and consent

From repo root:

    export DIM0_MCP_URL="$PATCHBOARD_PRIVATE_ORIGIN/patchboard-private-mcp"
    export DIM0_PLUGIN_OUTPUT_DIR="<new private output dir>/stage"
    node integrations/dim0-mcp-plugin/scripts/build.mjs
    DIM0_QA_CATALOG_DISCOVERY=1 node scripts/test-dim0-plugin-oauth-discovery.mjs
    shasum -a 256 "$DIM0_PLUGIN_OUTPUT_DIR/../dim0-jazz-mcp-plugin.zip"

Inspect the archive manifest, exact endpoint and digest. The MCP challenge
and issuer metadata must advertise both board:write and table:create.
Default client registration scopes remain unchanged; installed client
behavior is not assumed. In ChatGPT, open Plugins, Add, Upload plugin archive,
then Add plugin (actual labels may vary by account). Capture the actual
installed name, consent picker, requested scopes and selected board. Verify
the stored consent for the selected client/grant includes BOTH scopes; if
the client does not request table:create, stop at that checkpoint. Never
edit consent records or elevate old grants to make a test pass.

In the installed connection discover call-api-write. Ask it to invoke exactly
dataset.create.v1, substituting the verified board and one new request ID:

    {
      "operation": "dataset.create.v1",
      "input": {
        "board_id": "<approved UUID>",
        "request_id": "<fresh request ID>",
        "name": "Plugin rehearsal",
        "primary_field_name": "Title",
        "default_view_name": "All rows"
      }
    }

Capture the actual installed-client result with datasetId, fieldId and
defaultViewId. Replay identical input and request ID; require replayed:true
and the same IDs. No fall back to create_note or canvas entities. Open
native Data > Plugin rehearsal > All rows; match Title and exact DOM
data-dataset-id, data-view-id and data-field-id with authenticated Owner
metadata. Stop and reopen the backend with the same isolated store/valid
seal, and repeat. Audit actual durable datasets/fields/views/receipts/events
using the stopped-store helper below. Require one of each, zero records.
Do not use direct Jazz mutation or SDK creation as installed evidence.

## Disconnect and retire

Use native Settings > Connected apps, verify the correct client, click
Disconnect and observe confirmed Disconnected. In the installed plugin use a
new request ID and distinct table name. If ChatGPT requests reconnection
before sending a call, record that instead of attributing HTTP401 to it.
Only a correlated server request may support a server HTTP status. Capture
the displayed result and an independent Owner read/audit with unchanged
counts. The SDK regression independently requires HTTP401, not merely a
network failure. Keep tokens, cookies, authorization codes, headers, signed
cursors and invitation credentials out of screenshots and logs.

While the backend is stopped, run from integrations/patchboard:

    pnpm --filter @patchboard/server exec tsx test/audit-https-catalog.mjs

Retire the dedicated Funnel with its own socket, verify no routes remain,
stop only its frontend and backend process groups and retire the disposable
node/state and store. Verify the dedicated public origin is no longer serving
the candidate; compare primary Funnel JSON with its baseline. Record observed
status or network error separately from the SDK 401 proof. Do not leave a
public QA service running unattended.

Return exact tested SHA, archive digest, observed installation/discovery/consent
labels, three stable object IDs, before/after counts, restart, disconnect and
route retirement evidence. Mark every unavailable checkpoint NOT RUN with
the first blocker. Production supervisor crash recovery and public release
approval remain separate.
