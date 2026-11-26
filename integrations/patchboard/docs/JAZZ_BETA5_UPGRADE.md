# Jazz 2.0.0-beta.5 upgrade and rollback

## Scope and compatibility

Upgrade the Patchboard catalog/lock together from alpha.69; all Jazz tools, Wasm,
NAPI and optional platform binaries must resolve to beta.5. Keep pnpm 12.11.2.
Use Node 24 for the Jazz server, schema CLI and verification (Jazz now requires
at least 22.18). Native Dim0 webui is a separate npm project and does not import
the Jazz library directly. The optional Better Auth peer range was already
~1.7.22 on alpha.69; the app uses a custom Better Auth 1.7.1 session adapter.
Do not change the auth stack or suppress peer warnings solely for this upgrade.

The app already uses the modern Jazz backend/client/Effect and schema DSL APIs.
Do not rewrite historical migration fixtures, local-first tier names, Better
Auth session calls, or schema history to make generation pass. All generated
artifacts and migration snapshots must remain unchanged for this dependency
upgrade. The root-level Patchboard Jazz workflow executes Linux frozen install,
full verification and both disposable QA configurations.

## Reproducible disposable upgrade proof

Keep a clean alpha.69 worktree at the accepted pre-upgrade commit with
`integrations/patchboard` installed via `pnpm install --frozen-lockfile`.
From the upgraded worktree's integrations/patchboard directory, run:

```sh
pnpm install --frozen-lockfile
node scripts/prove-jazz-upgrade.mjs /absolute/path/to/alpha69/integrations/patchboard
pnpm verify
PATCHBOARD_QA_TYPED_RECORD=0 pnpm test:private:ci
PATCHBOARD_QA_TYPED_RECORD=1 DIM0_QA_LIVE_SETTINGS=1 pnpm test:private:ci
```

The proof creates its own temporary root (never accepts a production store),
seeds a real alpha.69 store, saves a closed-store copy including the application
auth ledger, verifies identities, membership, a typed record and its receipt,
computed field, active/revoked view shares with beta.5, writes once with replay,
reopens, and restores the pre-upgrade copy with alpha.69. The fixture is local,
has no external sync peers, and is deleted on completion. This is a binary/store
compatibility rehearsal, not full production backup or deployment acceptance.
Existing integration/private suites cover historical schema migrations, account
and authorization policies, canvas writes and stranded worker recovery.

## Deployment rehearsal (not executed by the upgrade PR)

- Inventory the live runtime, Node version, exact server/frontend release and
  deployment process without printing secrets. In source, private data is
  `<PATCHBOARD_PRIVATE_ROOT>/jazz`; Better Auth and app admission/share ledgers
  live in `<PATCHBOARD_PRIVATE_ROOT>/auth/better-auth.sqlite` (and its WAL/SHM);
  the auth secret lives beside it. The guest demo is separate; never mix roots.
  Confirm actual configured paths, permissions, any blob/chunk storage, and
  external integrations before rollout.
- Coordinate the maintenance window with the owner. Drain writes, allow pending
  offline writes to sync where possible, stop the Jazz/auth server gracefully,
  then take an encrypted consistent snapshot of the entire Jazz data directory,
  auth directory and any associated application/external chunk data. Preserve
  store identity and secret metadata securely; record version, checksums and
  restore instructions, not secrets, in the backup manifest. Never copy only
  the main SQLite file from a running writer.
- Rehearse against a separately provisioned staging root. Follow upstream
  [backup/restore instructions](https://jazz.tools/docs/operating/backups-and-upgrades)
  to detach a copied store if the original remains live; use separate chunks,
  origin and auth configuration, no production peers or Funnel route. Verify
  existing users/boards, applet persistence, sync/reconnect, old canvas and typed
  receipts, grant revocation/write drain, saved views, and shared-device offline
  sign-out/reload. Record first-open/first-write timing; beta.5 may scan old
  history once before its startup optimization is effective.
- Coordinate the browser/server version switch only after verification and an
  approved production plan. Keep a recoverable copy of the old release and
  pre-upgrade snapshot. If rollback is needed, stop writes, preserve a protected
  copy of the failed/new state, restore the consistent pre-upgrade snapshot and
  old release together, and reconcile any post-cutover/offline writes explicitly.
  Do not assume a binary downgrade alone is a safe rollback.

References: [alpha.70](https://github.com/garden-co/jazz/releases/tag/v2.0.0-alpha.70),
[beta.0](https://github.com/garden-co/jazz/releases/tag/v2.0.0-beta.0),
[beta.2](https://github.com/garden-co/jazz/releases/tag/v2.0.0-beta.2),
[beta.4](https://github.com/garden-co/jazz/releases/tag/v2.0.0-beta.4),
[beta.5](https://github.com/garden-co/jazz/releases/tag/v2.0.0-beta.5).
