# PR #28 — actual installed-client Helium acceptance

**2026-11-27 — candidate `66789d1a59f14ea35b6c1629fd4880ea3ce5159b`**

**Result:** browser-native custom MCP plugin **PASS** for consent, tool discovery, create, identical replay, native persistence, disconnect, denied fresh creation, and isolation/retirement. Portable archive-to-browser invocation **NOT PASSED**. Original archive upload hit an existing-name collision; a name-only QA variant uploaded as a cloud plugin but offered desktop rather than browser invocation. Desktop invocation was not tested. No app source change, merge, or deployment.

## Preflight and public endpoint

- Connected to existing Helium using local WebMCP skill; inspected per-page tools and used browser UI automation for unsupported actions. Local helper referenced a stale CLI path; used installed Chrome DevTools CLI and CDP. Actual ChatGPT installed-client tool calls, not SDK substitutes.
- Fresh separately enrolled userspace Tailscale node; empty initial Funnel configuration; primary Funnel unchanged. Disposable QA store and Owner board. Virtual passkey for test account only; physical passkey not tested.
- Retired origin: `https://dim0-catalog-qa-52113cbf.tail70b8a.ts.net`. Native HTML/JS matched preserved build; entry `/assets/index-DlH0LwUW.js` SHA-256 `626a5b2b7e940174cd111e4b0b0187120c5bac70fc877c675cdaea8107313f48`. Legacy entry redirected to /signin (302). Independent off-tailnet baseline probe inconclusive, but actual cloud ChatGPT client reached and used the server.
- Owner sign-in /api/me 200. Native Data empty, stopped-store catalog all zero. Direct browser create 404. Prior transient /api/me 500 remains unexplained.

## ZIP and actual client

| Checkpoint | Observation |
|---|---|
| Canonical public archive digest | `a14bf61b9d4a29431cb4829316a1e12d136b677f44def2c4285a5520e3ab993b` |
| Upload original | FAIL: A plugin named dim0-jazz already exists. |
| Unique-name test archive | `dim0-jazz-qa-52113cbf`, SHA-256 `7bf4c9c1585c7cc7499a8c88f8441a42faa79c26193528bf0d2af2ad9e30f0b2` |
| Variant modification | Only manifest name changed; all other ZIP entries byte-identical. |
| Variant upload | PASS; Dim0 Jazz Board, Your cloud plugin, Open in desktop app. Browser picker did not expose it. |
| Actual browser-native alternative | Add custom MCP server, Create as a plugin, Connect app; Dim0 PR28 Helium QA 52113cbf |
| OAuth discovery | DCR; discovered board:read, board:write, table:create selected automatically; no manual scope widening |
| Consent | PASS: selected Installed client catalog QA (owner); persisted scoped grant v1 |
| Tool discovery | PASS: Apps 1, Write 7, Read 5; call-api-write available for dataset.create.v1 |
| UI classifier | First invocation warned Suspicious Instruction about QA/allowlist framing and consent wording; inspected exact operation and selected Allow once, not Always allow. |

## Create and replay

Actual ChatGPT chat invoked the browser-native plugin against the isolated public QA endpoint. The visible result reported replayed false for creation and true for identical request replay. Native DOM and stopped-store Jazz audit corroborate all returned IDs; the two displayed responses are not raw wire captures.

Request ID: `plugin-rehearsal-1b023953-a31f-41f1-a988-2dcd11e25678`. Name Plugin rehearsal, primary field Title, default view All rows.

| Object | ID |
|---|---|
| datasetId | `5927b038-fc07-5a59-9a82-c0f9fe017169` |
| fieldId | `5747b750-8182-57c2-88b1-5357e3d61e15` |
| defaultViewId | `f92f3db8-99fe-5a9d-90ae-9618e2799fb1` |
| receiptId | `c658dc19-ed56-59bd-87d7-8964605e92ff` |
| eventId | `4a534b79-5b9a-51e3-b029-4c535b78836e` |

Native grid identifiers matched after creation, after backend restart, and after disconnect. Independent stopped-store audit:

| Object | Baseline | After replay | After disconnect |
|---|---:|---:|---:|
| datasets | 0 | 1 | 1 |
| fields | 0 | 1 | 1 |
| views | 0 | 1 | 1 |
| receipts | 0 | 1 | 1 |
| events | 0 | 1 | 1 |
| records | 0 | 0 | 0 |

## Disconnect and retirement

Native Settings returned 200 for disconnect; persisted grant `9254b111-34f5-4680-bdb4-4d9654a71b92` moved from v1 active to v2 revoked. Actual fresh request used `after-disconnect-c7efc005-d556-4ce5-a9b3-96596b6c36fe`. ChatGPT displayed: UNAUTHORIZED: Error code: UNAUTHORIZED; Error: McpServerError: Client error '401 Unauthorized'. No reconnect or reauthorization performed. **Client-reported 401 only; no correlated server HTTP trace captured.** Independent post-disconnect audit proves no new table, field, view, receipt or event; Owner still reads the same grid.

Explicit retirement before deadline: Funnel disabled, disposable store and separate node state removed, public route no longer active, primary Funnel JSON unchanged. Local HTTPS probe timed out (HTTP 000); a second probe forced a global address returned by Google Public DNS (rather than a tailnet address) and also timed out, curl exit 28/HTTP 000. That is a public-route probe from the MacBook, not a second independent external device. Two newly created QA plugin entries are retained for inspection; their endpoint is retired and the grant revoked. Existing plugins were not replaced or removed.

## Evidence and remaining work

- [Machine-readable redacted worksheet](helium-acceptance-redacted.json)
- [Actual selected-board consent](custom-connector-consent.png)
- [Native grid after backend restart](after-restart.png)
- [Disconnected client in Settings](native-disconnected.png)
- [Native grid after disconnect](after-disconnect-native.png)

Portable ZIP: fix collision-safe QA naming and determine supported browser invocation path, or explicitly document desktop-only archive behavior. Browser-native app: review tool-description classifier warning and improve request correlation for the denial path without weakening consent. Independent public baseline and physical-passkey acceptance remain unproved. No additional user interaction required during this run. Prior seven hosted checks on the exact candidate remain green.
