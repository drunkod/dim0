# SashAI presentation: persistent HTTPS staging review

Application commit:  (PR #38). Base: .
Tested on the MacBook in a disposable local HTTPS persistent profile with virtual passkeys, QA flags off, one persistent store and board; two independent account sessions. No public deployment or installed ChatGPT client test.

## Acceptance

- SashAI document/mobile title and generated new-account label asserted by the browser.
- Actual Russian and English OAuth authorization pages shown below. Selected board UUID and the exact scopes board:read, board:write, table:create verified in each consent and stored grants. One authorized SDK table creation.
- Settings saves ru-RU with the existing versioned account API. Russian persists across page reload and backend restart. Save en to restore English; unsupported fr-FR renders English. Owner and recipient locales stay independent.
- Localized Data, Share and saved-view recipient. One original mixed-language row remains unchanged across restart and locale changes; catalog snapshot counts and identifiers preserved. Actual copied link used. One dataset, one field, two views, one row; one catalog receipt/event and one row receipt/event.
- Visual review of the screenshots confirms localized labels, original table/field/row names and protocol scope identifiers. Canvas tools, general sign-in, desktop and assistant localization are outside this slice. Screenshots contain only synthetic fixture account/client IDs, a retired loopback endpoint and fixture content. No token or share secret is displayed.

## Reviewed captures

- [Russian Settings after restart](settings-ru-after-restart.png)
- [Russian Data after restart](data-ru-after-restart.png)
- [Russian Share](share-ru.png)
- [Russian actual OAuth consent](consent-ru.png)
- [English actual OAuth consent](consent-en.png)
- [English Data restored](data-en-restored.png)
- [Independent Russian recipient](recipient-ru.png)
- [Machine-readable trace](sashai-presentation-trace.json)

## Verification

 in integrations/patchboard passed on the exact application commit above; an initial signup click timed out, and an unmodified retry passed. An earlier pre-commit Profile locator mismatch was corrected. 31 focused frontend tests and 29 focused server tests passed on the exact application commit; pre-commit web lint/typecheck, server typecheck, generated schema/private checks passed. CodeGraph and the repository Jazz Tools skill were used to trace authenticated preference and consent paths. No schema, migration, dependency, grant, or MCP execution change. The combined replay/disconnect evidence from #37 is reused, not rerun.

[Prior combined engineering acceptance](https://github.com/drunkod/dim0/blob/1e1be56ec5f3b83ca38107ef05b66afca15c0774/docs/review/persistent-web-handover-20261127/HANDOVER.md)

Product-owner visual signoff remains outstanding. This report is evidence for staging only, not a deployment or release.
