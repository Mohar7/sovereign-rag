#!/usr/bin/env bash
# Runs ON the Mac Mini, in the LIVE deployment directory, called by the
# Deploy GitHub Actions workflow after it has already pulled the latest
# commit into that directory.
#
# Idempotent and safe to run by hand if something breaks.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "==> Deploying $(git rev-parse --short HEAD) — $(git log -1 --pretty=format:'%s')"

# Detect what changed since the last deploy marker so we only do expensive
# steps when needed. First deploy: everything is "changed".
LAST_DEPLOY_FILE="$REPO_ROOT/.deploy-sha"
PREV_SHA="$(cat "$LAST_DEPLOY_FILE" 2>/dev/null || echo "")"
CURRENT_SHA="$(git rev-parse HEAD)"

if [ -z "$PREV_SHA" ]; then
  changed_files="(first deploy: rebuilding everything)"
  py_changed=1; fe_changed=1; lock_changed=1
else
  changed_files="$(git diff --name-only "$PREV_SHA" "$CURRENT_SHA" 2>/dev/null || echo '')"
  py_changed=$(echo "$changed_files" | grep -E '^(src/|pyproject\.toml|uv\.lock)' >/dev/null && echo 1 || echo 0)
  fe_changed=$(echo "$changed_files" | grep -E '^frontend/' >/dev/null && echo 1 || echo 0)
  lock_changed=$(echo "$changed_files" | grep -E '^(uv\.lock|frontend/package-lock\.json)' >/dev/null && echo 1 || echo 0)
fi

echo "==> Changes since previous deploy ($PREV_SHA → $CURRENT_SHA):"
echo "$changed_files" | sed 's/^/    /' | head -20

# --- Python deps -----------------------------------------------------------
if [ "$py_changed" = "1" ] || [ "$lock_changed" = "1" ]; then
  echo "==> uv sync --frozen"
  /Users/muhriddin/.local/bin/uv sync --frozen
fi

# --- Frontend --------------------------------------------------------------
if [ "$fe_changed" = "1" ]; then
  echo "==> frontend deps + nothing to build (we run vite dev)"
  if [ "$lock_changed" = "1" ] || [ ! -d frontend/node_modules ]; then
    (cd frontend && /opt/homebrew/bin/npm ci)
  fi
fi

# --- Restart services ------------------------------------------------------
echo "==> Restarting launchd services"
restart_svc() {
  local svc=$1
  if launchctl list 2>/dev/null | grep -q "$svc"; then
    launchctl kickstart -k "gui/$(id -u)/$svc"
    echo "    restarted $svc"
  else
    echo "    $svc not registered — skipping. Run deploy/install-services.sh first."
  fi
}

# Only restart what's affected — the API picks up Python changes, langgraph
# picks up graph code, vite HMR catches frontend on its own but a clean
# restart guarantees module cache + .env reload.
if [ "$py_changed" = "1" ]; then
  restart_svc dev.sovereign-rag.api
  restart_svc dev.sovereign-rag.langgraph
fi

# Always kick the frontend on lock changes; vite HMR handles source-only edits.
if [ "$lock_changed" = "1" ]; then
  restart_svc dev.sovereign-rag.frontend
fi

# Record the deploy marker so the next run diffs from here.
echo "$CURRENT_SHA" > "$LAST_DEPLOY_FILE"

# --- Smoke test ------------------------------------------------------------
"$REPO_ROOT/deploy/smoke.sh"

echo
echo "==> Deploy complete: $CURRENT_SHA"
