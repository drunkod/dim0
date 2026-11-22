# Dim0 single-use invitation compatibility and presentation release verification

Date: 22 November 2026
Branch: fix/dim0-native-jazz-access; stacked on PR #3, reviewed in PR #4.

## Original Dim0 behavior retained

- Login and registration remain on the original Dim0 account screens and Better Auth passkey session.
- Shared-board membership, invitations and one-use redemption remain controlled exclusively by Jazz.
- The old server-created single-use URL (/patchboard-private/?board=<uuid>&invite=<opaque-code>) redirects in unified mode to /share/join/<uuid>#invite=<opaque-code>. It does not fall through to ordinary sign-in and lose its destination.
- Plain and OAuth /patchboard-private/ entries still redirect to /signin while preserving the original query; malformed or duplicate invitation parameters receive 400 with no-store, instead of an ambiguous login.
- The older Postgres /share/:token links have a separate resolver and are **not migrated** by this compatibility patch.

## Verified acceptance on disposable MacBook QA

- The redirect helper passed 3 deterministic tests; the same GitHub CI job also tests strict member-directory isolation.
- Server TypeScript checks and the private OAuth/MCP regression suite passed.
- A production Vite frontend built with VITE_DIM0_JAZZ_CANVAS=1 and the matching private server with PATCHBOARD_PRIVATE_DIM0_ONLY=1 were exercised on localhost:48770 / localhost:48771 with separate Jazz and Better Auth SQLite stores.
- A real Helium browser opened the **exact minted** single-use link and, without bypassing its redirect, previewed Edit permission, registered with a disposable passkey and landed on that same board. A second clean browser then saw the expired/revoked screen, and direct preview returned 404: SINGLE_USE_DIM0_REDIRECT_JOIN_AND_REPLAY_PASS.
- The complete existing sharing and logout acceptance passed in the same run: FRIENDS_SHARE_UI_ACCEPTANCE_PASS and FULL_DIM0_NATIVE_JAZZ_ACCEPTANCE_PASS.
- The QA release verifier matched the entry asset name and SHA-256 bytes and confirmed the dummy-token 302 redirect. QA asset: /assets/index-0lKh3ZEY.js, SHA-256 72ea48d2c3448759a87f15ec08c01b0c485ef3aa2d703814f568b15e0f8620bb.
- Only disposable QA boards were written.

## Public deployment gate (read-only check)

The public temporary HTTPS origin was verified separately. Its entry asset was still /assets/index-ndhgs_O8.js rather than /assets/index-0lKh3ZEY.js, so the candidate was **not** publicly deployed at the time of this audit. A 200 from the old /signin page is not evidence of this release. A GET to the old single-use entry on the public origin still forwarded the original board and invite query to the old sign-in route.

Run from the repository root after any authorized paired release:

    python3 scripts/verify-dim0-public-release.py https://barbie-discovery-bingo-system.trycloudflare.com

The script is read-only; it compares the entry asset name and actual bytes, then checks the new server's redirect using an unredeemable dummy token. After that, use a fresh QA invitation, independent editor browser, create/edit, and owner reload on the actual public URL.

## Do not deploy only half the pair

The public origin uses a different frontend worktree and a private server connected to a live Better Auth/Jazz store. Keep the current frontend directory and server checkout available as a rollback pair. Record exact process working directories, service launch environments, and a consistent backup before switching. The change needs no Jazz schema migration; do not restore live database snapshots during a code rollback because that would discard subsequent writes.

## Separate acceptance still pending

A friend must authorize the Dim0 connection from their **own ChatGPT account** and Dim0 passkey and edit the same QA card. Verify the same entity ID, higher version, their Jazz writer ID and owner-visible change after reload. A simulated independent browser account or a successful list_boards request is not this proof.
