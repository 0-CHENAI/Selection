#!/bin/bash
# Lint guard: detect raw webContents.send() outside typed wrappers.
#
# Approved locations:
#   - window-manager.ts: legacy handshake fallback in pushToWindow()
#   - browser-pane-manager.ts: toolbar scope (separate preload context, not in BroadcastEventMap)
#   - menu.ts: sendToRenderer (typed with MenuBroadcastChannel)
#
# All other raw webContents.send() calls should use typed RpcServer.push() / pushTyped().

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

if command -v rg >/dev/null 2>&1; then
  set +e
  VIOLATIONS=$(rg 'webContents\s*\??\.\s*send\s*\(' apps/electron/src/main/ \
    --glob '!**/window-manager.ts' \
    --glob '!**/browser-pane-manager.ts' \
    --glob '!**/menu.ts' \
    -l)
  SEARCH_STATUS=$?
  set -e
else
  set +e
  VIOLATIONS=$(grep -R -l -E 'webContents[[:space:]]*\??\.[[:space:]]*send[[:space:]]*\(' apps/electron/src/main/ \
    --include='*.ts' \
    --include='*.tsx' \
    --exclude='window-manager.ts' \
    --exclude='browser-pane-manager.ts' \
    --exclude='menu.ts')
  SEARCH_STATUS=$?
  set -e
fi

if [ "$SEARCH_STATUS" -gt 1 ]; then
  echo "ERROR: webContents.send scan failed with status $SEARCH_STATUS" >&2
  exit "$SEARCH_STATUS"
fi

if [ -n "${VIOLATIONS:-}" ]; then
  echo "ERROR: Raw webContents.send() found outside approved wrappers:"
  echo "$VIOLATIONS"
  echo ""
  echo "Use RpcServer.push()/pushTyped() and explicit PushTarget routing instead."
  echo "See apps/electron/src/main/handlers and apps/electron/src/transport/types.ts for typed dispatch patterns."
  exit 1
fi

echo "OK: No raw webContents.send() outside approved wrappers."
