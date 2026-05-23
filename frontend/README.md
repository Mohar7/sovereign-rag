# sovereign-rag — Web UI

The Ask-screen frontend for [sovereign-rag](../). Talks to the LangGraph
deployment of the QA graph (`sovereign_qa`) via the official
**`@langchain/langgraph-sdk`** — no custom HTTP layer, no FastAPI ingestion
to maintain on this side.

Visual design ported from the Claude Design handoff in
`docs/ui-design-brief.md` (and the matching mocks under `assisstant/`).

## Running locally

You need two processes — the LangGraph dev server and Vite.

```bash
# 1. Backend — LangGraph dev server on :2024 (from the repo root)
uv run langgraph dev
#   → http://127.0.0.1:2024 + Studio UI link in the terminal

# 2. Frontend — Vite dev server on :5173
cd frontend
npm install
npm run dev
#   → http://127.0.0.1:5173
```

The Vite config proxies `/lg/*` → `http://127.0.0.1:2024` so the browser
sees a same-origin server (no CORS). Override the backend URL by setting
`VITE_LANGGRAPH_URL` in `.env`.

## Routes

| Route | What it is |
|---|---|
| `/`           | The live Ask screen. Talks to the LangGraph deployment. Five visual states emerge naturally as the run evolves: empty → streaming → done (Hero) → interrupted (HITL) → error. |
| `/artboards`  | Portfolio view — the same five states rendered with mock data, side by side. Useful for screenshots and visual QA without standing up a backend. |

## Architecture

- **Control plane**: the QA `StateGraph` lives on the LangGraph server. The
  SDK gives us threads, streaming, interrupt detection and resume
  primitives — `useThreads`, `useRun` wrap them.
- **Data plane**: untouched on the front-end side. The graph still uses
  the project's own Milvus / Neo4j / Ollama / FlashRank / Postgres-
  checkpointer machinery; we just consume its emitted state.
- **Streaming**: `client.runs.stream(..., streamMode: ["values",
  "updates", "messages-tuple"])`. The hook accumulates streamed token
  text from `messages-tuple`, watches `updates` for node transitions
  (drives the pipeline-status bar), and falls back to the final `values`
  snapshot for citations / metadata.
- **HITL**: when the graph emits an `interrupt` event with
  `reason: "approve_urls"`, the assistant turn enters `status:
  "interrupted"` and the inline `ApprovalCard` lets the user pick URLs;
  approval calls `client.runs.stream(..., command: { resume: {
  approved_urls } })`.

## Visual language (from the design)

- **Typefaces** — IBM Plex Mono (UI chrome, metadata, citation chips) +
  IBM Plex Serif (assistant prose, user questions). Loaded from Google
  Fonts in `index.html`.
- **Two-accent system** — citation chips are tinted *both* with
  graph-blue (`#7aa2f7`) and vector-lavender (`#bb9af7`) when a chunk
  came through both retrievers; one side only when one retriever
  dominated; warm orange (`#ff9e64`) reserved for HITL moments
  (`web` chips, approval card border, "needs approval" thread badge).
- **Density** — 12 px chrome, 14 px serif body, 0–2 px corners, hairline
  rules. Closer to a terminal than a chat-bot.

## Deploying

For a production deployment, set:

```env
VITE_LANGGRAPH_URL=https://<your-langgraph-deployment>
VITE_LANGGRAPH_API_KEY=<key>      # if your deployment is gated
VITE_LANGGRAPH_ASSISTANT=sovereign_qa
```

then `npm run build`. The output in `dist/` is a static SPA you can serve
from anywhere (Vercel, Netlify, Caddy, nginx, S3+CloudFront, …). LangGraph
itself is deployed separately — either via the LangGraph Platform
(`langgraph deploy`) or by running `langgraph build` to produce a Docker
image you self-host.

## Status

What's wired live:
- Thread list (create / select; per-thread state)
- Send question → streaming answer with inline `[n]` citations
- Stop streaming mid-flight (cancels the SDK stream)
- HITL approval card → resume via `Command(resume=...)`
- Sources rail with cross-encoder score, snippet, copy URI
- Empty state + corpus stats
- Error banner on stream failures
- Pipeline status bar (driven by node-update events)

What still uses mock data and is honest about it:
- Corpus stats in the TopBar / Empty state (no `/corpus/stats` endpoint yet)
- Service health pills (no `/health/detailed` yet)
- Resuming a previously-completed thread doesn't re-hydrate its turns
  (would need a `threads.getState` round trip)

These are not bugs — they're tracked as follow-ups in `docs/ui-design-brief.md`.
