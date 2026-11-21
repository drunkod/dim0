# Original Dim0 authentication and sharing — Jazz parity audit

Date: 22 November 2026
Audit source: original fork implementation and the stacked Jazz route-shell/access PRs.
Candidate branch: fix/dim0-native-jazz-access; keep PR #3 and #4 in review.

## Confirmed reuse of original fork

- Frontend login and registration screens: original Dim0 SigninPage / SignupPage and AccountCard, with the Better Auth passkey provider in Jazz mode.
- Board Share entry point: original ShareButton and ShareDialog; separate JazzShareDialog deleted. Existing role toggle, Copy, Revoke, Disable sharing, and People with access remain.
- Invitation presentation: the original shared invite-panel components; Jazz-specific delivery needs the board ID and opaque fragment token.
- Business rules: Edit vs View, upgrade-only acceptance, multiple users per reusable link, owner-only revocation, all-link Disable sharing without removing granted members, viewer write denial, and membership removal.
- Login recovery: exact bookmarked board/applet destination is retained; failed identity reads offer Retry; logout clears session-scoped state.
- Frontend Jazz routes select their layout before loading legacy authentication effects.

## Parity fixes in the current candidate

- The Jazz invitation role is previewable before registration with an anonymous POST carrying a 43-character opaque token in the request body. The server returns only the invitation role; it does not issue a membership. It keeps the existing same-origin POST check.
- A revoked, invalid or expired code gets a terminal 404. A temporary preview/service failure still shows Retry/Cancel. Original share preview was anonymous; requiring sign-in first was a regression.
- Reusable Edit/View links do not expire automatically. One-time links keep their seven-day expiry. The owner can revoke individual or all reusable links. The original fork's reusable links remained active until revoked.
- The original warning about board/nested content appears on Jazz boards as well as flag-off legacy boards.
- Browser regressions explicitly check anonymous role preview and viewer-to-editor upgrade with no subsequent downgrade. The original fork's acceptance policy is the reference.
- A disposable QA test created 205 reusable Jazz invitations, verified each had no automatic expiry, and confirmed owner-authorized Disable sharing revoked all 205 despite the list endpoint's 200-item display cap. A revoked token could not be redeemed.

## Gaps that must not be represented as completed migration

1. Old Dim0 password/Google identities are stored and authenticated by the legacy backend; Better Auth passkey accounts are separate identities. Sign-in through old credentials is not Jazz sign-in and identity linking is not implemented. The legacy auth screens remain available with Jazz mode off.
2. Existing POSTGRES-backed invitation codes under /share/:token are not Jazz invitation records. New Jazz links use /share/join/:boardId with an opaque token in the URL fragment. Do not silently reinterpret old tokens or claim that old memberships migrated. Retain the original resolver when legacy mode is used; plan an explicit migration or upgrade policy.
3. A distinct JazzBoardsPage still renders the signed-in Jazz board list. Its basic list is not feature-parity with the original Dim0 dashboard/sidebar.
4. The Jazz member list now resolves Better Auth display names through a server-maintained Jazz account reference, only after the owner passes the canonical board check. Unmapped accounts get an abbreviated member-ID fallback. Registration still creates generated passkey names; self-service personal display names and historical account linking remain separate rollout tasks.
5. The original Patchboard single-use link format still uses its older landing handler; the Dim0 Share dialog mints reusable links. Full invitation-route consolidation is separate.
6. A friend's successful write through their own ChatGPT account and Dim0 identity is still an independent release gate, not established by browser-sharing proofs.

## Owner-only member display-name parity (22 November 2026)

- The original Dim0 Share dialog now shows verified Better Auth names with an abbreviated Jazz ID suffix for disambiguation. It no longer misrepresents Jazz UUIDs as email addresses. Removal still uses the unchanged Jazz grant ID.
- A private identity-reference table links a verified Better Auth subject to its Jazz account ID. It stores no membership grants, copies no email addresses, and is updated only after authenticated /me or a valid, scoped OAuth consent. Member name lookup is limited to the board's current grant IDs after an owner-only access check.
- The full production-build Helium acceptance passed including JAZZ_OWNER_ONLY_MEMBER_DISPLAY_NAMES_PASS: owner and two friends' names matched verified identities, and a viewer received 403 for the member list. Two SQLite unit tests cover scoped lookup, unmapped IDs, remapping and conflicting subjects. Server tests and frontend TypeScript/ESLint also passed.
- A fresh, disposable private OAuth/MCP CI fixture passed PRIVATE_CI_ACCEPTANCE_PASS after the consent-path mapping was added. Its evidence includes OAuth PKCE, tool calls for shared applet state and canvas CRUD, independently authorized owner/editor writes, viewer write denial, refresh-token board scoping and restart attribution. It is NOT a real friend's ChatGPT UI account acceptance.

## Verification and rollout

- MacBook isolated QA uses a disposable Better Auth SQLite database, migrated with the repo's auth:migrate:private command, and a separate Jazz SQLite store.
- The public presentation deployment and its data are untouched.
- Frontend / server compile, invitation lifecycle, route layout, 503 recovery and independent Helium friend acceptance are the primary regressions.
- On 22 November 2026, a clean production Vite build with VITE_DIM0_JAZZ_CANVAS=1 was served through the QA-only Vite preview proxy, backed by an isolated Jazz and Better Auth store. A single combined Helium browser run completed: FRIENDS_SHARE_UI_ACCEPTANCE_PASS, FRIENDS_COMPLETE_PASS, OWNER_SIGNOUT_SIGNIN_BOOKMARK_PASS, and FULL_DIM0_NATIVE_JAZZ_ACCEPTANCE_PASS. The run covered two independently registered editors on a reusable link, a separate viewer, anonymous preview, role upgrades, 503 retry, 409 conflict, owner-visible edits, revocation, Disable sharing, stale-link recovery, member eviction, friend relogin, and owner bookmark return.
- The 205-invitation bulk-revocation stress check separately passed. Source checks remained green; the test-only Helium harness fixes include DOM-ready navigation, waiting for board-list hydration before injecting a pending invite, allowing a delayed access-revoked alert, deterministic native confirmation in dual-CDP QA, and a virtual-passkey cleanup fallback.
- QA log evidence on the MacBook (disposable data; not a real friend's ChatGPT account): /tmp/dim0-parity-all-green-rehearsal.log and /tmp/dim0-parity-bulk-revoke-205.log. The public presentation origin/data were not used in the test.
- Do not merge as a completed Jazz cutover. The web app and its matching Jazz server routes must be shipped together.
