# Retrieval Inspector — provenance & rerank visibility

- **Date:** 2026-06-20
- **Status:** Approved design (pre-implementation)
- **Branch context:** builds on `feat/agent-native-chat` (CRAG / web-fallback already landed)
- **Owner:** Muhriddin

## 1. Problem

The hybrid pipeline's retrieval is a black box in the UI. The per-turn inspector
Sheet (`turn-inspector-sheet.tsx`) already shows pipeline timings, the question,
the answer, overrides, and the final citations — but it never shows **how those
citations were chosen**: which retriever produced each chunk, how the cross-encoder
reordered the candidate pool, or what got dropped.

Two concrete symptoms in the current code:

1. **Provenance is faked.** `frontend/src/lib/citation-kind.ts::pickKind()` guesses a
   citation's kind purely from `source_uri` (`http(s)` → `"web"`, else `"hybrid"`).
   The `graph` and `vector` icons defined in `citation-chip.tsx::KIND_META` are
   therefore **never** shown — the backend never tells the frontend which retriever
   found a chunk.
2. **Provenance is computed, then discarded — twice.**
   - `graphs/rag_qa/nodes.py::_retrieve_deduped` merges per-retriever hits (each
     `RetrievedChunk` carries `.source`) and `_dedup_by_chunk` collapses them by
     **score-max**, keeping only the winning leg per chunk and discarding each
     chunk's rank within its leg.
   - `graphs/rag_qa/nodes.py::do_rerank` calls `rerank()`, which overwrites
     `source="reranked"` and returns only `top_k` — so the origin leg and the full
     before→after reordering are lost.

## 2. Goal

Make retrieval provenance **real and visible**, as a post-hoc deep-dive in the
existing inspector Sheet, plus correct citation-kind icons everywhere.

Deliver, for any live turn:

- The three retriever **legs** — dense, BM25, graph — each as a ranked list with
  per-leg scores.
- The **rerank reordering** — the full cross-encoder ranking of the candidate pool,
  each chunk's movement vs. its best leg rank, the top-k cutoff, and which chunks
  were actually cited.
- A per-chunk **origin** tag (`local` vs. `web`).
- **Backend-driven citation kinds** so `graph` / `vector` / `web` icons light up on
  citation chips (works for history turns too).

## 3. Decisions (from brainstorming)

| Axis | Decision |
|---|---|
| Depth | **Deep** — split the Milvus leg into separate dense + BM25 ranked lists (plus graph). Web is a document origin, not a retriever leg. |
| Surface | **Post-hoc inspector Sheet** — a new "Retrieval" section. Not a live animated overlay. |
| Backend approach | **Additive trace** — the answer/fusion path is unchanged; provenance is captured alongside it, gated, and streamed once on `done`. |
| Default | `enable_retrieval_trace` defaults **on** (env/Settings-toggleable). |
| History replay | **Follow-up** — the deep trace ships on live `done` only. Citation *kinds* do work on history turns (backend-driven). |

### Why additive (not a fusion refactor)

An inspector is an observability feature. The "unify fusion in Python" alternative
(which would also fix the dormant `weighted`/`borda` strategies and make graph a true
ranking leg) changes answer behavior for everyone and **requires eval validation we
cannot currently trust** — the eval golden set is English asyncio docs judged by
substring match, not the Russian banking corpus. So we surface the truth now and
keep fusion-correctness changes as a separate, eval-gated feature.

## 4. Non-goals

- No change to the answer or fusion behavior (byte-identical when the flag is off).
- No live/animated streaming of candidates (post-hoc only).
- No retroactive deep trace for turns reloaded from thread history (v1). Persisting
  the trace in checkpoints + replaying it is an explicit follow-up.
- No new fusion strategies; no dense-vs-BM25 fusion changes.

## 5. Data model

New module `src/sovereign_rag/retrieval/trace.py`:

```python
@dataclass(slots=True)
class LegHit:
    chunk_id: str
    rank: int            # 1-based rank within this leg
    score: float         # leg-native score (cosine / BM25 / graph)

@dataclass(slots=True)
class TraceChunk:
    chunk_id: str
    title: str
    snippet: str
    origin: str              # "local" | "web"
    dense_rank: int | None
    bm25_rank: int | None
    graph_rank: int | None
    rerank_rank: int | None  # position in the FULL reranked order (1-based)
    rerank_score: float | None
    in_top_k: bool
    cited: bool

@dataclass(slots=True)
class RetrievalTrace:
    legs: dict[str, list[LegHit]]   # {"dense": [...], "bm25": [...], "graph": [...]}
    chunks: list[TraceChunk]        # union across legs, one per chunk_id
    pool_size: int                  # candidates after dedup (== RAGState.retrieved)
    top_k: int

def build_trace(
    *,
    legs: dict[str, list[LegHit]],
    rerank_ranking: list[tuple[str, float]],   # (chunk_id, rerank_score), full sorted desc
    top_k: int,
    pool_meta: dict[str, dict],                # chunk_id -> {title, snippet, origin}
    cited_chunk_ids: set[str],
) -> RetrievalTrace
```

