# Patchboard M2 — Public Funnel release rehearsal and November 21 handoff

> **Postscript, 21 Nov 2026:** The report below is the **guest, unauthenticated M2 demo track on 8791**. Its statement that the *guest* connector was not tested in actual ChatGPT remains a limitation of that track. Separately, a **real ChatGPT account successfully connected to the board-scoped private OAuth MCP on 8794**, read the private board, created an attributed note, and retried without duplication. This **does not** establish two distinct real ChatGPT users or off-tailnet cellular access. For current acceptance, see [HUMAN_ACCEPTANCE_RUNBOOK.md](HUMAN_ACCEPTANCE_RUNBOOK.md); for architecture, [ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md).

**Status as of 20 November 2026:** public MacBook-hosted UI, Jazz WSS and official MCP SDK note creation **verified via the public HTTPS domain**; no external app hosting. The **actual ChatGPT.com plugin call and a browser on a separate off-tailnet device remain unverified**. Do not claim those two steps passed.

## Current running demo

- MacBook source: `/Users/test/work/patchwork/agent-staff-board-m2-mcp` (branch `feat/m2-local-mcp`; the release is based on commit `3b4b704` plus subsequent documentation/test changes).
- Demo data: `/Users/test/work/patchwork/demo/patchboard-nov21` — a **dedicated disposable** Jazz SQLite directory, completely separate from the older M1 store.
- Board ID: `01a1f950-a8a0-71d1-8805-fac7a666a9ad`
- **Public UI:** https://tests-macbook-air.tail70b8a.ts.net/patchboard/?board=01a1f950-a8a0-71d1-8805-fac7a666a9ad
- **Public MCP:** `https://tests-macbook-air.tail70b8a.ts.net/patchboard-mcp`
- **Public Jazz WebSocket:** `wss://tests-macbook-air.tail70b8a.ts.net/patchboard/jazz/apps/<app-id>/ws` (an actual HTTP 101 upgrade was captured).
- **Local health:** `http://127.0.0.1:8791/health`; the public hostname's `/health` belongs to the unrelated root service, **not Patchboard**.
- MCP tools: `read_board({})`, `create_note({text, request_id})`. The `request_id` must be unique per logical note; replaying with the same text returns the same note ID.
- Server command: one Node/Jazz process, local port `8791`, `pnpm demo:start`. It serves built Foldkit, Jazz, and MCP and owns its SQLite store.

## Funnel configuration — existing services preserved

```text
HTTPS 443 root /        → localhost:3000                  (other app; unchanged)
HTTPS 443 /orbit-mcp    → localhost:8787/mcp              (CAFE MCP; unchanged)
HTTPS 443 /patchboard   → localhost:8791/patchboard       (Patchboard UI + Jazz)
HTTPS 443 /patchboard-mcp → localhost:8791/patchboard-mcp (Patchboard MCP)
HTTPS 10000 root /      → localhost:8787                  (other app; unchanged)
HTTPS 8443 root /       → localhost:8648, tailnet-only    (other app; unchanged)
```

**Never run `tailscale funnel reset`, remove existing paths, or replace the 443 root.** In particular, don't map `/patchboard/jazz` separately: the existing `/patchboard` prefix already forwards the Jazz WebSocket upgrade correctly.

## How to run and restart tomorrow

Keep the MacBook powered, awake, online, and the lid open during presentation. Tailscale must remain connected.

In the MacBook terminal, if `8791` is not listening:

```sh
cd /Users/test/work/patchwork/agent-staff-board-m2-mcp
export PATCHBOARD_DEMO_ROOT=/Users/test/work/patchwork/demo/patchboard-nov21
export PATCHBOARD_DEMO_PORT=8791
export PATCHBOARD_PUBLIC_ORIGIN=https://tests-macbook-air.tail70b8a.ts.net
pnpm demo:start
```

The command rebuilds the frontend for `/patchboard/` before serving. **Do not launch a second server using the same SQLite directory.** The current demo serves files directly from `apps/web/dist`, so running a separate default `pnpm build`, `pnpm test:e2e`, or `pnpm verify` during a live presentation can temporarily replace the public-base build. Run those checks before the rehearsal and then restart the demo with `pnpm demo:start`; do not rebuild the web app while presenting. If the process is already running, keep it running; to restart deliberately, identify **only** the PID listening on port 8791 with `lsof -nP -iTCP:8791 -sTCP:LISTEN`, send it `SIGTERM`, wait until the port is free, then run the command above. Never terminate the existing M1 listeners on 3001/4173.

