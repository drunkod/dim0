# Issue #43: native overflow menu, 430 px

Captured from an isolated persistent HTTPS fixture in installed Helium (agent-operated headed Playwright, synthetic account with virtual passkey). Screenshots reviewed visually; not independent human testing. No production data. Source base: d2ddb2fc; the production changes are limited to toolbar-more.tsx and the RU dictionary. The attached screenshots were produced from the corresponding working tree before its commit.

- [English menu](more-menu-en-430.png) · [Russian menu](more-menu-ru-430.png)
- [English tooltip](more-tooltip-en-430.png) · [Russian tooltip](more-tooltip-ru-430.png)
- Six visible items, shortcuts G/I, accessible trigger, hover tooltip, keyboard Enter, Escape/focus return and viewport bounds verified. 6/6 EN/RU board layout checks at 430, 360 and 1440 px passed; Back, Data, Share and dialogs remained reachable.
- Focused Vitest: 8/8 (4 toolbar + 4 localization). TypeScript/ESLint passed. The mounted-menu component test switches the confirmed locale both ways without remount and verifies the disabled explanation, original actions and badges.
- Separate local signed-out board at 430 px: same open menu and document survived EN→RU→EN, Document stayed disabled with localized title; no provider key or account was present. A test-only confirmed-locale event was injected because the local signed-out route has no language preference UI. The native account test changes locale through Settings and revisits the board. The local test needed a disposable Vite config to resolve the existing symlinked dependency directory; no product config change. The local board also exhibits a legacy header overlap unrelated to the native menu fix.
- Reproduce the native proof: `cd integrations/patchboard && pnpm test:native:sashai-narrow-chrome --helium`. Without --helium it uses Playwright Chromium.
- Full synthetic fixture evidence on the MacBook: helium-human-acceptance-20261128/issue43-helium and issue43-local-live-corrected. No independent manual acceptance performed.
