# Dim0 presentation — cross-browser and ChatGPT website QA

**Tested:** 21 November 2026, on the authorized MacBook, on feature branch
`feat/jazz-mcp-tailscale-migration` at baseline `510ee5f9`.

This report separates **observed live evidence** from pending acceptance. It
does not claim a friend's ChatGPT login was tested.

## Test matrix

| Environment / flow | Result and evidence |
|---|---|
| Standard Helium owner | PASS. Authenticated owner opened a fresh QA board and minted a reusable Jazz Editor link from the native Dim0 Share dialog. |
| **Separate Helium incognito process** | PASS. Launched Helium executable separately with `--incognito` and its own transient user-data directory. Fresh virtual passkey user signed in, had a *different account ID*, joined editor board, created a Canvas note; owner read the exact entity in Jazz. No browser page exceptions. |
| Firefox 157.0.1 **isolated fresh test profile** | PARTIAL. Invitation renders and the browser reaches native Dim0 registration. GeckoDriver's virtual WebAuthn authenticator was created, but passkey registration failed: `Discoverable credentials were required but no available authenticator supported it`. Firefox's *real* OS-backed passkey sign-in was **not** tested; do not conflate virtual-authenticator support with product compatibility. The user's normal Firefox profile/passwords were untouched. |
| ChatGPT **website** — MCP read | PASS. A new request sent from `chatgpt.com` used the connected **Dim0 Jazz Sprint Demo** plugin; its `list_boards` and `get_canvas_entity` returned the authorized board and the expected QA note at server version **2**. |
| ChatGPT **website** — MCP write | PASS. A separate browser prompt requested a versioned update to QA note `cb550e38-18af-4a94-bb16-5f58ba17e955`. The authenticated owner browser independently observed the **version 2 → 3** update and title `Presentation ready · ChatGPT website QA`. The website prompt needed explicit **Send** click; Enter alone had left it as a draft. |
| **Friend's own ChatGPT account** | NOT TESTED. A real second person must join with their own Dim0 identity, connect their own plugin and approve OAuth. A second virtual passkey user *in Dim0* is not an independently authenticated ChatGPT account. |
| Public endpoint | PASS on checks. `/jazz-signin` and `/boards/... ` returned HTTP 200; unauthorized `/patchboard-private-mcp` returned 401. |
| Server errors | No new application exceptions in checked server logs. A Jazz `slow query` warning was observed (<200 ms on a tiny table), not a request failure. |

## Repeatable incognito browser proof

```sh
cd /Users/test/work/patchwork/dim0-jazz-port/integrations/patchboard
pnpm --filter @patchboard/web exec node test/dim0-helium-incognito-cross-process.mjs
```

This proof requires an authenticated owner board tab already open in the
standard Helium CDP instance, bound to localhost port 9222. It creates a
**new disposable QA Jazz board**, not another presentation card. It generates a
new Editor invitation and never logs the secret. Customize
`DIM0_MCP_ORIGIN`, `DIM0_OWNER_BOARD_ID`, and `DIM0_CDP_URL`; the CDP
endpoint is restricted to loopback. The independent Helium process is closed
after testing. The owner's original browser page is not closed.

## Evening demo readiness

- Use standard Helium or another browser with a *real, working* platform passkey
  authenticator for guests. Do not depend on Firefox headless virtual
  authenticator emulation for passkey registration. Firefox hardware-backed
  passkey functionality needs a manual check on a friend's device.
- Keep MacBook awake, current Cloudflare tunnel running, and owner board open.
  Existing `caffeinate -i -t 21600` was observed running.
- Create a **fresh** Editor invite from the **presentation board** Share dialog.
  Send the full `/jazz-invite/<id>#invite=<secret>` privately; a plain
  `/boards/<id>` URL will not enroll new friends.
- Have the friend connect
  `https://barbie-discovery-bingo-system.trycloudflare.com/patchboard-private-mcp`
  from their own chatgpt.com account, authorize their own Dim0 identity,
  then create and rename a card while the owner watches. Mark this final
  independent OAuth acceptance only after it actually happens.
- Keep the temporary Cloudflare hostname unchanged for tonight. Permanent
  Tailscale migration remains a separate gate and must preserve issuer,
  passkey origin and MCP OAuth redirect semantics.

No live server restarts or data-store migrations were performed in this
cross-browser QA pass. Production application code remained unchanged;
the reliable isolated Helium proof was added as a regression harness.
