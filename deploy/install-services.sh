#!/usr/bin/env bash
# One-shot install of the three launchd services for sovereign-rag.
# After this runs once, every push to main re-deploys without SSH.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LAUNCHD_SRC="$REPO_ROOT/deploy/launchd"
LAUNCHD_DST="$HOME/Library/LaunchAgents"

SERVICES=(
  dev.sovereign-rag.api
  dev.sovereign-rag.langgraph
  dev.sovereign-rag.frontend
)

# Kill any pre-existing manually-launched processes on the three ports so the
# launchd services can bind cleanly. Safe to run again — `lsof | xargs kill`
# is a no-op when nothing is listening.
echo "==> Clearing ports 8000 / 2024 / 5173 of any stray processes"
for port in 8000 2024 5173; do
  pids=$(lsof -ti :$port 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "    killing $(echo "$pids" | tr '\n' ' ')on :$port"
    echo "$pids" | xargs -r kill 2>/dev/null || true
    sleep 1
    pids=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$pids" ]; then
      echo "$pids" | xargs -r kill -9 2>/dev/null || true
    fi
  fi
done

echo "==> Installing launchd plists to $LAUNCHD_DST"
mkdir -p "$LAUNCHD_DST"

for svc in "${SERVICES[@]}"; do
  src="$LAUNCHD_SRC/$svc.plist"
  dst="$LAUNCHD_DST/$svc.plist"
  cp "$src" "$dst"
  echo "    $svc"

  # Unload first so we can re-load any updated plist cleanly.
  launchctl unload "$dst" >/dev/null 2>&1 || true
  launchctl load -w "$dst"
done

echo
echo "==> Services loaded. Status:"
launchctl list | grep -E "sovereign-rag" || echo "    (no matching services found)"

echo
echo "==> Tail logs with:"
for svc in "${SERVICES[@]}"; do
  short="${svc##dev.sovereign-rag.}"
  echo "    tail -f /tmp/sovereign-rag-$short.log"
done

echo
echo "Done. Push to main to trigger an automated deploy."
