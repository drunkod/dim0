# Persistent web MVP — combined handover, 2026-11-27

**Engineering acceptance: PASS. Product identity and locale signoff: pending. Public rollout: not performed.**

## Exact tested application
- Merged main: `e7ffc6db79d010d91ae279518243b6375c4b2fc1` (#37 merged after 6/6 hosted checks and consent-to-commit review).
- Reproduction harness: `f7b857c422d43723db335dee84af8af56f3258a6` (direct child of main; only the existing native proof test and a test command in integrations/patchboard/package.json changed). All application sources, schema, policies, migrations, dependencies and lockfiles identical to main. Jazz 2.0.0-alpha.69 retained. CodeGraph and the repository Jazz skill plus official transaction guidance used.
- Isolated HTTPS loopback fixture, virtual passkeys, private non-temporary test root, catalog + filtered sharing + MCP flags enabled together throughout, QA flags off. One board, one store, no public hostname, no live user data, no production deploy. Fixture root removed at teardown.
- Reproduce with frozen dependencies on the harness SHA, from integrations/patchboard:

```sh
pnpm test:native:persistent-combined
```

The run exited 0 with COMBINED_PERSISTENT_WEB_PASS. Node runtime in the Mac fixture used NODE_OPTIONS=--no-experimental-webstorage. All original #37 local acceptance and private CI/verify results remain applicable; they were not rerun during this handover. Main post-merge hosted Tests: https://github.com/drunkod/dim0/actions/runs/45987774236.

## Same-table journey
| Checkpoint | Result |
| --- | --- |
| Empty native Data + stopped authority audit | All eight catalog counts zero |
| Real browser Owner consent + SDK | board:read, board:write, table:create explicitly consented; exact stored scopes |
| MCP dataset.create.v1 and identical retry | Same object IDs; replayed true; native grid matches |
| Add rows via native Data | Demo alpha, Internal planning, Demo beta; same MCP-created dataset and verified Owner writer |
| Save Demo items and actual clipboard link | Title prefix Demo; only Demo alpha and Demo beta, only Title; independent signed-in nonmember has zero boards/grants |
| Projection denials | Filtered-out record 404; extra field 400; wrong view, native list and canvas 403 |
| Restart | Same table/field/default and filtered view IDs, same records/writer, active link and old cursor usable, original creation replay unchanged |
| Native Settings disconnect | HTTP 200; exact grant version 2 revoked; 0 leases; no pending disconnect |
| Fresh SDK write | Actual HTTP 401; 401 again after subsequent restart |
| Final readback | Owner still sees all three rows; independent shared view remains active; stopped-store catalog rows exactly unchanged |

- Board: `01a21cb2-0d95-7220-89aa-2a7f093a59d8`
- Request ID: `663b4090-a4d4-43f3-9cea-0e3e04bc127a`
- Dataset: `70c1a07a-f403-50cb-a8c4-a8fdaecdff55`
- Title field: `1a66dcef-b025-595a-8517-27633bb84c3b`
- Default grid: `e4b2c934-3a23-5e04-a183-0b8e9bb261ba`
- Filtered grid: `e9e58d46-62be-4813-95d5-cfa758ad0209`
- Share metadata ID: `4b7adbd9-b73b-4740-b73c-b257cb2bfdbf`
- Creation receipt: `b8762011-9730-5ef8-9de3-4fc2fa971926`
- Creation event: `ffdebee4-67cb-5d1e-a0bd-796b8f4f1035`

| Durable objects | Initially | After restart and disconnect |
| --- | ---: | ---: |
| Datasets | 0 | 1 |
| Primary fields | 0 | 1 |
| Saved views | 0 | 2 |
| Records | 0 | 3 |
| Catalog receipts / events | 0 / 0 | 1 / 1 |
| Row receipts / events | 0 / 0 | 3 / 3 |

The shared view is deliberately left active during the disconnect checkpoint to prove share independence. The separate #36 proof covers explicit share revocation and next-fetch grid clearing. #30 covers reload-safe retry; #28 covers installed browser-client acceptance in the disposable profile. The combined run uses the SDK, not a new installed ChatGPT-client rehearsal.

## Product-owner signoff — actual presentation
The requested SashAI delivery identity is **not present** in this build. Actual document title and mobile web app title are Dim0; the consent page reads "Authorize a Dim0 connection"; the generated test-account display name still begins Patchboard. The captured board Data screen has no visible SashAI brand. No rebranding was applied in the test.

Browser locale was explicitly en-US. Fresh account preference was en; native Settings saved ru-RU with HTTP 200. After backend restart, Settings and the authenticated profile returned ru-RU. Document language stayed en and controls remained English. The UI explicitly states "This does not change the app language yet." This proves preference persistence, **not Russian UI localization**. The chosen ru-RU test value is a representative Cyrillic locale, not a claim that the product owner selected Russian as a release default. Product owner must approve the delivery brand and whether stored locale only is sufficient; otherwise handle brand/localization in a separate narrow increment.

## Evidence
- [Redacted machine trace](combined-persistent-web-trace.json)
- [Actual OAuth consent](sdk-consent.png)
- [Recipient after restart](recipient-after-restart.png)
- [Owner after disconnect](owner-after-disconnect.png)
- [Locale preference after restart](locale-after-restart.png)

All screenshots inspected: synthetic board/account/client identifiers only, no raw bearer/share token, callback URL, cookies, authorization header, invitation or private user data. Additional local synthetic screenshots and full logs retained on MacBook. No production worker fencing/recovery supervisor or public operational rollout verified; preserve those boundaries. #24 Jazz upgrade and desktop testing remain deferred. #33 remains open for product-owner identity/locale disposition and rollout decision, not further repetition of the demonstrated combined journey.
