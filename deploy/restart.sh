#!/usr/bin/env bash
set -euo pipefail
for svc in dev.sovereign-rag.api dev.sovereign-rag.langgraph dev.sovereign-rag.frontend; do
  launchctl kickstart -k "gui/$(id -u)/$svc"
  echo "restarted $svc"
done
