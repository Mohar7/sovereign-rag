# Deploy

The live sovereign-rag stack runs as three launchd services on the Mac Mini:

| service | port | source |
|---|---|---|
| `dev.sovereign-rag.api` | 8000 | `uv run uvicorn sovereign_rag.api:app` |
| `dev.sovereign-rag.langgraph` | 2024 | `uv run langgraph dev --allow-blocking` |
| `dev.sovereign-rag.frontend` | 5173 | `npm run dev` (vite, Tailscale-bound) |

## First-time setup (one SSH session, never again)

```
ssh muhriddin@100.81.83.18
cd /Users/muhriddin/actions-work/sovereign-rag
./deploy/install-services.sh
```

That copies the three `.plist` files to `~/Library/LaunchAgents`, loads them with `launchctl`, and they survive reboot.

## Ongoing deploys

Push to `main`. The `Deploy (self-hosted)` workflow:

1. Checks out the new commit into the live directory.
2. Runs `uv sync --frozen` and `npm ci` if lockfiles changed.
3. Builds the frontend (`npm run build`) if `frontend/` changed.
4. `launchctl kickstart -k` each affected service.
5. Runs `deploy/smoke.sh` against `:8000`, `:2024`, `:5173`.

If smoke fails the workflow exits non-zero and the previous version stays running (we restart in place; rollback is `git reset --hard <prev>` + `kickstart -k`).

## Manual ops (when something explodes)

```
deploy/start-all.sh     # start everything
deploy/stop-all.sh      # stop everything
deploy/restart.sh       # restart everything
deploy/smoke.sh         # health-check the live ports
launchctl list | grep sovereign-rag
tail -f /tmp/sovereign-rag-*.log
```
