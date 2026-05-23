#!/usr/bin/env bash
# Health check the three live services. Exit non-zero on any failure.

set -euo pipefail

API=http://127.0.0.1:8000
LG=http://127.0.0.1:2024
WEB=http://127.0.0.1:5173

# Wait up to 60s for each port to come alive after a restart.
wait_for() {
  local url=$1 name=$2
  for i in $(seq 1 30); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "  $name OK ($url)"
      return 0
    fi
    sleep 2
  done
  echo "  $name FAILED — $url unreachable after 60s" >&2
  return 1
}

echo "==> Smoke test"
wait_for "$API/api/health" "fastapi"
wait_for "$LG/info" "langgraph"
wait_for "$WEB" "vite"

echo
echo "==> /api/health snapshot"
curl -fsS "$API/api/health" | python3 -m json.tool

echo
echo "==> /api/corpus/stats snapshot"
curl -fsS "$API/api/corpus/stats" | python3 -m json.tool

echo
echo "Smoke OK."
