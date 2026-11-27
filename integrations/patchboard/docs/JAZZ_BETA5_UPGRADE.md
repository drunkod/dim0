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

## SashAI web rollout runbook — proposed, not authorized for exposure

**Decision baseline:** main `82c1f9a74a3fe8cc2ae975ab6f44f6eba6d505a9`
(#24 merged). Both post-merge workflows finished SUCCESS: [Tests, 5/5](https://github.com/drunkod/dim0/actions/runs/46008743255) and
[Patchboard Jazz checks, 3/3](https://github.com/drunkod/dim0/actions/runs/46008743257).
Reuse [#24](https://github.com/drunkod/dim0/pull/24)'s actual alpha.69 → beta.5
store compatibility proof. The accepted persistent web staging evidence is
[#33](https://github.com/drunkod/dim0/issues/33) and its combined engineering
and presentation reports. The operational rehearsal below is a same-version
beta.5 restore, not a second version upgrade.

### 1. Operator and release decision

| Parameter | Proposed value / requirement |
| --- | --- |
| Release owner | `drunkod`; approve hostname, cohort, maintenance window, release SHA, rollback and public acceptance |
| Execution operator | MacBook account `test` on Tests-MacBook-Air, or a separately provisioned equivalent Mac; name the responsible human in the release ticket |
| Independent operator | Not yet assigned; a second human must follow this runbook on isolated staging and record results before merge |
| Application | Node 24.22.3, pnpm 12.11.2, Jazz 2.0.0-beta.5, Better Auth 1.7.1; frozen dependencies |
| Public origin | Proposed `https://sashai-web.tail70b8a.ts.net`, a **new dedicated Tailscale node**; not provisioned or verified |
| Ingress | Tailscale Funnel → dedicated loopback reverse proxy/static server 18794 → private Node/Jazz 18792; same origin for native UI, auth, MCP and metadata |
| Supervision | Separate macOS launchd jobs for backend, static proxy and dedicated ingress daemon; not the existing primary jobs |
| Data | `/Users/test/Library/Application Support/SashAI/stores/generation-0001`; private generation directories, never a guest/QA root |
| Backups | Separate approved encrypted volume, mode-0700 directory; complete stopped root and checksummed manifest, never Git |
| Release policy | No public route changes until explicit release authorization and the operational gates below are met |

The proposed hostname preserves the existing Mac's 443/8443/10000 routes.
Actual read-only inventory showed the primary root on 443 already forwards
to port 3000, 10000 to 8787, and 8443 is tailnet-only; existing private auth/MCP
paths on 443 target 8794. Ports 18792 and 18794 were free at inspection; recheck
at cutover. Never reset Funnel, replace that root, or repoint the old private
paths. The new hostname must actually be assigned to the dedicated node before
building or enrolling users. A passkey is bound to its RP/hostname; a copied
database is not a way to move existing passkeys to another RP. This proposal is
a fresh public cohort, not a migration of prior real accounts to a new origin.
If existing accounts must move, stop and decide an approved same-origin or
re-enrollment plan first.

Use a separate release checkout and immutable build. Do not build over a live
asset directory. Ensure power, awake state, network, logged-in launchd domain,
disk capacity, encrypted backup media, access controls and an on-call human.
The Mac had about 3.9 GiB free during rehearsal; provision adequate headroom
before rollout (proposed minimum 10 GiB free **plus** space for the release
build and two complete store generations). Do not remove historical stores
to satisfy this gate. A GUI LaunchAgent does not guarantee service after
logout/reboot; validate login/reboot recovery or choose an approved dedicated
host/system service before offering availability to users.

### 2. Prepare release and storage (only on approved host)

The following commands are operator instructions, not commands executed on
live data by this PR. Use Bash, fail on errors, and replace the explicitly
unset release SHA with the approved merged rollout revision containing the
clean-shutdown fix, not merely the pre-fix base. This example is for the
proposed fresh public cohort. Use the same origin and auth secret on each
restore of this cohort. Do not source arbitrary environment files or inherit
a QA profile.

```bash
set -euo pipefail
umask 077
export PATH=/opt/homebrew/opt/node@24/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
export NODE=/opt/homebrew/opt/node@24/bin/node
export BASE="$HOME/Library/Application Support/SashAI"
export REPO="$HOME/work/patchwork/dim0-issue-18-jazz"
: "${RELEASE_SHA:?Set the approved full rollout merge SHA}"
export RELEASE="$BASE/releases/$RELEASE_SHA"
export STORE="$BASE/stores/generation-0001"
export OPS="$BASE/ops"
export ASSETS="$RELEASE/webui/dist"
export SASHAI_HOST=sashai-web.tail70b8a.ts.net
export ORIGIN="https://$SASHAI_HOST"
export BACKEND_PORT=18792 WEB_PORT=18794
# Provision these only in the dedicated SashAI namespace.
mkdir -p "$BASE" "$BASE/releases" "$BASE/stores" "$OPS" "$BASE/logs" "$BASE/ingress"
chmod 700 "$BASE" "$BASE/releases" "$BASE/stores" "$OPS" "$BASE/logs" "$BASE/ingress"
test ! -e "$RELEASE"
git -C "$REPO" fetch origin main
git -C "$REPO" worktree add --detach "$RELEASE" "$RELEASE_SHA"
test "$(git -C "$RELEASE" rev-parse HEAD)" = "$RELEASE_SHA"
"$NODE" --version
test "$(pnpm --version)" = 12.11.2
(cd "$RELEASE/integrations/patchboard" && pnpm install --frozen-lockfile)
(cd "$RELEASE/webui" && npm ci)
(cd "$RELEASE/integrations/patchboard" &&
  PATCHBOARD_WEB_BASE=/patchboard-private/ VITE_JAZZ_SERVER_URL=/patchboard-private/jazz \
  VITE_PATCHBOARD_PRIVATE=1 pnpm build)
(cd "$RELEASE/webui" &&
  VITE_DIM0_JAZZ_CANVAS=1 VITE_DIM0_PERSISTENT_TEXT_CATALOG=1 \
  VITE_DIM0_PERSISTENT_FILTERED_SHARING=1 VITE_DIM0_QA_NATIVE_SAVED_VIEW=0 \
  VITE_DIM0_QA_NATIVE_CATALOG_READONLY=0 \
  "$NODE" node_modules/vite/bin/vite.js build --outDir "$ASSETS")
test -f "$ASSETS/index.html"
shasum -a 256 "$ASSETS/index.html"
# New cohort only. Never run this mkdir/migrate recipe on an existing store.
test ! -e "$STORE"
mkdir -m 700 "$STORE"
export PATCHBOARD_PRIVATE_ROOT="$STORE"
export PATCHBOARD_PRIVATE_ORIGIN="$ORIGIN"
export PATCHBOARD_PRIVATE_PORT="$BACKEND_PORT"
export PATCHBOARD_PRIVATE_DIM0_ONLY=1
export PATCHBOARD_PERSISTENT_TEXT_CATALOG=1
export PATCHBOARD_PERSISTENT_FILTERED_SHARING=1
export PATCHBOARD_PERSISTENT_MCP_TABLE_CREATE=1
export PATCHBOARD_PRIVATE_DEV=0 PATCHBOARD_QA_TYPED_RECORD=0 PATCHBOARD_QA_HTTPS_TEXT_TABLE=0
export PATCHBOARD_OAUTH_CI_RESTART=0 PATCHBOARD_ACC051_INFLIGHT_QA=0
unset PATCHBOARD_PRIVATE_TEST_PID_FILE
(cd "$RELEASE/integrations/patchboard" && pnpm auth:migrate:private)
```

Record version, release SHA, asset hash, origin, generation path and operator
in the protected release manifest; never include secret values. For an existing
approved cohort use a verified restored generation in place of fresh creation;
do not silently regenerate its auth secret. Migration is explicit and backed
up, never a startup workaround. The embedded SQLite store includes
`$STORE/jazz/jazz.sqlite`, app/store identities, inspector secret, blob
metadata, blobs and sidecars. Auth, passkey/public-key registrations, sessions,
membership directory, OAuth admission/drain ledgers, view-share digests and
preferences are in `$STORE/auth/better-auth.sqlite` plus WAL/SHM and
`$STORE/auth/better-auth-secret`. Preserve the whole root. No external
chunk bucket is configured by the private entry point; if that changes, expand
the backup plan before running it.

### 3. Service supervision and ingress

For the isolated browser rehearsal the existing native Vite preview proxy
is used; it is **not** a production server
([Vite guidance](https://vite.dev/guide/static-deploy.html)). Proposed public
static/proxy server is Caddy 2. It was not installed on the inspected Mac,
so provisioning, config validation, WebSocket/SSE and OAuth routing rehearsal
with Caddy remain release gates. This is a front-door choice only; no Jazz or
auth architecture change. Do not publish a Vite preview server as production.

Proposed Caddyfile: bind loopback only, reject wrong Host, retain the API
path and Host, set HTTPS forwarding only behind the dedicated TLS ingress,
and serve native SPA routes without sending unknown API paths to the SPA.
Do not enable request access logging that records bearer headers, cookies,
share links or OAuth callback query parameters. Verify the actual installed
Caddy version/config, then independently exercise discovery and streaming.

```bash
export CADDY=/opt/homebrew/bin/caddy
test -x "$CADDY"
cat > "$OPS/Caddyfile" <<'CADDYFILE'
{
  admin off
  auto_https off
}
http://:{$WEB_PORT} {
  bind 127.0.0.1
  route {
    @wrong not host {$SASHAI_HOST}
    respond @wrong 421
    @api path /patchboard-private /patchboard-private/* /patchboard-auth /patchboard-auth/* /patchboard-private-mcp /patchboard-private-mcp/* /.well-known/*
    handle @api {
      reverse_proxy 127.0.0.1:{$BACKEND_PORT} {
        header_up X-Forwarded-Proto https
        header_up X-Forwarded-Host {http.request.host}
      }
    }
    handle /assets/* {
      root * "{$ASSETS}"
      file_server
    }
    handle {
      root * "{$ASSETS}"
      header Cache-Control "no-store"
      try_files {path} /index.html
      file_server
    }
  }
}
CADDYFILE
"$CADDY" validate --config "$OPS/Caddyfile" --adapter caddyfile
```

Render private launchd job files in OPS, not into an existing service's
LaunchAgents directory. These jobs are loaded explicitly for a release;
KeepAlive restarts an unexpected exit, so **bootout**, not kill alone, is
required for maintenance. Use actual absolute binaries and immutable checkout.
The backend program arguments and launchctl bootstrap/bootout pattern were
exercised in a separate synthetic job on the Mac; the Caddy and ingress jobs
below have not been loaded or tested.

```bash
export TAILSCALED=/usr/local/bin/tailscaled
export TAILSCALE=/run/current-system/sw/bin/tailscale
export SOCKET="$BASE/ingress/sashai.sock"
export TAIL_STATE="$BASE/ingress/sashai.state"
test -x "$TAILSCALED" && test -x "$TAILSCALE"
python3 - <<'PY'
import os, pathlib, plistlib
e=os.environ
ops=pathlib.Path(e["OPS"])
common={"PATH":e["PATH"],"HOME":e["HOME"]}
backend_keys=("PATCHBOARD_PRIVATE_ROOT","PATCHBOARD_PRIVATE_ORIGIN","PATCHBOARD_PRIVATE_PORT",
 "PATCHBOARD_PRIVATE_DIM0_ONLY","PATCHBOARD_PERSISTENT_TEXT_CATALOG","PATCHBOARD_PERSISTENT_FILTERED_SHARING",
 "PATCHBOARD_PERSISTENT_MCP_TABLE_CREATE","PATCHBOARD_PRIVATE_DEV","PATCHBOARD_QA_TYPED_RECORD",
 "PATCHBOARD_QA_HTTPS_TEXT_TABLE","PATCHBOARD_OAUTH_CI_RESTART","PATCHBOARD_ACC051_INFLIGHT_QA")
def job(name,args,cwd,variables):
    label="net.drunkod.sashai."+name
    log=str(pathlib.Path(e["BASE"])/"logs"/(name+".log"))
    p={"Label":label,"ProgramArguments":args,"WorkingDirectory":cwd,
       "EnvironmentVariables":{**common,**variables},"RunAtLoad":True,
       "KeepAlive":True,"ThrottleInterval":10,"ExitTimeOut":30,
       "StandardOutPath":log,"StandardErrorPath":log}
    path=ops/(label+".plist")
    with path.open("xb") as f: plistlib.dump(p,f)
    path.chmod(0o600)
job("backend",[e["NODE"],"--import","tsx","src/private-demo.ts"],
    e["RELEASE"]+"/integrations/patchboard/apps/server",{k:e[k] for k in backend_keys})
job("web",[e["CADDY"],"run","--config",e["OPS"]+"/Caddyfile","--adapter","caddyfile"],
    e["OPS"],{k:e[k] for k in ("SASHAI_HOST","ASSETS","WEB_PORT","BACKEND_PORT")})
job("ingress",[e["TAILSCALED"],"--tun=userspace-networking","--socket="+e["SOCKET"],
    "--state="+e["TAIL_STATE"]],e["BASE"]+"/ingress",{})
PY
export DOMAIN="gui/$(id -u)"
# Inspect the two ports and three service labels: stop if any is already owned.
for port in "$BACKEND_PORT" "$WEB_PORT"; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN; then echo "Port in use"; exit 1; fi
done
for service in backend web ingress; do
  if launchctl print "$DOMAIN/net.drunkod.sashai.$service" >/dev/null 2>&1; then
    echo "Service already loaded: $service"; exit 1
  fi
done
launchctl bootstrap "$DOMAIN" "$OPS/net.drunkod.sashai.backend.plist"
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/health"; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/health"
launchctl bootstrap "$DOMAIN" "$OPS/net.drunkod.sashai.web.plist"
for attempt in $(seq 1 30); do
  if curl -fsS -H "Host: $SASHAI_HOST" "http://127.0.0.1:$WEB_PORT/signin" > /dev/null; then break; fi
  sleep 1
done
curl -fsS -H "Host: $SASHAI_HOST" "http://127.0.0.1:$WEB_PORT/signin" > /dev/null
# Require the wrong-Host response to be 421 and unauthenticated MCP 401.
test "$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: wrong.invalid' "http://127.0.0.1:$WEB_PORT/signin")" = 421
test "$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SASHAI_HOST" "http://127.0.0.1:$WEB_PORT/patchboard-private-mcp")" = 401
```

Wait for readiness rather than retrying user writes. Inspect
`launchctl print "$DOMAIN/net.drunkod.sashai.backend"` and web status.
If startup fails, bootout the failed job and investigate before continuing;
do not spin-retry indefinitely. For the **authorized release window only**,
enroll the isolated ingress job with its own socket and protected state,
using interactive Tailscale authentication and the approved Funnel policy.
Confirm actual DNS matches the proposed RP; if it differs, do not onboard
until the canonical origin and build are reviewed. Keep primary node's
Funnel status unchanged.

```bash
# Only after explicit authorization, not for the restore rehearsal.
launchctl bootstrap "$DOMAIN" "$OPS/net.drunkod.sashai.ingress.plist"
"$TAILSCALE" --socket="$SOCKET" up --hostname=sashai-web
"$TAILSCALE" --socket="$SOCKET" status --json | python3 -c \
 'import json,sys,os; assert json.load(sys.stdin)["Self"]["DNSName"].rstrip(".")==os.environ["SASHAI_HOST"]'
"$TAILSCALE" --socket="$SOCKET" funnel status
"$TAILSCALE" --socket="$SOCKET" funnel --bg --https=443 "$WEB_PORT"
"$TAILSCALE" --socket="$SOCKET" funnel status
curl -fsS "$ORIGIN/signin" > /dev/null
curl -fsS "$ORIGIN/.well-known/oauth-authorization-server/patchboard-auth" > /dev/null
test "$(curl -s -o /dev/null -w '%{http_code}' "$ORIGIN/patchboard-private-mcp")" = 401
```

References: [Funnel command](https://tailscale.com/docs/reference/tailscale-cli/funnel),
[Caddy reverse proxy](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy).
Funnel background mappings survive daemon restart; do not let an unreviewed
ingress job re-expose an unhealthy service. Verify external reachability from
a separate off-tailnet browser only during the approved release window.
The isolated node's state is confidential and not part of the application
store copy. Back it up separately using approved Tailscale procedures, not
to a concurrent clone of the node identity.

### 4. Stop, back up and restore

Schedule a maintenance window, warn users, allow acknowledged/offline writes
to settle where possible, and stop new admission. There is no general
production maintenance-write fence or automatic stranded-worker supervisor
in this release: coordinate the freeze, withdraw public ingress, close
clients and stop the proxy; verify no other local writer or queued request
can reach the store. Read-only lease/pending counts must be zero or explicitly
reconciled by the trusted operator with existing exact receipt/event evidence.
Do not force-expire an unknown outcome or treat a process restart as a
successful write. If drain cannot be established, **stop the release**.

```bash
# Scope this command only to the dedicated SashAI node, never the primary one.
"$TAILSCALE" --socket="$SOCKET" funnel --https=443 off
"$TAILSCALE" --socket="$SOCKET" funnel status
launchctl bootout "$DOMAIN/net.drunkod.sashai.web"
# Verify absence of admitted work; sqlite3 -readonly prints counts only.
COUNTS=$(sqlite3 -readonly "$STORE/auth/better-auth.sqlite" \
 'SELECT count(*) FROM patchboard_mcp_write_lease; SELECT count(*) FROM patchboard_grant_disconnect_pending;')
printf '%s\n' "$COUNTS"
test "$COUNTS" = "$(printf '0\n0')"
# Operator confirms both counts 0, no in-flight HTTP/Jazz writes and no other peers.
LOG="$BASE/logs/backend.log"
LINES=$(wc -l < "$LOG")
launchctl bootout "$DOMAIN/net.drunkod.sashai.backend"
# Require a fresh marker, not a previous invocation's line.
for attempt in $(seq 1 30); do
  if tail -n "+$((LINES+1))" "$LOG" | grep -Fx PRIVATE_AUTH_STOPPED; then break; fi
  sleep 1
done
tail -n "+$((LINES+1))" "$LOG" | grep -Fx PRIVATE_AUTH_STOPPED
if launchctl print "$DOMAIN/net.drunkod.sashai.backend" >/dev/null 2>&1; then
  echo 'Backend still supervised: do not copy'; exit 1
fi
# The copy helper also fails if lsof cannot verify there are no open handles.
# Choose an actual mounted, encrypted and access-controlled backup parent.
: "${BACKUP_PARENT:?Set absolute private directory on approved encrypted media}"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP="$BACKUP_PARENT/$RELEASE_SHA-$STAMP"
cd "$RELEASE/integrations/patchboard"
"$NODE" scripts/stopped-store-copy.mjs backup "$STORE" "$BACKUP"
sync
```

If bootout returns before the stop marker, wait for the **new** marker and
verify exit/status; if it never appears, or a process had to be force-killed,
do not label it a clean backup. Preserve the affected generation and escalate.
The readiness PR fixes a beta.5 signal-handler interaction: upstream drains
Jazz and re-raises a signal if no application listener remains; the old
`process.once` handlers were removed before asynchronous HTTP/auth close.
Direct Node SIGTERM exited by signal on the base, and the original restore
harness failed before taking a backup. Persistent, idempotent handlers wait
for both closes and emit PRIVATE_AUTH_STOPPED before exit 0.

The follow-up CI diagnosis identified a second shutdown blocker while clients
remain connected: the stateless MCP transport's standalone GET SSE streams
outlived Jazz's socket drain, keeping Node's HTTP close callback pending.
The private entry point now stops admitting new HTTP requests (503) and
closes only application passive reads: MCP standalone GET streams via the
pinned SDK's closeStandaloneSSEStream and native canvas read streams via
their existing unsubscribe/end path. An admitted MCP POST is not aborted
by this mechanism. Do not equate transport closure with successful completion
of an admitted write: the pre-stop write freeze and lease/receipt checks
above are still mandatory. The clean-stop marker is emitted only after the
server and auth database close. No grant, permission, schema or transaction
change.

The copy helper requires canonical absolute paths, private roots and existing
private destination parents, checks local open files with lsof, copies the
**whole** tree including WAL/SHM if present, records file modes/size/SHA-256,
and verifies source and destination. It rejects symlinks, hard links and
special files rather than silently omit them. It creates a new destination
only and publishes the manifest last. It is not a distributed lock, a
cryptographically authenticated archive, a power-loss-atomic snapshot, an
encryption system or an external chunk backup. Keep the operator fence for
the entire copy, protect the manifest as private, flush the media and keep an
independent encrypted copy. Inspect failures privately; never publish the
bundle, its secret/checksum inventory or raw logs. An incomplete destination
is quarantined, not treated as a usable backup.

To recover, leave the original generation stopped and keep the verified backup
unchanged. Restore into a **new** generation. Use the exact release and same
origin. Do not run auth enrollment/migration against a restored store unless a
separate reviewed migration requires it.

```bash
RESTORED="$BASE/stores/generation-0002"
cd "$RELEASE/integrations/patchboard"
"$NODE" scripts/stopped-store-copy.mjs restore "$BACKUP" "$RESTORED"
# Repoint only the unloaded dedicated backend plist.
export STORE="$RESTORED"
export PATCHBOARD_PRIVATE_ROOT="$STORE"
python3 - <<'PY'
import os,pathlib,plistlib
p=pathlib.Path(os.environ["OPS"])/"net.drunkod.sashai.backend.plist"
data=plistlib.loads(p.read_bytes())
assert data["Label"]=="net.drunkod.sashai.backend"
data["EnvironmentVariables"]["PATCHBOARD_PRIVATE_ROOT"]=os.environ["STORE"]
tmp=p.with_suffix(".new")
with tmp.open("xb") as f: plistlib.dump(data,f)
tmp.chmod(0o600); tmp.replace(p)
PY
launchctl bootstrap "$DOMAIN" "$OPS/net.drunkod.sashai.backend.plist"
for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$BACKEND_PORT/health"; then break; fi
  sleep 1
done
curl -fsS "http://127.0.0.1:$BACKEND_PORT/health"
launchctl bootstrap "$DOMAIN" "$OPS/net.drunkod.sashai.web.plist"
```

Keep ingress off pending checks. To sign in on the production RP, use an
approved private access route for that exact hostname/valid TLS, or a
controlled release window after restore validation; do not disable certificate
verification or use a different origin and claim the same passkey works.
On the isolated fixture the original source stayed stopped and the copied
generation ran at the identical local HTTPS origin. No source and restore
were live simultaneously. If an independent staging copy must coexist with
the original, follow the upstream `store detach` guidance using the
workspace-installed beta.5 CLI **on the copy only**, separate chunk storage,
separate auth configuration and origin, no original peers or production
bearers; use synthetic accounts for a different RP.

Verify same Owner sign-in, exact board/table/field/view/row IDs and contents,
actor and receipts, membership, grants and active/revoked shares before
reopening access. For actual recovery measure stopped backup, verified restore,
health and first authenticated read separately. Test the recoverable backup
regularly; the tiny fixture time is not a production RTO commitment.

### 5. Cutover and rollback without silently losing writes

Record the pre-cutover release, origin, generation, timestamp and protected
backup manifest. Record the first authorized writes/receipts and user-visible
confirmation since cutover. If health, sign-in or authorization fails, freeze
writes and withdraw only this ingress. Keep a second stopped backup of the
**post-cutover** generation before changing anything, including both stores,
sidecars, blob data, grants, revocations and receipts. Keep both immutable
generations and their release builds.

Prefer a forward repair or a compatible beta.5 build against a verified copy
of the newest complete generation. Revert to an older binary **only** with
the matching pre-upgrade backup and explicit data reconciliation. A restored
old snapshot necessarily lacks later writes and revocations. Do not reopen
with a stale grant/share ledger, merge raw SQLite files, reset Jazz state,
blindly replay request IDs with different inputs, or ask users to overwrite
pending local writes. There is no general cross-version replay/export
guarantee; the release owner must approve a supported reconciliation plan
based on exact receipts/actor/operation identities and revalidate all
post-cutover writes, memberships and revocations. If an acknowledged write
cannot be preserved, remain offline and escalate. A zero-write maintenance
cutover and verified restore is the safe rollback point. Proposed recovery
goal: no acknowledged write silently lost; production recovery time and
backup cadence need operator signoff and realistic-volume rehearsal.

### 6. One public-endpoint acceptance (not executed yet)

Use one explicitly designated synthetic Owner and board, one persistent
profile, one installed ChatGPT custom MCP connector over the approved public
HTTPS origin, and a separate signed-in nonmember from an off-tailnet browser.

1. Sign in with passkey; verify SashAI and expected locale. Discover MCP
   metadata at `$ORIGIN/patchboard-private-mcp`; explicitly consent to
   board:read, board:write and table:create on this board only.
2. Actual installed client calls call-api-write with dataset.create.v1,
   Title primary field, All rows grid and unique request_id. Approve only the
   intended operation. Retry identical request_id and input; capture same
   dataset/field/view/receipt/event IDs and replayed true. Native Data shows
   exactly one table. Do not substitute SDK evidence for installed client.
3. Add Demo alpha, Internal planning and Demo beta in native Data on that
   dataset. Save a Title-prefix Demo view and copy the real share link.
   Nonmember sees only two Demo rows and Title, no board membership/grant.
4. Planned controlled service restart with same generation/origin. Reopen
   the same IDs, all three Owner rows and two recipient rows; link remains
   active. Check exact catalog/row receipts/events and no duplicate objects.
5. Native Settings disconnects exactly this MCP grant (200). A fresh MCP
   write with a different request_id must return HTTP 401; correlate actual
   request ID/status at server boundary, without bearer or callback details.
   Owner still sees all three rows and independent share remains usable.
   Revoke the share and verify next-fetch denial/grid clearing if retiring
   the rehearsal link. Confirm no outstanding lease and no new receipt/event.
6. Record SHA, origin, actor/board synthetic IDs, timestamps, response
   statuses, counts, restart timing, signed-off screenshots and independent
   operator identity. Capture only sanitized fields. If first sign-in
   /api/me 500 recurs or user is blocked, stop and capture first failing
   timestamp/request ID, matching proxy/backend error class and failing
   stage; no cookies, tokens, query strings or user values. #31's 132/132
   successful /api/me responses do not explain its historical 500, and its
   MCP-description/denial-correlation items are distinct. Verify safe
   correlation instrumentation before inviting users.

Reuse #28's disposable installed-client evidence and #33's staging combined
proof; neither is this persistent public release acceptance. Do not broaden
OAuth scopes or relax consent to make a client connect. Desktop #32 stays
separate. No public activation or production write is authorized by this PR.

### 7. Isolated operational rehearsal

From the readiness candidate, with frozen workspace and webui dependencies,
Node 24.22.3 and Chromium available:

```bash
cd integrations/patchboard
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
CI=1 NODE_OPTIONS=--no-experimental-webstorage pnpm test:native:stopped-store-restore
pnpm --filter @patchboard/server exec tsx --test test/private-graceful-stop.test.mjs
```

The native proof creates a new non-temporary mode-0700 fixture and separate
backup/destination, starts the direct Node backend on an allocated loopback
port, enrolls real virtual-passkey accounts, creates one native table/row,
keeps an authenticated native canvas SSE response open through SIGTERM,
requires its EOF and clean process exit before copying, verifies the whole
private root, restores into a new generation
and reauthenticates with the same passkey at the same local HTTPS origin.
It asserts unchanged canonical catalog rows/receipts and rejects live
copy, altered backup and existing destination. No production root can be
supplied. All fixture stores and listeners are retired at teardown.
See [operational rehearsal evidence](review-rollout-restore-20261127.md).
The separate launchd smoke exercises only the backend's bootstrap, readiness,
bootout, clean-stop marker and absence of open files in a synthetic store.
Neither test provisions the production Caddy/Tailscale node or tests host loss.

### 8. Independent operator review record (required, pending)

Use an isolated store, not any live application directory. Another operator
should check out the final PR SHA with frozen dependencies, follow section 7
to obtain synthetic fixture IDs and verify the stopped-store helper and
clean-stop evidence. Independently follow the stop/backup/restore commands in
section 4 in a separately provisioned isolated staging environment; adapt
only the isolated origin, paths and ports. No Funnel activation. Hold the
original store stopped while verifying the restored copy. Record:

- Human operator name and final revision; date/host and isolation boundary.
- Exact commands, any deviation or instruction that required assistance.
- Before/after Owner identity match (boolean), board, dataset, record and
  catalog/row receipt IDs; byte verification and no overwritten store.
- Clean-stop result, backup/restore timings and same-passkey readback.
- Explicit pass/fail and blockers. Do not include tokens, cookies, secrets,
  private manifests or real user data.

An automated author rerun is not independent human signoff. Post the record
on PR #39. The repo currently has only the maintainer collaborator; no
independent operator has been assigned or signed off.

### 9. Release gate

- Both baseline post-merge workflows green; review the readiness diff and its
  CI, especially the new clean-stop regression.
- Independent human can execute the runbook on isolated staging, including
  tested full stop/restore on realistic volume and same Owner readback.
- Approve actual canonical DNS/RP, dedicated ingress, supported static proxy,
  supervised restart/reboot, capacity, encrypted backups and operator rota.
- Establish ingress freeze, no unresolved leases, safe first-request/MCP
  denial correlation, and signed rollback/reconciliation procedure.
- Obtain explicit public release-window authorization. Complete the one
  public journey above before admitting the intended cohort.

**NO-GO for public launch until these gates are met.** A passing disposable
local restore is evidence for readiness review, not a claim of production
recovery, independent operator signoff or public availability.
