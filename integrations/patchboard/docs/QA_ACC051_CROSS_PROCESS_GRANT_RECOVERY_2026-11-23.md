# ACC-051 — stranded canvas write recovery (review slice)

Parent: PR #16 at a41c9422. Source delta: ecbfc8c4. This draft preserves #16's confirmed-outcome settlement, pending-disconnect identity and native Settings retry. It adds server-only recovery of one versioned canvas patch; no production recovery endpoint, scheduler or automatic lease expiry.

## Invariant

The grant ledger records the tool, verified subject/board and (for patch_canvas_entity only) the same server-derived identity used by the Jazz mutation: canonical entity, actor, board, request, expected version, fingerprint, deterministic receipt/event IDs. Old lease rows migrate to unattributed/null and stay pending. All six write tools still reserve before submission. Only the patch has the correlated evidence required for recovery; the other five remain unresolved if their normal settlement is lost.

The helper requires a trusted termination/fencing assertion, which is NOT supplied by the client, derived from a timer or proved by the helper. Missing/invalid identity (including JSON null), unsupported tool, or absent verified lease fields returns UNKNOWN_OPERATION. With no termination assertion it returns WORKER_MAY_STILL_COMMIT. Missing receipt returns NO_RECEIPT. A mismatch with the retained grant, optional retained admission, receipt, or event returns RECEIPT_MISMATCH. None clears a lease. Matching exact durable records permits PROVED_COMMITTED; repeated recovery returns ALREADY_SETTLED. No cross-database atomic transaction is implied.

## Reproducible evidence

Run from integrations/patchboard after frozen install:

- (cd apps/server && node --import tsx --test test/grant-write-drain-workers.test.mjs test/grant-write-drain-ordering.test.mjs test/canvas-versioned-patch.test.mjs)
- pnpm --filter @patchboard/web exec node test/native-write-drain-proof.mjs
- pnpm test:private:ci
- pnpm verify

The distinct-process test uses disposable SQLite WAL and Jazz stores; one Jazz writer at a time. Child processes signal reservation/commit via fixture markers. The commit case now has the SAME lease-holding child submit the patch, wait for authority, and signal while the lease is still held. The parent observes SIGKILL exit before starting recovery. In the before-commit case there is no receipt/event and both disconnect attempts stay pending (503); in the after-commit case the original intent completes (503 then 200) after exact recovery. Independent Owner readback uses the membership-checked domain read. The cross-process status values exercise the same disconnect service, not a separate native browser crash test. The existing native proof exercises real Settings/MCP without killing a writer. Corruption controls use only disposable fixture SQL and Jazz data.

## Open production architecture decision

The boolean proof is an internal prerequisite, not an authentication or fencing mechanism. An eventual trusted process supervisor needs to persist a unique worker-instance/epoch association with each lease, verify termination or enforce a durable submission fence for that exact instance (not a reused PID or expired TTL), serialize recovery against any potential writer, and invoke this helper only after that proof is established. Choose the single-Jazz-authority restart/control-plane owner and document its failure model before wiring production recovery. No endpoint, automatic cleanup or operational claim in this draft. Separate evidence is required for other mutation types, multi-host Jazz ownership, production upgrade, physical passkeys and installed ChatGPT acceptance.
