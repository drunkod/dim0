# Native Dim0 sign-in and sharing on Jazz — PR #4 handoff

Date: 22 November 2026
Branch: fix/dim0-native-jazz-access
Base: fix/jazz-route-shell-20261122 (PR #3)

## Integration

- The original Dim0 `/signin` and `/signup` cards use Better Auth passkeys
  through the Jazz identity client, without duplicate Patchboard UI.
  Password/Google remains in flag-off builds; no credential migration.
- The signed-in Jazz list at `/boards` and the board header share a sign-out
  action. Private account caches are reset, and Back/reload recheck identity.
- Protected board URLs, nested surfaces and search parameters survive sign-in.
  A temporary identity failure shows Retry rather than claiming sign-out.
- The original Share dialog handles Jazz roles, reusable invitations, preview,
  single-link revoke, member removal and owner-authorized bulk revoke.
  Bulk revocation keeps existing memberships.
- Both `/share/join/:id` and `/jazz-invite/:id` use one redemption policy.
  Confirmed HTTP 404 is terminal; temporary failures preserve the invite and
  show Retry/Cancel. Cleanup is conditional on the original board/code.
  ChatGPT OAuth continuation retains precedence over saved invitations.
- A canonical READ 401/403 clears the private graph and exits the open board,
  even with a blocked local draft. A denied write alone cannot prove removal,
  because a viewer may still have read access.
- The Tests workflow now runs on both stacked Jazz PR base branches.

## QA acceptance evidence

Isolated MacBook/Helium proof with disposable identities covered two editors
using one reusable link, edits observed by the owner, conflict 409, viewer
write denial, temporary join 503 recovery, revocation, Disable sharing without
stripping members, expired-link handling and sign-out/sign-in bookmark return.

After owner removal, the member's next read and write returned 403 and their
open browser left the canvas for `/boards?access=removed` with an alert.
A separate Helium 503 fault-injection test confirmed protected-route Retry
with the exact applet destination, plus invitation Retry/Cancel and recovery.
The passkey test now removes the old virtual authenticator before reattaching
the saved QA credential on another page.

Regression commands:

```sh
node --experimental-strip-types --test webui/src/features/board/jazz/jazz-invite-lifecycle.test.mjs
(cd webui && ./node_modules/.bin/vitest run src/routes/root-layout.test.tsx src/features/board/jazz/jazz-session-unavailable.test.tsx)
(cd webui && npm run type-check)
(cd webui && ./node_modules/.bin/eslint src/routes/index.ts src/features/board/jazz/*.tsx)
# QA-only: never use the production presentation origin with write tests.
(cd integrations/patchboard/apps/web && node test/dim0-jazz-auth-outage-proof.mjs)
```

The full friends-share script requires an owner-authenticated QA board open in
a loopback CDP browser and creates disposable accounts/boards.

## Release boundaries

Deploy the web UI and Jazz server together: invitation preview and bulk revoke
are new endpoints. The public presentation build was not changed.

Historical credential linking, old memberships and URLs, unrelated data
migration, permanent domain publication, and an independent friend's ChatGPT
write remain separate checks. A short video, if captured, must show QA only,
with invitation codes obscured.
