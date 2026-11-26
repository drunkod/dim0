## Scope and review status
Based on #27 at `483373aaa173fc3272ae4ab73e8474b4d57cf8f4` ([5/5 hosted jobs passed](https://github.com/drunkod/dim0/actions/runs/45888378725)). Candidate `66789d1a59f14ea35b6c1629fd4880ea3ce5159b`. **Local engineering proof PASS; installed ChatGPT-plugin acceptance NOT RUN.** The existing Tailscale node has live presentation and other routes. No separate enrolled QA node or attended QA-account upload/consent was available. No public route was started or replaced, and primary Funnel JSON before/after is identical. This is a draft, not a release approval.

## Implementation
Selective adaptation of 120543ad, 136e1026, a0020f94 and 3ea65949. Explicit isolated HTTPS opt-in, exact canonical origin and Host, one current Owner board, fresh temp child root with private seal and maximum 30-minute age, separate auth/Jazz stores, live expiry check. Existing loopback QA and default feature-off remain intact. Existing board:read/write defaults are unchanged. HTTPS challenge and issuer advertise table:create; actual consent for both board:write and table:create is required. Browser catalog creation and other typed writes/shares remain denied in the isolated profile. Native Data is read-only. Legacy entry redirects to native application. No Jazz schema/lock change. The plugin skill uses the one allowlisted operation and unchanged replay identity; never substitutes a canvas card.

[Attended operator runbook](https://github.com/drunkod/dim0/blob/66789d1a59f14ea35b6c1629fd4880ea3ce5159b/integrations/patchboard/docs/QA_INSTALLED_CATALOG_RUNBOOK.md), seal helper and stopped-store audit are committed. Public activation requires the separate node and human QA account; do not use the existing presentation origin. No installed tool descriptors or consent labels were invented.

## Exact-head local HTTPS SDK + native proof
Disposable loopback TLS origin `https://dim0-catalog.localhost:57439` (retired; not a public endpoint). Fresh owner signs up via a virtual passkey. Native served asset `/assets/index-DlH0LwUW.js` exactly matches candidate build, SHA256 `626a5b2b7e940174cd111e4b0b0187120c5bac70fc877c675cdaea8107313f48`. Legacy route 302, wrong Host 421, direct browser create 404, forged sibling-board consent 403, old board:write-only grant denied, other browser typed writes denied. SDK client used actual browser consent with board:read, board:write, table:create on the approved Owner board. Initial catalog all zero. Actual SDK discovery and call-api-write create Plugin rehearsal / Title / All rows.

| Object | First, replay, native and after restart |
|---|---|
| Dataset | `20a9cdea-301f-5e13-a886-00335e23e5ad` |
| Primary field | `56632f4f-d4a6-5b62-8b8b-3ac4e5a41b02` |
| Default view | `76fc2f10-b3f1-51b9-9b67-ee9d7959d272` |
| Creation receipt | `1ecd4fc2-0bb6-5256-891b-f276af49f614` |
| Creation event | `720e054c-6893-562c-b293-6d4671ffd88b` |

Replay true; native DOM identifiers and authenticated Owner metadata match. Native Settings confirms disconnect. Fresh SDK invocation returned actual HTTP 401. Stopped-store audit confirms 1 dataset, 1 primary field, 1 default view, 1 creation receipt, 1 creation event, 0 records; scoped grant version 2 revoked and independent older scope grant remains. Expired profile 503. Local TLS/backend/UI/store retired; post-close request failed. No public Funnel was started.

Fixture ZIP digest SHA256 `b2abd28937ca8ea3e7e414d4d9b1fc49b3fac105899f11952da3eb11c4497ff7` (LOCAL_FIXTURE_ONLY; expired loopback endpoint, not installable public archive). Packaging and HTTPS discovery validation passed. Actual external archive digest, installed ChatGPT upload, installed plugin name, installed discovery/consent, installed create/replay/native and post-disconnect request, public retirement are NOT RUN; no public 401 is attributed to an installed client.

## Verification
- Exact-head local HTTPS preflight passed, including stopped-store audit and retirement.
- Packaging tests 16/16, native Data tests 9/9, webui typecheck and lint, loopback native MCP proof, private CI with QA off/on and full pnpm verify passed during this sprint.
- First commit 651a92d0 had an intermittent local signup/assets timeout. Final commit 66789d1a changes only the preflight test proxy: isolate upstream connections and require stylesheet readiness. Final exact-head preflight passed; one transient initial /api/me HTTP 500 remains in the trace, not a fully diagnosed product issue.
- Final-head packaging, component, QA-disabled and loopback native MCP reruns in progress at draft publication. Exact-head final results will be recorded separately.
- CodeGraph indexed 1563 files, 23980 nodes and 59340 edges. Profile callers cross auth/consent/MCP/native read gate. Recovery helpers remain test-only. No deployment or merge.

## Evidence notes
The consent image is from the actual disposable SDK OAuth flow (not ChatGPT). Its displayed client ID is a public synthetic OAuth identifier, not a credential. The native-grid image shows Plugin rehearsal / All rows / Title and the read-only rehearsal banner. Zero starting counts are proven by the authenticated API/stopped-store trace; the initial board screenshot did not capture the empty Data panel, so is not offered as visual proof. No access tokens, cookie headers, auth codes, invitations, or real account data are included.

## Hosted
Portable package workflow: https://github.com/drunkod/dim0/actions/runs/45890934836 (completed, success).