`build_trace` is **pure** (no I/O), so it is unit-testable without services. It joins
the leg ranks + rerank ranking + cited set into `TraceChunk`s.

The trace is serialized to the SSE `done` event as `done.retrieval`:

```ts
RetrievalTrace = {
  legs: { dense: LegHit[]; bm25: LegHit[]; graph: LegHit[] }   // LegHit = {chunk_id, rank, score}
  chunks: TraceChunk[]
  poolSize: number
  topK: number
}
```

## 6. Backend changes

### 6.1 `config.py`
Add `enable_retrieval_trace: bool = True`. When `False`, none of the capture below
runs and the path is byte-identical to today. (Env-toggleable, A/B-able, surfaced in
Settings like the other retrieval knobs.)

### 6.2 `documents.py` — preserve origin through rerank
`RetrievedChunk` gains `origin_source: str = ""`. The Milvus/graph hit constructors
set it (= the original `source`). `rerank()` copies `origin_source` from each input
chunk to its output (instead of losing it when `source` becomes `"reranked"`). This
is what powers backend-driven citation kinds.

### 6.3 `vectorstore/milvus_store.py`
No new methods needed — `dense_search` (→ `milvus_dense`) and `bm25_search`
(→ `milvus_bm25`) already exist alongside `hybrid_search`. Confirm each sets
`origin_source` on its returned chunks.

### 6.4 `graphs/rag_qa/nodes.py::retrieve_local`
When `enable_retrieval_trace`:
- Run `milvus.dense_search(q)` + `milvus.bm25_search(q)` **concurrently** alongside
  the existing `hybrid_search` + `local_search` that build the real pool (unchanged).
- Build `trace_legs = {"dense": [...], "bm25": [...], "graph": [...]}` from the order
  of each leg's returned hits (order == rank). Graph leg ranks come from the
  `local_search` output the node already has.
- Return `{"candidates": <unchanged>, "trace_legs": trace_legs, "trace_pool_meta": {...}}`.

When the flag is off, behavior is exactly as today.

### 6.5 `providers/reranker.py`
Extract `rerank_scores(query, candidates) -> list[tuple[RetrievedChunk, float]]` that
returns **all** candidates scored and sorted desc. `rerank()` is re-expressed on top
of it (apply score-floor + adaptive truncation + `top_k`), preserving its current
contract. **No extra model compute** — the reranker already scores every pair today;
we just stop discarding the tail.

### 6.6 `graphs/rag_qa/nodes.py::do_rerank`
When tracing, also store the full ranking: `trace_rerank = [(chunk_id, score), ...]`
(from `rerank_scores`). `reranked` (the `top_k` returned to `generate`) is unchanged.

### 6.7 `retrieval/pipeline.py::Citation` + `_format_context`
`Citation` gains `kind: str` (`"hybrid" | "graph" | "vector" | "web"`).
`_format_context` derives it per reranked chunk:
- `source_uri` is `http(s)` → `"web"`
- else `origin_source == "graph"` → `"graph"`
- else `origin_source == "milvus_dense"` → `"vector"`
- else (`milvus_hybrid` / `milvus_bm25` / unknown) → `"hybrid"`

This persists in checkpoints, so citation kinds are correct on history turns too.
Note: on the unchanged answer path, candidates come from `hybrid_search` + graph, so
citations resolve to `hybrid` / `graph` / `web` in practice — the dense-vs-BM25 split
(`vector`) is surfaced only in the trace **legs** (the inspector table), not on chips.

### 6.8 `graphs/rag_qa/state.py`
Add `trace_legs`, `trace_rerank`, `trace_pool_meta` to `RAGState` (all `total=False`,
so existing checkpoints still load).

### 6.9 `api/ask/router.py`
In the `done` builder, when `trace_legs`/`trace_rerank` are present in `final_state`,
call `build_trace(...)` (cited set = chunk_ids in the final citations) and attach the
serialized result as `done["retrieval"]`. **Best-effort:** wrap in try/except — any
failure logs and simply omits `retrieval`; the answer and stream are never affected.

