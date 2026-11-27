# Human acceptance runbook — web-first MVP sprint

Updated 27 November 2026 for [PR #28](https://github.com/drunkod/dim0/pull/28), application revision `66789d1a59f14ea35b6c1629fd4880ea3ce5159b`. Web-first acceptance uses the **actual installed browser-native ChatGPT custom MCP plugin**, not the desktop ZIP path. All seven existing hosted jobs passed. This is a disposable QA demonstration, not production feature rollout.

## Recorded evidence — reuse without rerunning unchanged integrations

- [Actual Helium acceptance](https://github.com/drunkod/dim0/blob/30735a3cf394fcb7726422cd70d5d17198b27d9e/docs/review/installed-catalog-evidence/helium-installed-20261127/INSTALLED_CLIENT_ACCEPTANCE.md): DCR, explicit selected Owner board and board:read / board:write / table:create, call-api-write, create Plugin rehearsal, replay with identical IDs, native grid after backend restart, Settings disconnect HTTP 200, client-reported 401 on fresh call, unchanged durable counts (1 dataset, 1 field, 1 view, 1 receipt, 1 event, 0 records), Owner readback and teardown. The 401 has no correlated server HTTP trace. Virtual passkey; forced public-address probe after retirement timed out, not a second independent external device.
- On the unchanged #28 head in the web sprint review, schema generation and private permissions drift check, `pnpm test:native:empty-catalog` and `pnpm test:native:mcp-table-create` passed on disposable stores, including sign-in, table and row retry, filtered view sharing/revocation, restart and MCP disconnect. These are separate loopback QA profiles and use a real MCP SDK in the native MCP suite; neither is a second installed-client test.
- The HTTPS profile is selected-board read-only native Data with MCP table creation; the writable catalog and filtered sharing are loopback QA only. Do not claim one persistent public web workflow. [Handoff scope decision](https://github.com/drunkod/dim0/issues/29). Before promising reload-safe browser writes, resolve [retry identity loss](https://github.com/drunkod/dim0/issues/30).

## Merge queue and final smoke

1. Independent review and approval of #1 first; #3 and #4 prepared in parallel. Merge parent before child. Preserve each old parent head/branch and retarget the child only after merge; compare its Files changed with its original parent delta. Prefer merge commits to preserve ancestry; no squash without explicit retarget/diff verification. Keep #23 typography independent and #24 beta.5 upgrade deferred from the pinned alpha.69 web path.
2. The seven missing hosted-check cases (#3, #5–10) are due to historical workflow base filters. Use recorded local evidence as such, not descendant checks as certification. Retarget to main when appropriate and run normal hosted Tests on the actual merge candidate. Root hosted Tests do not replace Patchboard Jazz verify/private CI. No required main-branch rules were observed at review time.
3. On the actual final combined SHA, verify generated schema/private policies and migration ancestry using the pinned Jazz CLI; run the relevant native smoke for sign-in, board access, catalog create/replay, filtered sharing, restart, disconnect, and feature-off regression. If #23 is included, also run mixed Latin/Cyrillic typography smoke. Reuse previous results only if source/behavior is unchanged. The current candidate smoke is not a post-merge combined-head certification.
4. Reopen the installed-client rehearsal only for changed integration behavior or a specific regression. Do not re-run desktop or physical-device acceptance for web review.

## If a fresh installed browser-native rehearsal is necessary

Follow [the isolated operator runbook](https://github.com/drunkod/dim0/blob/66789d1a59f14ea35b6c1629fd4880ea3ce5159b/integrations/patchboard/docs/QA_INSTALLED_CATALOG_RUNBOOK.md) for fresh disposable root, dedicated enrolled node, exact build, sealed board, 30-minute window and teardown. Before opening route, check that the authorized ChatGPT account can add a custom MCP server and that the dedicated Funnel is available. Do not reuse production stores, credentials or routes.

- In ChatGPT Plugins, Add custom MCP server, enter dedicated HTTPS MCP URL, select OAuth / DCR, verify discovered scopes and create as a plugin. Connect to the selected disposable Owner board. Do not widen consent if discovery is wrong.
- Use actual installed plugin call-api-write / dataset.create.v1, Plugin rehearsal, Title, All rows. Reuse one request_id for identical replay. Match all returned IDs to native grid and stopped-store Jazz audit before/after restart.
- Disconnect in native Settings, attempt fresh creation without reconnecting, record the actual client result and independently verify unchanged catalog counts and Owner readback. Only call a 401 server-correlated when an actual trace is available.
- Retire the exact dedicated Funnel and store regardless of outcome, compare primary configuration and perform independent public reachability check if available. Save redacted evidence and first failing stage. No credentials in the report.

## Deferred milestones and issue owners

- [#32 Desktop ZIP naming and invocation](https://github.com/drunkod/dim0/issues/32): canonical-name collision, unique-name cloud upload opens desktop; manual desktop and release preparation deferred. Required existing CI stays enabled.
- [#31 Web integration diagnostics](https://github.com/drunkod/dim0/issues/31): intermittent /api/me 500 (escalate only if it recurs and blocks sign-in), factual tool-description wording and denied-request correlation. Owner: repository maintainer.
- #17/#27 production crash orchestration, physical passkeys, second human account and production-store upgrade are separate from this disposable web demo. Retain current consent, migration history and data-integrity safeguards.

**Current web status:** browser-native integration accepted on #28; local QA native workflows passed; actual combined main smoke and independent approval remain open. No production deployment or merge authorization implied.

The [previous attended runbook and email draft](https://github.com/drunkod/dim0/blob/3457000430628252a694226a74fc793fd0cf4954/integrations/patchboard/docs/HUMAN_ACCEPTANCE_RUNBOOK.md) are historical; the web-first instructions above supersede their ZIP-first acceptance gate.
