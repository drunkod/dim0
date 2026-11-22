# @patchboard/account-domain — installed PR 0 contracts and disabled gaps

**Production-scoped, genuinely installed code.** This is the **foundation**, not
Teable account parity or a replacement Better Auth/Jazz identity service.

Canonical source: Teable `bd8cfc054f521f6f9019f62dec2f9fcb1273ecec`,
from the architect's committed documentation
`bcffa096ba5cd877fcb813289ad00c77c326baee`.
Runtime integration base: `9812dfe090ac58a078cfa2f86d42d46a6c63a413`;
Better Auth 1.7.1; jazz-tools 2.0.0-alpha.69.

- `source-capabilities.json` freezes all 93 ACC IDs, source paths, reviewer/PR,
  original classifications and independent MVP statuses.
- `src/pending/ACC-XXX.ts`: **84 real throwing stubs**, each retains typed
  per-ACC command/result alias (provisional exact fields), owner, source pin,
  planned P/N/S/R/C and feature flag. They never receive a DB or HTTP port,
  so cannot accidentally create credentials, grants, membership or success events.
- `src/ids.ts`, `src/registry.ts`, `src/pending/index.ts` generated
  deterministic from the frozen manifest, not from live docs checkout.
- `src/contracts.ts` has email-free passkey subject and Jazz actor primitives,
  three invitation proof modes; only existing bearer link is currently functional.
- `src/role-matrix.ts` contains 67×5 pinned Teable literal action decisions.
  `src/policy.ts` is a **pure compositional reference evaluator**, not yet the
  installed shared account permission oracle. Existing Dim0 server policies still
  govern real board writes and have per-operation legacy admin/agent semantics.
- `src/ports.ts` defines intended server adapters for identity, membership,
  grant admission and outbox. No imaginary Better Auth/Jazz APIs implemented.
- `src/ui-states.ts` is disabled structural UI metadata, not live routes.
  There are **zero** new MCP tools/discovery entries from this package.

Run `pnpm --filter @patchboard/account-domain typecheck`,
`pnpm --filter @patchboard/account-domain test:contracts`,
`pnpm --filter @patchboard/account-domain test:boundary`, and
`pnpm --filter @patchboard/account-domain verify:generated`
from `integrations/patchboard`.

**Tests performed in initial PR 0 slice**: 435 passed, including 335 source
allow/deny cells, 84 fail-closed stubs and 8 unknown evidence gates. This does
not execute the planned 465 original P/N/S/R/C acceptance or 32 native
passkey/link/recovery tests. No source-mismatched ACC row promoted to EXISTS;
ACC-033 remains the narrowly verified legacy browser logout call.

**Gates remaining:** current identity/Jazz adapters; transactional receipts;
policy storage and last-owner CAS; SQL grant admission; real browser/UI/issuer
tests; separate Product/Billing paid-seat decision, Product/Identity session
and credential invalidation, Product/Legal deletion/retention decisions,
and 25 still-unsigned source/wider story relationship recommendations.
