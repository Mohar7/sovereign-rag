#!/usr/bin/env bash
set -euo pipefail
for svc in dev.sovereign-rag.api dev.sovereign-rag.langgraph dev.sovereign-rag.frontend; do
  launchctl bootout "gui/$(id -u)/$svc" 2>/dev/null || launchctl unload "$HOME/Library/LaunchAgents/$svc.plist" 2>/dev/null || true
  echo "stopped $svc"
done
