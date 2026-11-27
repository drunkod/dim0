# M2 checkpoint · Local `create_note` over the Jazz MCP transport

**20 November 2026 · First implementation handoff**

Based on MacBook worktree `/Users/test/work/patchwork/agent-staff-board-m2-mcp`, starting at `a172b3f`. Follow the architect's [M2 architectural specification](https://github.com/drunkod/agent-staff-board/blob/208de80/docs/M2_ARCHITECTURAL_SPEC.md) and [programmer letter](https://github.com/drunkod/agent-staff-board/blob/208de80/docs/PROGRAMMER_LETTER.md).

## Delivered (local SDK only)

- The existing Node/Jazz listener handles `/patchboard-mcp` **only when `demoBoardId` is explicitly supplied** to its server factory. The normal M1 listener and live SQLite store are unchanged.
- The SDK now discovers exactly two tools: `read_board({})` and `create_note({ text, request_id })`.
- Text is trimmed and must contain 1–2,000 characters; request ID is trimmed and must contain 1–128. Unknown keys are rejected, including `board_id` and `user_id`. The server resolver supplies the **only** board ID.
- A named Effect operation in `apps/server/src/board-service.ts` stages the note and its `mcpRequests` receipt **in one Jazz serializable transaction**. The transaction wait returns only after authoritative acceptance. A deterministic receipt UUID is derived from the board and request ID; its payload hash and note ID are stored in Jazz. Receipts cannot be read or written by ordinary Jazz browser sessions.
- An identical request key and text return the same `note_id` (including after restart, in concurrent calls, and when the user later edits the note). A reused key with different text returns `REQUEST_ID_CONFLICT`. Only Jazz serialization conflicts trigger bounded server-side retry. Other ambiguous failures return a bounded `WRITE_FAILED` response; do **not** automatically retry unknown failures without checking the board.
- Shared note defaults provide the same placement geometry as the browser writes, with a next z-index calculated inside the transaction.

## Acceptance evidence

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm test:mcp
pnpm test:backend-proof
pnpm verify
```

`apps/server/test/mcp-board.test.mjs` tests the official MCP SDK against the actual in-process Node/Jazz listener. It covers tool discovery, next `read_board`, board isolation, invalid/oversized inputs, absent board, override refusal, sequential and concurrent same-key calls, concurrent conflicting payloads, post-edit reuse and post-restart idempotency.

`apps/web/test/backend-write-proof.mjs` retains the original backend proof and adds a real SDK `create_note` **after two independent Chromium contexts have already connected** to the Jazz board. Both receive the note without refresh. The server restarts with the same temporary SQLite path, and the exact ID, board, text and geometry are read back and displayed in both browser contexts.

**Observed local test example** (all fixture rows are disposable):

```text
MCP_LIVE_SYNC_PASS {
  "boardId": "2929b8dc-b9fd-45ed-b8bb-355486a3f0b6",
  "noteId": "b96f8670-bc4e-4af4-a129-eba8da6f979e",
  "browserProfiles": 2
}
MCP_RESTART_EXACT_ID_PASS {
  "boardId": "2929b8dc-b9fd-45ed-b8bb-355486a3f0b6",
  "noteId": "b96f8670-bc4e-4af4-a129-eba8da6f979e",
  "browserProfiles": 2
}
```

A separate migration check opened a disposable M1-era SQLite dataset with the original code, inserted a real board and note, then opened the **same** data directory with the M2 generated schema. Both note ID and content remained intact; the new receipt table was empty and usable.

## Scope at commit 6d166cc

This checkpoint does **not** add `pnpm demo:start`, built-asset hosting under `/patchboard/`, public Jazz HTTP/WebSocket routing, Tailscale Funnel paths, the ChatGPT.com connector, identities, OAuth, roles or approval workflows. They are separate follow-up stages in ADR 001 and the architect's specification. Local MCP uses a disposable configured board and no public credentials.

Subsequent demo startup work and outstanding gates are tracked in [the active runbook](M2_DEMO_START.md).