## 7. Frontend changes

### 7.1 Types — `lib/api.ts`
Add `RetrievalTrace`, `LegHit`, `TraceChunk` types. `CitationModel` gains
`kind?: CitationKind`.

### 7.2 `hooks/use-ask-stream.ts`
`onDone` reads `final.retrieval` and threads it through; add `retrieval?: RetrievalTrace`
to the `Turn` model (in `Ask.tsx`).

### 7.3 `pages/Ask.tsx`
Pass `retrieval` into `InspectableTurn` for the Sheet.

### 7.4 `components/ask/turn-inspector-sheet.tsx` — new "Retrieval" section
Placed between the Pipeline and Question sections. Renders only when
`turn.retrieval` is present (hidden otherwise).

- **Header chips:** per-leg counts, e.g. `dense 50 · bm25 50 · graph 12`, plus
  `pool 57 → top 5`.
- **Table** (rows sorted by `rerank_rank`):
  `# (rerank) · title/snippet · origin · Dense · BM25 · Graph · rerank score · cited`
  - Each leg cell shows that chunk's rank in the leg (or `—`).
  - A ↑/↓ delta badge vs. the chunk's best leg rank shows reranker movement.
  - A divider row marks the `top_k` cutoff; cited rows get a badge.
  - Origin shows a `web`/`local` chip.
- Uses existing design tokens; no new UI primitives.

### 7.5 `lib/citation-kind.ts` + chips
`pickKind(c)` returns `c.kind` when present; falls back to the current `source_uri`
heuristic for trace-less history turns. `citation-chip.tsx` / `sources-disclosure.tsx`
already render via `pickKind`, so the `graph`/`vector` icons now light up with no
structural change.

### 7.6 i18n — `locales/{en,ru}.json`
New keys under `pages.ask.inspector.retrieval.*` (section title, leg labels, column
headers, `cited`, `topKCutoff`, origin labels). RU gets correct CLDR plurals for any
count strings.

## 8. Error handling, performance, safety

- **Cost:** +2 concurrent ANN queries per run when enabled (ms-scale vs. rerank+LLM).
  Rerank capture is free. One Settings switch disables all of it.
- **Degradation:** a failed shadow leg → that leg renders `—`; a failed trace assembly
  → `retrieval` omitted, section hidden. The answer path never sees trace failures.
- **State safety:** `trace_*` fields are written by single nodes (no reducer conflicts);
  `total=False` keeps old checkpoints loadable.

## 9. Testing

- **Unit (`tests/test_retrieval_trace.py`):**
  - `build_trace` — correct per-leg ranks, rerank ranks, movement, `in_top_k`,
    `cited` from a fixture of leg lists + rerank ranking + cited set.
  - `rerank_scores` returns the full set sorted desc; `rerank()` contract unchanged.
  - kind mapping (`origin_source` + `source_uri` → `CitationKind`).
- **Integration (gated, existing pattern):** `/ask` with the flag on → `done.retrieval`
  carries `legs` with per-chunk dense/bm25/graph ranks and a `chunks` union.
- **Frontend (vitest):** Retrieval section renders from a trace fixture (cutoff divider,
  cited badge, leg ranks); `pickKind` returns backend `kind` and falls back correctly.

## 10. File touch-list

**Backend:** `config.py`, `documents.py`, `providers/reranker.py`,
`retrieval/pipeline.py`, `retrieval/trace.py` (new), `graphs/rag_qa/state.py`,
`graphs/rag_qa/nodes.py`, `api/ask/router.py`.
**Frontend:** `lib/api.ts`, `hooks/use-ask-stream.ts`, `pages/Ask.tsx`,
`components/ask/turn-inspector-sheet.tsx`, `lib/citation-kind.ts`,
`locales/en.json`, `locales/ru.json`.
**Tests:** `tests/test_retrieval_trace.py` (new), one gated integration test, frontend
vitest for the Retrieval section + `pickKind`.

## 11. Future work

- **Persist + replay the trace** for history turns (store on the checkpoint or the
  `runs` table; surface in `read_thread_messages`).
- **Honest fusion** (the deferred alternative): unify dense+BM25+graph fusion in
  Python, making `weighted`/`borda` real and graph a true ranking leg — gated behind
  an eval A/B once a trustworthy (Russian) golden set exists.
- Optional **live** animation of the legs/rerank, reusing the same trace data.