Verify:

```sh
curl -fsS http://127.0.0.1:8791/health
curl -fsS https://tests-macbook-air.tail70b8a.ts.net/patchboard/ | grep 'assets/index-'
tailscale funnel status
```

A plain browser GET to `/patchboard-mcp` can legitimately return **406 Not Acceptable**. That is **not** proof of MCP failure. Use the official SDK and `tools/list` / `tools/call`, not GET, to verify it.

## Automated public acceptance and saved evidence

This deliberately external-dependent test is **not included in `pnpm verify`** and does not run in ordinary CI. Run it while the demo and Funnel are online:

```sh
cd /Users/test/work/patchwork/agent-staff-board-m2-mcp
PATCHBOARD_DEMO_ROOT=/Users/test/work/patchwork/demo/patchboard-nov21 \
PATCHBOARD_PUBLIC_ORIGIN=https://tests-macbook-air.tail70b8a.ts.net \
pnpm test:public-proof
```

The test starts **two independent Chromium browser profiles** on the public HTTPS board *before* calling MCP, records each Jazz WebSocket handshake and asserts **HTTP 101**, invokes `read_board` and `create_note` via the official MCP SDK **through Funnel**, waits for both pages to receive the same note without refresh, then retries the same request ID to prove no duplicate. Any JavaScript or network failure fails the test.

Evidence is saved under `$PATCHBOARD_DEMO_ROOT/public-evidence/`:

- `public-proof.json` — structured result, URLs, exact note ID, both 101 handshakes, error lists;
- `profile-0.png` and `profile-1.png` — browser screenshots;
- `profile-0-trace.zip` and `profile-1-trace.zip` — Playwright traces;
- `public-proof-run.log` — actual SDK and browser test output.

**First verified run:** `PUBLIC_FUNNEL_ACCEPTANCE_PASS`, note `8cfd29ea-bc54-4f9a-9d41-73bff7316244`, two 101 upgrades, zero JS errors, zero failed network requests.

**Additional manual durability check:** after terminating only the existing 8791 Node process and restarting `pnpm demo:start` against the same directory, the public SDK recovered notes `9135240f-c15f-41d8-9578-0279922bf812` and `6947f860-a741-4e1a-b32b-a06f498b0163` with their original IDs, text and coordinates. Both browser profiles reopened the public page and displayed those exact notes. This was a **controlled server restart, not a MacBook reboot**.

**Full local regression:** `pnpm verify` passed (Foldkit, Jazz integration, MCP SDK, Playwright, single-process restart proof, typechecks, lint) before this test-only release addition.

## Last manual acceptance gates for tomorrow

1. **Off-tailnet browser**: use a phone with Wi-Fi and Tailscale **disabled**, connected via cellular data, to open the public URL. Confirm the same board appears and remains connected while a second browser edits a note. The MacBook-only public-domain test does **not** establish this.
2. **Real ChatGPT.com plugin**: open ChatGPT on web → Plugins → plus → Add custom MCP server. Set name **Patchboard Demo**, endpoint `https://tests-macbook-air.tail70b8a.ts.net/patchboard-mcp`, authentication **none**, acknowledge the warning and create the plugin. Tool scan should show `read_board` and `create_note`. Availability of custom MCP **write** actions depends on ChatGPT account/workspace policies.
3. Enable/select the created plugin for the message and ask: **“Using Patchboard, create a note with the text: Customer presentation rehearsal November 21. Use a unique request_id.”** Keep two browser profiles open on the demo board; record the tool's actual returned note ID and both updates.
4. Restart the exact same demo process using the same root and show that note again. Do not claim a ChatGPT pass unless it really invoked the remote `create_note` tool.

**Fallback:** If ChatGPT workspace permissions block connecting or using write tools, use `pnpm test:public-proof` in the presentation and show the screenshots, traces and exact note ID. This fully demonstrates public MCP tools, two-browser real-time Jazz collaboration and durable local SQLite. Clearly label the missing ChatGPT connector step.

## Not in scope for the November 21 demo

OAuth, multi-user registrations, board/account linking, roles, richer canvas editing, proposal approval, Eidos integration and external application hosting. The public MCP endpoint is **unauthenticated and uses disposable sample data only**. No private or sensitive information should be placed on this demonstration board.
