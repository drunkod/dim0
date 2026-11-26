# ACC-051 — QA-only typed record review increment

Parent: PR #17 (3f8ccdd7); source delta 1d115f2e. Additive schema migration afadd0f49eda to 7ddacb95394d. The frozen parent fixture preserves existing board, member, canvas entity and canvas receipt/event rows through migration and reopening. All five new typed tables deny direct guest/private Jazz client access.

## Command and adapter boundary

The same server-only patchTypedRecord command handles authenticated browser HTTP and signed MCP. It checks current direct native membership and board/dataset/record ancestry and service guard before replay; new writes also check schema and record versions, stable field ownership and writable type. Title is the only writable text cell; Title length is computed server-side. The row, receipt and event commit together, then the command waits for Jazz authority. Request fingerprints and IDs use a separate typed namespace. A retry cannot resurrect a downgraded Editor.

All three QA/dev flags, HTTP loopback and a real direct disposable temp-root child are required for the typed routes and tool. No production consent upgrade. The ordinary six write tools are unchanged; the seventh QA write uses the existing reservation and confirmed-outcome wrapper. Known typed conflicts/guards settle with exact diagnostics, while uncertain replies retain the lease. Typed operation identity is correlated in SQL, but the canvas-only recovery verifier rejects typed leases. No production recovery orchestration is added.

## Reproduce

From integrations/patchboard after frozen install:
- (cd apps/server && node --import tsx --test test/typed-record-migration.test.mjs test/typed-record-patch.test.mjs test/typed-record-qa-gate.test.mjs test/grant-write-drain-workers.test.mjs)
- pnpm test:private:ci
- PATCHBOARD_QA_TYPED_RECORD=1 DIM0_QA_LIVE_SETTINGS=1 pnpm test:private:ci
- pnpm verify

The browser/MCP fixture seeds records while the disposable server is stopped; one Jazz writer at a time. Off: cached tool call is denied and typed HTTP returns 404 with no mutation. On: a real HTTP response is dropped after successful commit, MCP replays exact receipt and event, and a separate record races two transports. The independent Owner reads after restart. The actual surface is the authenticated HTTP route, not a visual grid editor. A test-only SQL trace checks reservations and settlement. The service-level drain test proves the pending intent survives an unresolved typed outcome and cannot be cleared by canvas recovery.

## Limits

No saved views, generic record types, workspace-inherited permissions, production typed entitlement or visual grid editing. No typed crash-recovery verifier, deployment, or production data mutation. Physical passkeys and installed ChatGPT acceptance remain separate.
