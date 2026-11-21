# Evening Demo Release — Dim0 / Jazz sprint

Date: 2026-11-21. Branch: `feat/jazz-mcp-tailscale-migration`. Baseline `5d50ca91`.

## Ship decision

**Browser collaboration is release-tested on the MacBook's existing HTTPS origin.** The old
Patchboard frontend is not the entry point; Dim0's native React passkey and Jazz
invite flow handle friend onboarding.

**Independent friend's ChatGPT account is an external acceptance gate.** This
agent's already-authorized ChatGPT MCP connector successfully created and updated a
canvas note on the presentation board, and the owner's authenticated browser read
the created note. This is not equivalent to a second real ChatGPT account completing
its own OAuth consent, which has not been observed during this sprint.

## Changes

- Terminal invitation redemption `404`: clear matching pending code, keep
  verified identity signed in, display a meaningful error, load board list.
- Temporary HTTP 5xx or network failure: keep code, display Retry and Cancel;
  neither transient error nor failed dashboard load signs the user out.
- ChatGPT OAuth continuation takes priority over unrelated tab invitation;
  provider still validates signed PKCE/redirect state.
- Direct invitation landing now clears its matching pending code on `404`.
- Concurrent card modification: server continues rejecting stale edits with
  `409`; user gets a persistent explanation and a **Copy local draft** action
  to save local JSON before reloading (not automatic conflict merging).
- Browser harness: parameterized owner board and public origin, CDP host
  restricted to loopback; QA tests include stale-version conflict, new friend
  opening revoked link, signed-in user with old link, transient retry.

## Acceptance evidence

| Gate | Result |
|---|---|
| Frontend production-mode candidate build | PASS |
| Frontend `npm run type-check` | PASS |
| Focused transport and invite tests | 14/14 PASS |
| HTTPS friend browser acceptance | PASS — owner, 2 editors, viewer |
| Edits from two editors + stale-version `409` after reload | PASS |
| New registrant with revoked invite reaches authenticated dashboard | PASS |
| 503 retains pending link; retry gives 404 and clears it | PASS |
| Member removed cannot read; revoked reusable link no longer redeems | PASS |
| Private OAuth/MCP acceptance CI | PASS, including two-writer attribution and restart |
| Live MCP connector -> presentation board create/update | PASS using current account's OAuth grant |
| Owner browser reads the MCP-created note | PASS |
| Second real friend's ChatGPT account connects & writes | **NOT YET VERIFIED** |

## Operational safeguards

Public data root on the MacBook: `/tmp/dim0-jazz-mvp-public-nov21`.
SQLite consistency-checked backup at
`~/Library/Application Support/Dim0/PrivateBackups/20261121-190322/`.
Prior static frontend saved at
`~/Library/Application Support/Dim0/PreviousBuilds/20261121-190758/dist-jazz-public`.
Only the static frontend was switched; database, OAuth server, and tunnel
were not restarted. The server's temporary Cloudflare hostname remains in
place. This is a demonstration host, not durable production hosting.

## Handoff for the user

Public sign-in:
`https://barbie-discovery-bingo-system.trycloudflare.com/jazz-signin`

Public MCP endpoint (each friend must authorize independently):
`https://barbie-discovery-bingo-system.trycloudflare.com/patchboard-private-mcp`

Presentation board:
`https://barbie-discovery-bingo-system.trycloudflare.com/boards/01a1fdec-1b8f-7e30-af11-3a09df695fc5`

For a *new* friend, open presentation board -> Share -> create a **fresh Editor
invitation**, and send the full `/jazz-invite/...#invite=...` link privately.
The board-only URL is not an invitation. Have the friend register and join,
then connect the MCP endpoint from *their own* ChatGPT account. Grant exactly
the presentation board. Ask ChatGPT to list canvas entities, create a note and
rename it; verify the same entity in the owner's browser.

Do not claim the whole Dim0 backend has migrated to Jazz. Shared applet
runtime, documents/uploads, offline recovery, and some legacy services are
separate later migrations.
