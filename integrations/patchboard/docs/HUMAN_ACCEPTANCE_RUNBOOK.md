# Patchboard — human acceptance and operations runbook

**Maintained status: 21 November 2026 (+05:00).** Source of truth: [`main` at `6f36a35`](https://github.com/drunkod/agent-staff-board/commit/6f36a35). **Current disposition: CONDITIONAL GO for a single-account demonstration; NO FULL GO for two-human ChatGPT acceptance or real private user data.**

This document is the **current human checklist**. The earlier [guest M2 release report](M2_PUBLIC_FUNNEL_RELEASE.md), [private public-OAuth QA log](PRIVATE_OAUTH_PUBLIC_FUNNEL_QA.md), and [November 20–21 architecture review](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md) retain their historical evidence; a statement marked “pending” in one of those older reports describes its original checkpoint, not necessarily today's status.

## 1. Precisely what has passed

| Claim | Status at this handoff | Evidence |
| --- | --- | --- |
| Main branch implementation and CI | **PASS** at `6f36a35`; `check` and `private-oauth` GitHub jobs passed | [PR #7](https://github.com/drunkod/agent-staff-board/pull/7), GitHub Actions |
| Guest public demo, SDK MCP create, Jazz WSS and two browsers | **PASS via MacBook public HTTPS**; *not* a real guest ChatGPT connection | [Guest release report](M2_PUBLIC_FUNNEL_RELEASE.md) |
| Private board owner/editor/viewer roles, passkey, OAuth PKCE, board-scoped consent, viewer denial, two simulated MCP writers, durable restart | **PASS** in isolated automation and public SDK rehearsal; *not* two independent ChatGPT accounts | [Private OAuth QA](PRIVATE_OAUTH_PUBLIC_FUNNEL_QA.md) |
| Private browser edit/move through server; viewer denied; author preserved | **PASS** in CI and a live two-Helium-account staging rehearsal | [Edit/move fix](PRIVATE_NOTE_EDIT_MOVE_FIX.md), PR #7 |
| **One real ChatGPT.com account:** DCR + OAuth, private board `read_board`, `create_note`, one repeated request ID | **PASS on 21 Nov**. Exact note `b8122a0f-5b1b-4163-ada0-eb9d308e1d29`, author `Patchboard 489ce22c`, no duplicate | [Read](https://chatgpt.com/c/6b00b6c1-6780-83eb-9e88-fef92b6bc816) · [Create](https://chatgpt.com/c/6b00b72e-8410-83eb-81de-9b1788569689) · [Retry](https://chatgpt.com/c/6b00b874-37e8-83eb-9d60-af8c9d30ef1a) · local `demo/cross-browser-qa-20261121/CHATGPT_PLUGIN_ACCEPTANCE.md` |
| Helium normal and Incognito: same MCP-created note | **PASS after bringing background tabs to foreground, without refresh**; both saw four notes, then retained them on reload | `demo/cross-browser-qa-20261121/chatgpt-mcp-reconnect.json` |
| Two separate *real ChatGPT accounts* authorizing one board and creating attributed notes | **NOT YET TESTED** | Gate H1 below |
| Independently off-tailnet device (cellular; Wi-Fi and Tailscale disabled) | **NOT YET TESTED** | Gate H2 below |
| Firefox private passkey enrollment + live shared board | **NOT YET VERIFIED END TO END** (do not substitute guest Firefox QA) | Gate H3 below |

“PASS” above means only the stated boundary was exercised. The MacBook's public hostname is not by itself proof that an external phone can reach it.

## 2. Safe host and service map (do not restart unless specifically rehearsing)

| Service | Loopback listener / data | Public path / handling |
| --- | --- | --- |
| **Guest, deliberately no authentication** | `127.0.0.1:8791` · disposable `demo/patchboard-nov21` Jazz data | `/patchboard/`, `/patchboard-mcp`. Only sample data; no author-to-user OAuth binding |
| **Existing separate private browser instance** | `127.0.0.1:8792` · dedicated private store | Preserved; NOT to be pointed at the staging SQLite DB |
| **OAuth private public staging** | `127.0.0.1:8794` · `demo/patchboard-private-oauth-public-staging` | `/patchboard-private/`, `/patchboard-private-mcp`, `/patchboard-auth/`, and the exact path-based OAuth discovery alias |
| **Unrelated existing apps** | Other MacBook services | Keep the pre-existing root and `/orbit-mcp` Funnel mappings intact |

HTTPS hostname: `https://tests-macbook-air.tail70b8a.ts.net`. Private MCP: `https://tests-macbook-air.tail70b8a.ts.net/patchboard-private-mcp`. OAuth issuer: `https://tests-macbook-air.tail70b8a.ts.net/patchboard-auth`. Metadata: `https://tests-macbook-air.tail70b8a.ts.net/.well-known/oauth-authorization-server/patchboard-auth`. Current demonstration board: `01a1faa4-7c43-7272-a2e0-b68d4b82802a` (“Private browser QA d63a1ab4”). Use **disposable** notes and invitations only.

Safe read-only checks on the MacBook:

```sh
lsof -nP -iTCP:8791 -iTCP:8792 -iTCP:8794 -sTCP:LISTEN
curl -fsS http://127.0.0.1:8794/health
curl -s -o /dev/null -w '%{http_code}\n' https://tests-macbook-air.tail70b8a.ts.net/patchboard-private-mcp   # 401 expected before OAuth
curl -I https://tests-macbook-air.tail70b8a.ts.net/.well-known/oauth-authorization-server/patchboard-auth # 200 expected
tailscale funnel status
```

Do **not** `tailscale funnel reset`, replace the root, use an existing private data directory as a disposable test store, or start two Node processes on the same SQLite store. Build and `pnpm verify` in an **isolated checkout** rather than replacing the `apps/web/dist` used by a currently running demo. The private staging upgrade of 21 Nov saved a backup at `demo/patchboard-private-oauth-public-staging-before-note-fix-20261121`; check its existence/permissions before any later restart. A controlled staging restart is **not** a MacBook reboot or a disaster-recovery test.

## 3. Priority human acceptance gates — do these first

### H1 · Two distinct real ChatGPT accounts (BLOCKER for full demo sign-off)

- [ ] Owner and a different invited editor, **each using their own ChatGPT login**, can open custom remote MCP plugins with write actions. No shared cookies, bearer tokens or passkeys.
- [ ] Editor accepts **single-use** invitation to the owner’s **same disposable test board**, using their own Patchboard passkey. Record roles without copying invite URLs.
- [ ] Each ChatGPT account connects **Patchboard Private OAuth** using the protected private MCP URL. In Advanced OAuth select **Dynamic Client Registration**, **disable OIDC** (otherwise ChatGPT may request unsupported `openid` / `email`), default scopes `board:read` and `board:write`, base scope `offline_access`. Complete passkey sign-in, consent and **one-board** selection. Verify two *separate* connected accounts. Do not use the SDK's localhost OAuth callback as proof.
- [ ] Owner asks ChatGPT to call `create_note` with a fresh `request_id` and a visible marker such as `HUMAN-OWNER-20261121-<nonce>`; save actual `note_id`, `board_id`, `author_id` and `author_name`.
- [ ] Editor independently asks ChatGPT to create `HUMAN-EDITOR-20261121-<nonce>` with a **different** `request_id`; save its actual tool output.
- [ ] Two browser views already subscribed to the board show **both notes with no manual refresh** and display two distinct server-attributed author IDs/names. Verify a fresh foreground session and separately record any background-tab catch-up delay.
- [ ] Retry one request with the **same** request ID and text; ensure it returns the same note ID and does not create another note. Try changing the text with the same ID; expect conflict, not an overwritten note.
- [ ] During a planned break, back up the *exact staging stores*, stop **only 8794**, restart with the same root and build, and verify both IDs/authors/coordinates plus real ChatGPT access after reconnect. Do not accidentally stop 8791/8792. Record evidence and rollback instructions.

**Pass condition:** two real ChatGPT tool calls from distinct accounts on the same board, distinct immutable author IDs, live browser observation, exact-ID restart recovery. One real ChatGPT owner account has passed already; it cannot fill the editor row.

### H2 · Genuinely independent off-tailnet phone (BLOCKER for public accessibility claim)

- [ ] Disable **Wi-Fi and Tailscale** on the phone; use **cellular data**, not another MacBook profile or tailnet-connected device.
- [ ] Open `https://tests-macbook-air.tail70b8a.ts.net/patchboard-private/` and verify assets, passkey login/invite acceptance as editor or viewer, and correct selected board.
- [ ] With the phone already open, create a fresh note from the MacBook browser or authorized MCP. Observe the note **without refresh**; record browser, connection type, note ID, latency/refresh behavior and redacted screenshot.
- [ ] Confirm service exposure and transport behavior; if diagnosing, capture Jazz WebSocket handshake (101), not just an HTTP 200 page load.

**Pass condition:** actual external network, separate identity and real no-refresh delivery. Do not infer this from successful public-hostname SDK tests executed on the MacBook.

### H3 · Firefox private-auth and role UX (BLOCKER for a cross-browser compatibility claim)

- [ ] In a clean Firefox profile, enroll or sign in with a supported passkey and open the exact private staging board. If WebAuthn is blocked, save the error/browser version and report as **FAIL/UNSUPPORTED**, not PASS.
- [ ] As editor, create, edit and arrow-move the owner's note; owner/Incognito/Firefox should see updates and original author labels, including after reload.
- [ ] As viewer, attempt each server-backed create/edit/move; expect server 403 and no board change. Note that edit/move controls may still be shown to viewers — UX debt, **not** permission escalation.
- [ ] Test foreground/background and reconnect after sleep/wake; “Jazz shared · connected” alone is insufficient proof of a current canvas.

**Pass condition:** real Firefox private passkey + authorized collaboration; record any gaps separately from Helium.

## 4. Additional safety gates before *real private user data* (not proven by the demo)

- [ ] Explicitly test revoke/disconnect of the ChatGPT OAuth grant, refresh-token reuse/expiry, membership revocation (including old request-ID replay), expired token, wrong audience, wrong board and viewer write denial **over public HTTPS**.
- [ ] Review DCR registration restrictions, rate limits, trusted proxy origin/IP handling, abandoned clients, error/log redaction and device/session theft controls. Existing 15-minute JWT expiry is **not** instant revocation.
- [ ] Restore a **copy** of both Better Auth and Jazz SQLite stores and confirm secrets, backup rotation, retention, permissions and real rollback. Do not test restore by replacing the live databases.
- [ ] Check passkey recovery and loss of authenticator, invitation expiry/single-use, multi-board isolation and cross-account access.
- [ ] Obtain explicit security/privacy review before onboarding actual user data. The public guest route **remains unauthenticated** and must contain only disposable data.

These gates are **production hardening**, not retroactive claims that the 21 Nov disposable single-account ChatGPT test failed.

## 5. Evidence log for the human operator

| Evidence field | Actual value / link |
| --- | --- |
| Main revision and GitHub `check`, `private-oauth` runs | `6f36a35`; both passed as of review |
| Live single-account OAuth read | [conversation](https://chatgpt.com/c/6b00b6c1-6780-83eb-9e88-fef92b6bc816) |
| Live single-account OAuth create | [conversation](https://chatgpt.com/c/6b00b72e-8410-83eb-81de-9b1788569689) · `b8122a0f-5b1b-4163-ada0-eb9d308e1d29` |
| Idempotent retry + independent backend verification | [conversation](https://chatgpt.com/c/6b00b874-37e8-83eb-9d60-af8c9d30ef1a) · four total, exactly one matching note |
| Distinct second ChatGPT account / author ID | **PENDING — manually record** |
| Cellular phone outside tailnet / exact note ID | **PENDING — manually record** |
| Firefox private WebAuthn/authenticated board | **PENDING — manually record** |
| Both independent author IDs after controlled 8794 restart | **PENDING — manually record** |
| Final decision and approver | **PENDING: FULL GO / SINGLE-ACCOUNT DEMO ONLY / NO GO** |

Never store invite tokens, OAuth codes, client secrets, refresh tokens, cookies, passkey responses or unredacted consent URLs in this log.

## 6. Developer verification and navigation

```sh
# Run from a new, isolated worktree on latest main, not the running demo checkout.
pnpm install --frozen-lockfile
pnpm verify             # broad shared Jazz, Foldkit, TypeScript, Playwright, MCP and durable demo
pnpm test:private:ci    # distinct GitHub private-oauth job: passkey, consent, scoped MCP, restart

# CodeGraph is available on the MacBook, and is local-only:
codegraph init -y .     # or: codegraph sync .
codegraph status .
codegraph explore -p . 'private OAuth board-scoped consent and MCP'
codegraph explore -p . 'server-checked private note mutations Jazz'
```

`pnpm test:public-proof` and public `test:private:oauth` additionally depend on a running staging service/Funnel and are **not** interchangeable with offline `pnpm verify`. The private OAuth acceptance command has an opt-in **staging restart** mode; never set that flag during the demo.

Source trail: `apps/server/src/private-demo.ts` (server wiring) → `private-auth/http.ts` and `private-auth/grants.ts` (OAuth/consent) → `private-mcp.ts` (`list_boards`, `read_board`, `create_note`) → `board-service.ts` (membership, Jazz transactions and actor-scoped receipts) → `packages/jazz-schema/private-permissions.ts` (read-only private Jazz browser policy) → `apps/web/src/main.ts` (Foldkit/Effect private UI commands). The MCP **does not expose edit/move tools**: those are browser API actions only.

**Scope warning:** `/Users/test/work/patchwork/patchwork-board-mcp-starter` from 19 Nov is a separate Automerge/tldraw **stdio** MCP experiment, not this repo's authenticated remote MCP. Do not deploy its configuration to this Funnel endpoint.

## 7. Decision

- **Single-account technical demonstration: CONDITIONAL GO** — connected ChatGPT read, create, idempotency, attributed backend persistence and foreground browser sync passed.
- **Two-human private-collaboration acceptance: NOT YET GO** — H1 and H2 are not completed; H3 is also necessary to claim Firefox compatibility.
- **Production/private real-user-data launch: NO GO** until section 4 is reviewed with supporting evidence.
