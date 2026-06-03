# ReAct Agentic RAG — Design

**Status:** approved (brainstorm) — pending implementation plan
**Date:** 2026-06-03
**Supersedes/relates:** `2026-06-02-corrective-rag-hitl-design.md` (CRAG). This design reframes CRAG's corrective web fallback as an agent-decided action and replaces the planned single-turn "follow-up router" with an agentic controller.

---

## 1. Problem & motivation

The `rag_qa` graph is **conversation-blind**: every turn is treated as a fresh, standalone retrieval query (`retrieve → rerank → grade → [CRAG] → generate`). This breaks an entire class of follow-ups:

- **Meta / reformat** — "ответь на русском", "shorter", "as bullets". These need no new retrieval; they transform the *previous* answer. Today they retrieve, grade the context `incorrect` (it doesn't "answer" the instruction), and fire the **CRAG web-fallback loop** — i.e. the system tries to *web-scrape in order to translate*. Observed live in thread `3debfaf9…`: "ответь на русском" graded `incorrect` (0.698), rewrote to a search query, hit `web_search` → `request_approval` → **paused forever**.
- **Multi-hop** — "compare overdraft vs working-capital credit" needs two retrievals; the single-shot pipeline can't.
- **Coreference** — "and what about overdrafts?" retrieves on the literal fragment, not the resolved intent.

**Goal:** a conversation-aware **ReAct agent** that decides, per turn, what to do — answer/reformat from context, search the corpus (possibly multiple times), or web-search with human approval — while honoring an explicit **token-spend vs answer-quality** budget.

## 2. Goals / non-goals

**Goals**
- Conversation-aware turns: follow-ups answered in context; multi-hop supported; references resolved.
- **Token-aware by construction**: a turn costs ≈ one grounded `generate` + 1–2 light controller calls, not a naïve ReAct 3–5× blowup.
- Reuse existing primitives (Milvus hybrid + graph local-search, cross-encoder rerank, SearXNG, crawl + fast index, the HITL `interrupt()` + `/ask/resume`, the frontend approval card, runs audit, eval auto-approver). **Do not rewrite the data plane.**
- Flag-gated and eval-A/B-able against today's graph.

**Non-goals (YAGNI / explicitly deferred)**
- Long-term / cross-session memory (user modeling, persistent profiles). Short-term (within-thread) only.
- A summarization buffer. If threads get long, the scaling path is **retrieval over the already-persisted checkpoints** (transcript-search), not lossy summaries — see `wiki: Conversational Session Memory`.
- Open-ended tool sprawl. Fixed, small tool set.
- The paused-turn "stale duplicate answer" reconstruction artifact — real, but a **separate** fix (it affects any HITL pause, agent or CRAG).
- Web-fallback chunk cap (`crag_web_max_chunks`) — separate open item.

## 3. Architecture

A custom LangGraph **agent ↔ tools** loop (not the prebuilt `create_react_agent` — we need a compact-observation contract, a separate full-passage finalize, a step cap, and graph-aware tools that read/write state). Driver model: `kimi-k2.6` (a strong tool-calling model — chosen deliberately to make ReAct reliable).

```
START → prepare → agent ──tool_calls──► tools → agent   (loop, ≤ react_max_steps)
                    │
                    └──answer / step-cap──► finalize → record_turn → END
```

- **`prepare`** — per-turn reset: clears the working scratchpad + `retrieved_pool` + `steps`, seeds the agent context from the **compact conversation history** (rolling window) + the new user message.
- **`agent`** — the controller LLM (native tool-calling). Emits either tool calls or a decision to answer. Prompt order is **stable-first** (system + tool defs), **volatile-last** (compact history + current scratchpad) for prefix-cache stability.
- **`tools`** — executes the requested tool(s); appends **compact** observations to the scratchpad; stashes full artifacts in state.
- **`finalize`** — the single grounded, cited `generate` over the **full** passages the agent retrieved this turn.
- **`record_turn`** — appends `(question, answer)` to the windowed history.

### Tools (wrap existing primitives)

| Tool | Wraps | Returns to controller (compact) | Stashes in state |
|------|-------|----------------------------------|------------------|
| `search_corpus(query)` | `retrieve_local` + `do_rerank` | `{id, title, score, snippet≤200}` × top-k **+ top-1 normalized rerank score** (the grader signal) | full `RetrievedChunk`s → `retrieved_pool` (by id) |
| `web_search(query)` | `ingestion.search` (SearXNG) | candidate `{title, url, snippet}` | candidate_urls |
| `crawl_and_index(urls)` | **`interrupt()` (HITL)** → `crawl_url` + `index_document(with_context=False, with_graph=False)` | on resume: `"indexed N chunks"` or `"declined"` | new chunks become searchable for a follow-up `search_corpus` |
| *(finalize)* | `generate` (`_format_context`) | — | the grounded cited answer |

The **grader becomes a signal, not a gate**: `search_corpus` hands the agent the top-1 score so it can cheaply judge "answer now vs search again vs web-search" without an extra reasoning hop.

## 4. Token-aware grounding (the cost/quality compromise)

This is the core discipline that makes ReAct affordable here:

1. **Controller reasons over compact observations** (titles + snippets + ids + score). Full passages never ride in the controller's loop context.
2. **Full passages enter the model exactly once**, at `finalize`, grounding the answer in the **deduped union of `retrieved_pool`** (all this-turn searches), re-capped to `rerank_top_k` by score. Multi-hop answers thus ground in all relevant chunks while the loop stays cheap.
3. **Step cap** `react_max_steps` (default 4) → forced `finalize`. Bounds worst-case cost; prevents loops.
4. **History window** (`react_history_turns`, default 3) fed compactly. Makes reformat turns 1-call (agent finalizes immediately, no tool) and multi-hop natural.
5. **Prefix-cache ordering**: stable system + tool defs first; volatile history + scratchpad last.

Expected cost: simple follow-up ≈ 1 call; single-shot retrieval ≈ 1 controller + 1 finalize; multi-hop/web ≈ 2–3 controller + 1 finalize. Roughly **1×–2×** today's graph, not 5×.

## 5. State schema

Extend `RAGState` (or a dedicated `AgentState` selected at build time):

- `history: Annotated[list[HistoryTurn], window_reducer]` — cross-turn memory; `HistoryTurn` is a `TypedDict {question, answer}` (plain dict → **no serde change**); reducer appends and trims to last N.
- `scratch: Annotated[list[AnyMessage], add_messages]` — the **current-turn** ReAct working messages (tool calls + observations); reset by `prepare`. (`BaseMessage` types are already in the checkpoint serde safe allowlist.)
- `retrieved_pool: dict[str, RetrievedChunk]` — full chunks retrieved this turn (reducer merges; `RetrievedChunk` already registered in `checkpoint_serde`).
- `steps: int`, plus existing `question / answer / citations / retrieved / used / fallback_used` and the grade-signal fields.

`prepare` resets `scratch`, `retrieved_pool`, `steps` each turn so context stays bounded; `history` persists across turns via the checkpointer.

## 6. HITL (preserved, reused)

`crawl_and_index` calls `interrupt()` with the existing approval payload shape (`reason="approve_urls"`, `candidate_urls`, grade signal). The current **`/ask/resume(+stream)`** flow and the **frontend approval card** resume it unchanged — approve → crawl + fast index → tool observation; decline → tool observation "declined", agent answers from what it has. No new HITL machinery.

## 7. Reuse vs change

- **Kept intact:** checkpointer/threads, HITL `interrupt()` + `/ask/resume`, the frontend approval card, SSE streaming (tool start/end → `node` events; `crawl_progress` retained), the `runs` audit table (record steps, grade signal, fallback_used, decision), the eval auto-approver.
- **Changed:** the `rag_qa` topology — behind `enable_react_agent`, build the agent graph; off → today's CRAG/linear graph. The retrieval/rerank/grade/web/crawl/generate **node bodies are reused as tool implementations / finalize**.
- **Subsumed:** the planned single-turn `route_turn` classifier — the agent does intent-routing implicitly. We do **not** build a separate router.

## 8. Config / flags

- `enable_react_agent: bool = False` — build-time structural flag (process restart to change), like `enable_corrective_rag`. Composes with the eval harness for A/B.
- `react_max_steps: int = 4`, `react_history_turns: int = 3`.
- Reuses `rerank_top_k`, `crag_*` (incl. `crag_fast_web_index`), `web_fallback_max_urls`, model tiers.

## 9. Eval

The harness A/Bs **react-agent vs CRAG-graph vs linear** via the flags. The HITL `crawl_and_index` tool resolves through the **programmatic auto-approver** ("same graph / different approver"). Golden cases added: a reformat follow-up (must answer, zero tool calls), a multi-hop question (≥2 `search_corpus`), and a web-fallback case (auto-approved). Metrics: answer quality + **token/step counts per turn** (cost is a first-class eval output).

## 10. Testing

Offline, mocked LLM/tools:
- each tool returns the compact shape **and** stashes full artifacts;
- `finalize` grounds in the deduped `retrieved_pool` (multi-hop union);
- agent loop honors `react_max_steps` (forced finalize);
- reformat turn → zero tool calls, answers from history/prior answer;
- history window reducer trims to N; `prepare` resets per-turn state;
- HITL: `crawl_and_index` interrupts, resume (approve/decline) continues;
- **graceful degradation**: malformed/failed tool call → treated as finalize, never crashes the turn (the grader prod-lesson, applied to tool-call parsing);
- topology builds for `enable_react_agent` × `enable_corrective_rag` combinations.

## 11. Scope (multi-plan, ~CRAG-sized)

- **P1** — state schema + tools (`search_corpus`, `web_search`, `crawl_and_index`) reusing existing primitives; compact/stash contract.
- **P2** — agent loop (`prepare`/`agent`/`tools`/`finalize`/`record_turn`), step cap, history memory, degrade-on-bad-toolcall.
- **P3** — API/SSE mapping (tool steps → events), `runs` fields (steps, signal, decision), resume parity.
- **P4** — eval A/B + golden cases + token/step metrics.
- **P5** — frontend: adapt the agentic pipeline strip to render **dynamic** tool steps (search #1, search #2, web, answer).

## 12. Risks & mitigations

- **Tool-call reliability** → strong tool-calling driver (`kimi-k2.6`) + tight tool schemas + step cap + degrade-to-finalize.
- **Token variance** → compact observations + finalize-once + step cap; cost surfaced in eval.
- **Under-/over-searching** → grade signal nudges the agent; step cap bounds over-searching.
- **Harder eval decomposition** → keep flags for A/B + measure end-to-end (quality + cost).
- **Untrusted inputs** → conversation history and crawled web text both feed prompts; treat as an injection surface (defensive prompting; no tool auto-exec beyond the fixed set).

## 13. Out of scope / future

- Paused-turn reconstruction fix (separate, still needed).
- Web-fallback chunk cap (`crag_web_max_chunks`).
- Long-term/cross-session memory; transcript-search as the history scaling path (not summarization).
- Grade-threshold calibration sweep.
