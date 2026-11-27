# Human acceptance runbook — native board and installed ChatGPT catalog

Updated 27 November 2026 for [Dim0 PR #28](https://github.com/drunkod/dim0/pull/28), application revision `66789d1a59f14ea35b6c1629fd4880ea3ce5159b`. Local native-browser and OAuth/MCP SDK acceptance passed. The five Tests jobs and two packaging checks passed. Actual ChatGPT installation, public creation and public teardown are **NOT_RUN** at handoff.

## Start here

- **Programmer / QA operator:** follow the [attended HTTPS runbook](QA_INSTALLED_CATALOG_RUNBOOK.md) for the exact build flags, operator commands, archive packaging, stored-grant inspection and teardown. Use the preserved candidate build if its digest matches.
- **Evidence recorder:** fill the [installed-client worksheet](https://github.com/drunkod/dim0/blob/56d1a139cc5802446732e8a8b93e122a62234636/docs/review/installed-catalog-evidence/attended-readiness-20261127/INSTALLED_CLIENT_EVIDENCE.md). The [readiness record](https://github.com/drunkod/dim0/blob/56d1a139cc5802446732e8a8b93e122a62234636/docs/review/installed-catalog-evidence/attended-readiness-20261127/readiness.json) separates observations from outstanding steps.
- **Before creating the store:** the Tailscale operator signs in on a separate dedicated daemon and checks its DNS name and empty Funnel config. The ChatGPT QA account holder opens Plugins and verifies archive upload is available. Prepare an independent teardown supervisor and record the primary Funnel configuration. The 30-minute window starts at fresh store creation. If either account is unavailable, record BLOCKED before opening the route.

## One attended run

1. Serve the native build via the dedicated Funnel. Verify off-tailnet reachability, the served asset digest, native sign-in, and the legacy entry's redirect. Create one disposable Owner and board, seal the profile to that board, and record zero catalog objects. Verify direct browser table creation returns 404. Keep the primary routes and historical stores untouched.
2. Build a new ZIP for the actual public MCP origin and record its SHA-256. Upload via ChatGPT Plugins. Record the actual plugin name, selected board, requested and granted scopes, and discovery of `call-api-write`. If either `board:write` or `table:create` is missing, record the first unmet checkpoint and retire the route.
3. In the installed connection invoke `dataset.create.v1` for **Plugin rehearsal**, primary field **Title**, default view **All rows**. Generate one request ID and replay the identical input. Record the returned dataset, field and view IDs and the replay flag.
4. Open native Data on the selected board. Compare its grid and field IDs with the installed-client result. Restart only the dedicated backend on the same store and repeat. The stopped-store audit in the operator runbook should show one dataset, field, default view, receipt and event, and zero rows.
5. Disconnect that client in native Settings. Try another creation from ChatGPT with a fresh request ID. Record any reconnect prompt and whether the request reached the server. Attribute HTTP 401 only to a correlated request. Verify the Owner can still read the original table and the counts are unchanged.
6. Retire the dedicated route, verify disappearance from outside the tailnet and compare the primary configuration to its baseline. Teardown applies on success, failure or expiry. Record PASS, FAIL or NOT_RUN per step, the first blocker, source SHA and redacted evidence. Omit tokens, cookies, auth codes and enrollment URLs.

**Sprint signoff:** one actual installed-client create/replay, matching IDs after restart, observed disconnect, unchanged counts and observed public teardown. Record failures on PR #28. Repeat an automated suite only for a code change or a specific diagnostic need.

## Other human acceptance claims

Two independently controlled ChatGPT users collaborating on a board, physical-passkey return, and Firefox collaboration each need their own participants and evidence. The table-creation rehearsal uses one QA Owner. Track those broader journeys separately; production approval is a separate decision.

The [21 November Patchboard checklist and evidence](https://github.com/drunkod/dim0/blob/66789d1a59f14ea35b6c1629fd4880ea3ce5159b/integrations/patchboard/docs/HUMAN_ACCEPTANCE_RUNBOOK.md) preserve the earlier note demo, staging references and H1–H3 procedures. Its hostname, board, fixed ports and custom-connector instructions are historical.
