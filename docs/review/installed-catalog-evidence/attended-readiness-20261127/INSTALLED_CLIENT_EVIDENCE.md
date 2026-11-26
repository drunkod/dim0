# Attended installed-client acceptance evidence — PR #28
Candidate: 66789d1a59f14ea35b6c1629fd4880ea3ce5159b
Status: NOT_RUN. Do not fill an observation with SDK evidence.

## Readiness before store creation
- Exact clean candidate and asset manifest SHA-256: verified in native-asset-manifest.json.
- Local entry: /assets/index-DlH0LwUW.js
- Entry SHA-256: 626a5b2b7e940174cd111e4b0b0187120c5bac70fc877c675cdaea8107313f48
- Dedicated node approved by operator / fresh DNS name: NOT_RUN
- Authorized ChatGPT QA account, Plugins page and upload permission: NOT_RUN
- Independent 30-minute teardown supervisor ready: NOT_RUN
- Primary Funnel baseline for actual run (resnapshot immediately before opening): NOT_RUN
- Dedicated socket initial Funnel empty, fresh node vs primary DNS check: NOT_RUN

## Actual public run — all fields are observations, not expected values
Record UTC start/root birth/deadline, off-tailnet probe, HTTPS origin, exact served index and JS digest.
Record native /signin and /boards/<id> status, legacy redirect status.
Record zero initial durable counts, Owner role, authenticated browser-create 404, fully settled empty Data screenshot.
If enrollment returns /api/me 500, record method, route, response status, request timing, backend error class and server correlation ID (no cookie or body dumps).

Public archive ZIP SHA-256: NOT_RUN
Packaged MCP endpoint and challenge scope values: NOT_RUN
Actual ChatGPT upload labels, installed plugin name, connection type: NOT_RUN
Actual consent scopes and board selection: NOT_RUN
Verified stored scopes and discovery includes call-api-write: NOT_RUN

## Stop at missing table:create consent or discovery
Do not elevate or edit a grant. Preserve requested/consented scope names, discovery result, and sanitized error.
If successful, issue exactly one fresh request ID, use the identical payload on replay:
{"operation":"dataset.create.v1","input":{"board_id":"<approved-board-uuid>","request_id":"<fresh-request-id>","name":"Plugin rehearsal","primary_field_name":"Title","default_view_name":"All rows"}}

First result / replay result / native DOM metadata / after restart:
datasetId: NOT_RUN
fieldId: NOT_RUN
defaultViewId: NOT_RUN
replayed:true: NOT_RUN
Native read-only grid screenshot and authenticated owner readback: NOT_RUN

| Durable object | Baseline observed | After creation/replay observed | After restart observed | After disconnect observed |
|---|---|---|---|---|
| Datasets | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Fields | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Views | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Receipts | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Events | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |
| Records | NOT_RUN | NOT_RUN | NOT_RUN | NOT_RUN |

Expected counts for comparison only: zero baseline, then 1/1/1/1/1/0.
Exact connected app disconnected / observed state: NOT_RUN
Fresh installed-client request ID and actual displayed outcome: NOT_RUN
Server-correlated request status (or no call reached server): NOT_RUN
Owner retained access / unchanged counts: NOT_RUN
Dedicated public route retirement (external probe): NOT_RUN
Primary Funnel unchanged after cleanup: NOT_RUN

Exclude tokens, cookies, Authorization headers, auth codes, PKCE verifiers,
invitation credentials, enrollment URLs and secret files. Do not upload the old
local fixture archive or reuse any historical endpoint. The dedicated node
probe is not public retirement evidence.
