#!/usr/bin/env bash
# Device-local fallback for the WebMCP skill's Chrome DevTools CLI.
# The installed Nix helper expects build/src/bin, while recent npm builds
# ship out/Default/gen/src/bin. Do not modify the read-only skill store.
set -euo pipefail
shopt -s nullglob
for package_dir in "$HOME"/.npm/_npx/*/node_modules/chrome-devtools-mcp; do
  for entry in out/Default/gen/src/bin/chrome-devtools.js build/src/bin/chrome-devtools.js; do
    if [[ -f "$package_dir/$entry" ]]; then
      exec node "$package_dir/$entry" "$@"
    fi
  done
done
echo "Cached chrome-devtools-mcp CLI not found. Install the WebMCP browser skill's dependencies." >&2
exit 1
