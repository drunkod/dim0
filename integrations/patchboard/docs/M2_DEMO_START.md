# M2 demo stack · historical local checkpoint

> **21 Nov 2026 maintenance notice:** This file preserves the original guest-demo M2 commands and evidence; its “Current assignment” below is **historical and already implemented**. For the live private OAuth/ChatGPT integration and unresolved human sign-off, use [the human runbook](HUMAN_ACCEPTANCE_RUNBOOK.md) and [commit architecture review](ARCHITECTURE_COMMIT_REVIEW_2026-11-19_21.md). The public **guest** MCP is intentionally unauthenticated; the new **private** MCP is separate.

**Release update (20 November 2026):** The MacBook demo, the public `/patchboard` and `/patchboard-mcp` Funnel routes, official SDK write and two-profile Jazz WebSocket synchronization now work. See [the tested public release runbook](M2_PUBLIC_FUNNEL_RELEASE.md) for current endpoints, evidence and restart instructions. A genuine ChatGPT.com plugin call and off-tailnet device validation are not yet verified.

Commit d4fa60a originally added only the local demo stack; it did not configure Tailscale Funnel or ChatGPT.com.

## Start

From the repository root:

```sh
pnpm install --frozen-lockfile
PATCHBOARD_DEMO_ROOT=/absolute/path/to/disposable-demo pnpm demo:start
```

The command builds the Foldkit bundle with base `/patchboard/`, starts one Node process, opens the Jazz SQLite store, seeds or reuses one board named `Patchboard demo`, serves the UI under `/patchboard/`, and serves MCP at `/patchboard-mcp`.

The command prints a board URL like:

```
http://127.0.0.1:8791/patchboard/?board=<board-id>
```

Use a stable absolute demo directory. Stop with Ctrl-C. Verify board-ID stability after restarting with the same directory before relying on this setup. The normal M1 services on ports 4173 and 3001 are not used.

## Local acceptance

These checks passed on the MacBook:

```sh
pnpm check
PATCHBOARD_DEMO_ROOT=/tmp/patchboard-demo-next4 PATCHBOARD_DEMO_PORT=8894 pnpm demo:start
curl http://127.0.0.1:8894/patchboard/
curl http://127.0.0.1:8894/health
```

The MCP endpoint completed an official protocol `initialize` request at `http://127.0.0.1:8894/patchboard-mcp` and returned the Patchboard server capabilities.

The integrated acceptance proof is included in `pnpm verify` through `pnpm test:demo-proof`. It starts the real `pnpm demo:start` command with a disposable directory, opens two independent Chromium profiles, discovers and calls both MCP tools, verifies live note delivery, restarts against the same directory, and verifies the same board ID, note ID and request retry.

## Current assignment

1. Start from the published `feat/m2-local-mcp` worktree at `/Users/test/work/patchwork/agent-staff-board-m2-mcp`. Keep the working MCP tools and the existing retry and browser tests.
2. Exercise the real `pnpm demo:start` entry point with a disposable absolute data directory. Make the client URL, Jazz base path and advertised URL agree on `/patchboard/jazz`. Dispatch Jazz before static assets. Capture a successful WebSocket upgrade on the prefixed path.
3. Seed once and persist the demo board ID across renames and restarts. Fail explicitly for an unknown configured ID. Report ready only after the board resolves and the bundle is available.
4. Open two independent browsers before calling the official SDK. List the tools, read the board and create a uniquely marked note. Assert both pages update without refresh. Restart the same process against the same directory, compare note ID, board ID, text and coordinates, and retry the request ID to verify a single note. Include this acceptance test in `pnpm verify`.
5. After the local proof, publish the two scoped Funnel mappings and verify UI assets, WSS and SDK calls from outside the tailnet. Preserve the existing root, /orbit-mcp and other listeners. Then exercise the no-auth connector in a real ChatGPT conversation and record the returned ID, both live updates and restart evidence.
