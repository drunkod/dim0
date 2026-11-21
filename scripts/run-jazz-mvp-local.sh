#!/usr/bin/env bash
# Run the experimental Dim0/Jazz MVP on loopback, without touching any live
# Patchboard or Tailscale services. Requires installed pnpm/webui dependencies.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
JAZZ_PRIVATE_PORT="${JAZZ_PRIVATE_PORT:-8798}"
APP_PORT="${APP_PORT:-5178}"
export PATCHBOARD_PRIVATE_DEV=1
export PATCHBOARD_PRIVATE_PORT="$JAZZ_PRIVATE_PORT"
export PATCHBOARD_PRIVATE_ROOT="${PATCHBOARD_PRIVATE_ROOT:-/tmp/dim0-jazz-mvp-local}"
export PATCHBOARD_PRIVATE_ORIGIN="http://localhost:$APP_PORT"

if ! [[ "$JAZZ_PRIVATE_PORT" =~ ^[0-9]+$ && "$APP_PORT" =~ ^[0-9]+$ ]]; then
  echo "Ports must be numeric" >&2; exit 2
fi
for port in "$JAZZ_PRIVATE_PORT" "$APP_PORT"; do
  if lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null | grep -q .; then
    echo "Port $port is already in use; stop the existing test instance first." >&2
    exit 1
  fi
done
test -x "$ROOT/webui/node_modules/.bin/vite" || {
  echo "Install webui dependencies first: cd webui && npm ci" >&2; exit 1;
}
test -d "$ROOT/integrations/patchboard/apps/server/node_modules" || {
  echo "Install Patchboard dependencies first: cd integrations/patchboard && pnpm install" >&2; exit 1;
}

if [[ ! -f "$ROOT/integrations/patchboard/apps/web/dist/index.html" ]]; then
  echo "Building isolated Patchboard passkey sign-in..."
  (
    cd "$ROOT/integrations/patchboard"
    PATCHBOARD_WEB_BASE=/patchboard-private/ \
      VITE_JAZZ_SERVER_URL=/patchboard-private/jazz \
      VITE_PATCHBOARD_PRIVATE=1 pnpm --filter @patchboard/web build
  )
fi

(
  cd "$ROOT/integrations/patchboard"
  pnpm auth:migrate:private
  pnpm --filter @patchboard/server exec tsx src/private-demo.ts
) &
backend_pid=$!
cleanup() { kill "$backend_pid" 2>/dev/null || true; wait "$backend_pid" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

for attempt in {1..100}; do
  if curl --max-time 1 -fsS "http://127.0.0.1:$JAZZ_PRIVATE_PORT/health" >/dev/null 2>&1; then
    break
  fi
  sleep .2
done
curl --max-time 3 -fsS "http://127.0.0.1:$JAZZ_PRIVATE_PORT/health" >/dev/null

echo "Dim0 + Jazz MVP: http://localhost:$APP_PORT/jazz-signin"
echo "Separate Jazz data directory: $PATCHBOARD_PRIVATE_ROOT"
(
  cd "$ROOT/webui"
  VITE_DIM0_JAZZ_CANVAS=1 PATCHBOARD_PRIVATE_PORT="$JAZZ_PRIVATE_PORT" \
    APP_PORT="$APP_PORT" ./node_modules/.bin/vite --host 127.0.0.1 --strictPort
)
