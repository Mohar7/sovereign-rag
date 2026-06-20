# Retrieval Inspector — Provenance & Rerank Visibility — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface real retrieval provenance (dense/BM25/graph leg ranks + full rerank reordering + origin tags) in the post-hoc inspector Sheet, and fix backend-driven citation kinds — without changing the answer/fusion path.

**Architecture:** An additive, gated `RetrievalTrace` is captured alongside the unchanged answer path: `retrieve_local` runs shadow dense+BM25 passes for leg ranks, `do_rerank` keeps the full rerank ranking (already computed), and `RetrievedChunk.origin_source` is preserved through rerank to drive `Citation.kind`. The trace is assembled in the `done` SSE builder and rendered as a new "Retrieval" section in the existing inspector Sheet.

**Tech Stack:** Python 3.12 (FastAPI, LangGraph, pymilvus, sentence-transformers), React 19 + TypeScript (TanStack, i18next, vitest), `uv`, `ruff`, `mypy --strict`, `pytest`.

## Global Constraints

- Python 3.12; deps via `uv`; lint `ruff check` + `ruff format --check`; types `mypy src/` (strict); tests `pytest`.
- Integration tests are marked `@pytest.mark.integration` and gated by `RUN_*_IT=1`; unit tests must pass with no services up.
- Data plane uses **raw** `pymilvus` / `neo4j-graphrag` — do **not** introduce LangChain retriever wrappers.
- LangGraph state is a `TypedDict` with `total=False`; new fields must be optional so old checkpoints still load.
- **Commit as the user; NO `Co-Authored-By: Claude` footer** (project convention).
- Frontend gates: `npm run build` (runs `tsc -b && vite build`) + `vitest` green. i18n changes require **both** `en.json` and `ru.json`; RU plural strings use CLDR `one/few/many/other`.
- Default behavior when `enable_retrieval_trace=False` must be byte-identical to today.
- Verification gate for every backend task: `uv run ruff check src/ tests/ && uv run mypy src/ && uv run pytest -m "not integration" -q` green.

---

## File Structure

**Backend**
- `src/sovereign_rag/config.py` — add `enable_retrieval_trace` flag.
- `src/sovereign_rag/api/settings/schemas.py` — expose the flag in `SettingsResponse` + `SettingsPatch`.
- `src/sovereign_rag/api/settings/router.py` — include the flag in `_snapshot()`.
- `src/sovereign_rag/documents.py` — `RetrievedChunk.origin_source`.
- `src/sovereign_rag/vectorstore/milvus_store.py` — set `origin_source` in `hit_to_retrieved_chunk`.
- `src/sovereign_rag/graph/neo4j_store.py` — set `origin_source` on graph hits.
- `src/sovereign_rag/providers/reranker.py` — `rerank_scores()` + `select_top_k()`; preserve `origin_source`.
- `src/sovereign_rag/retrieval/trace.py` — **new**: `LegHit`, `TraceChunk`, `RetrievalTrace`, `build_trace`, `trace_to_dict`.
- `src/sovereign_rag/retrieval/pipeline.py` — `Citation.kind` + `citation_kind()` + `_format_context`.
- `src/sovereign_rag/graphs/rag_qa/state.py` — `trace_legs`, `trace_rerank`, `trace_pool_meta`.
- `src/sovereign_rag/graphs/rag_qa/nodes.py` — `retrieve_local` shadow legs; `do_rerank` full-ranking capture.
- `src/sovereign_rag/api/ask/router.py` — `assemble_retrieval_payload()` + attach to `done`.

**Frontend**
- `frontend/src/lib/api.ts` — `RetrievalTrace`/`LegHit`/`TraceChunk` types; `CitationModel.kind?`.
- `frontend/src/hooks/use-ask-stream.ts` — `retrieval?` on the `done` event.
- `frontend/src/pages/Ask.tsx` — `Turn.retrieval`; set on `onDone`; pass into `InspectableTurn`.
- `frontend/src/lib/citation-kind.ts` — `pickKind` reads `c.kind` first.
- `frontend/src/components/ask/retrieval-section.tsx` — **new**: the Retrieval table.
- `frontend/src/components/ask/turn-inspector-sheet.tsx` — mount `RetrievalSection`.
- `frontend/src/locales/en.json`, `frontend/src/locales/ru.json` — i18n keys.

**Tests**
- `tests/test_retrieval_trace.py` — **new**: `build_trace`, `citation_kind`, `rerank_scores`/`select_top_k`, `assemble_retrieval_payload`, config flag.
- `tests/test_rag_qa.py` — extend: `retrieve_local`/`do_rerank` trace capture.
- `frontend/src/lib/citation-kind.test.ts` — **new**: `pickKind`.
- `frontend/src/components/ask/retrieval-section.test.tsx` — **new**: section rendering.

---

## Phase 1 — Backend

### Task 1: Config flag `enable_retrieval_trace`

**Files:**
- Modify: `src/sovereign_rag/config.py` (Retrieval knobs block, near `adaptive_rerank`)
- Modify: `src/sovereign_rag/api/settings/schemas.py` (`SettingsResponse`, `SettingsPatch`)
- Modify: `src/sovereign_rag/api/settings/router.py` (`_snapshot`)
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Produces: `Settings.enable_retrieval_trace: bool` (default `True`); patchable via `SettingsPatch.enable_retrieval_trace: bool | None`.

- [ ] **Step 1: Write the failing test**

Create `tests/test_retrieval_trace.py`:

```python
from __future__ import annotations

from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import Settings


def test_retrieval_trace_defaults_on() -> None:
    assert Settings().enable_retrieval_trace is True


def test_settings_patch_accepts_retrieval_trace() -> None:
    patch = SettingsPatch(enable_retrieval_trace=False)
    assert patch.model_dump(exclude_none=True) == {"enable_retrieval_trace": False}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py -q`
Expected: FAIL — `AttributeError`/`ValidationError` (field doesn't exist yet).

- [ ] **Step 3: Add the config field**

In `src/sovereign_rag/config.py`, immediately after the `adaptive_rerank: bool = False` line:

```python
    # Retrieval-trace capture for the inspector overlay. When on, retrieve_local
    # runs shadow dense+BM25 passes and do_rerank keeps the full rerank ranking
    # so the UI can show per-leg provenance. Purely observational — the answer
    # path is unchanged. Off → byte-identical to no-trace behavior.
    enable_retrieval_trace: bool = True
```

- [ ] **Step 4: Expose it in the settings schema**

In `src/sovereign_rag/api/settings/schemas.py`, add to `SettingsResponse` (after `adaptive_rerank: bool`):

```python
    enable_retrieval_trace: bool
```

and to `SettingsPatch` (after `adaptive_rerank: bool | None = None`):

```python
    enable_retrieval_trace: bool | None = None
```

- [ ] **Step 5: Include it in the snapshot**

In `src/sovereign_rag/api/settings/router.py`, inside `_snapshot()`'s `SettingsResponse(...)` call, add after `adaptive_rerank=s.adaptive_rerank,`:

```python
        enable_retrieval_trace=s.enable_retrieval_trace,
```

- [ ] **Step 6: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py -q && uv run ruff check src/ tests/ && uv run mypy src/`
Expected: PASS, clean.

- [ ] **Step 7: Commit**

```bash
git add src/sovereign_rag/config.py src/sovereign_rag/api/settings/schemas.py src/sovereign_rag/api/settings/router.py tests/test_retrieval_trace.py
git commit -m "feat(config): add enable_retrieval_trace flag (default on)"
```

---

### Task 2: `RetrievedChunk.origin_source` + store tagging

**Files:**
- Modify: `src/sovereign_rag/documents.py:65-77` (`RetrievedChunk`)
- Modify: `src/sovereign_rag/vectorstore/milvus_store.py:122-131` (`hit_to_retrieved_chunk`)
- Modify: `src/sovereign_rag/graph/neo4j_store.py:204` (graph hit)
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Produces: `RetrievedChunk.origin_source: str` (default `""`). Milvus hits set it to the leg source (`milvus_dense`/`milvus_bm25`/`milvus_hybrid`); graph hits set `"graph"`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_retrieval_trace.py`:

```python
from sovereign_rag.documents import Chunk, RetrievedChunk


def _rc(chunk_id: str, *, source: str, origin: str = "") -> RetrievedChunk:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", chunk_id=chunk_id)
    return RetrievedChunk(chunk=chunk, score=1.0, source=source, origin_source=origin)


def test_retrieved_chunk_origin_source_defaults_empty() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", chunk_id="c1")
    assert RetrievedChunk(chunk=chunk, score=1.0, source="graph").origin_source == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py::test_retrieved_chunk_origin_source_defaults_empty -q`
Expected: FAIL — `TypeError: __init__() got an unexpected keyword argument 'origin_source'`.

- [ ] **Step 3: Add the field**

In `src/sovereign_rag/documents.py`, in `RetrievedChunk`, after `source: str  # ...`:

```python
    # The original retriever leg, preserved even after rerank rewrites `source`
    # to "reranked". Drives Citation.kind and the inspector's provenance trace.
    origin_source: str = ""
```

- [ ] **Step 4: Tag Milvus + graph hits**

In `src/sovereign_rag/vectorstore/milvus_store.py`, change the return of `hit_to_retrieved_chunk` (line ~131):

```python
    return RetrievedChunk(chunk=chunk, score=score, source=source, origin_source=source)
```

In `src/sovereign_rag/graph/neo4j_store.py` (line ~204):

```python
    return RetrievedChunk(
        chunk=chunk, score=float(row["score"]), source="graph", origin_source="graph"
    )
```

- [ ] **Step 5: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py -q && uv run mypy src/`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/sovereign_rag/documents.py src/sovereign_rag/vectorstore/milvus_store.py src/sovereign_rag/graph/neo4j_store.py tests/test_retrieval_trace.py
git commit -m "feat(retrieval): preserve origin_source on RetrievedChunk"
```

---

### Task 3: `rerank_scores()` + `select_top_k()` (full ranking, origin preserved)

**Files:**
- Modify: `src/sovereign_rag/providers/reranker.py`
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Produces:
  - `rerank_scores(query: str, candidates: list[RetrievedChunk]) -> list[tuple[RetrievedChunk, float]]` — every candidate scored, sorted desc, no truncation.
  - `select_top_k(scored: list[tuple[RetrievedChunk, float]], *, settings: Settings, top_k: int) -> list[RetrievedChunk]` — applies score-floor + adaptive truncation + top_k; output chunks carry `source="reranked"` and the input's `origin_source`.
  - `rerank(...)` unchanged public contract, now built on the two helpers.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_retrieval_trace.py`:

```python
import sovereign_rag.providers.reranker as reranker_mod
from sovereign_rag.config import Settings


class _StubRanker:
    """Scores each (query, text) pair by the text's trailing integer."""

    def predict(self, pairs, show_progress_bar=False):  # noqa: ANN001
        return [float(text.rsplit("#", 1)[1]) for _q, text in pairs]


def _stub_candidates() -> list[RetrievedChunk]:
    out = []
    for i, src in [(3, "graph"), (9, "milvus_dense"), (1, "milvus_bm25")]:
        c = Chunk(doc_id="d", text=f"t#{i}", raw_text=f"t#{i}", chunk_id=f"c{i}")
        out.append(RetrievedChunk(chunk=c, score=0.0, source=src, origin_source=src))
    return out


def test_rerank_scores_returns_full_sorted(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(reranker_mod, "_ranker", lambda: _StubRanker())
    scored = reranker_mod.rerank_scores("q", _stub_candidates())
    assert [c.chunk.chunk_id for c, _ in scored] == ["c9", "c3", "c1"]
    assert [round(s) for _, s in scored] == [9, 3, 1]


def test_select_top_k_preserves_origin(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(reranker_mod, "_ranker", lambda: _StubRanker())
    s = Settings(rerank_score_floor=0.0, adaptive_rerank=False)
    scored = reranker_mod.rerank_scores("q", _stub_candidates())
    top = reranker_mod.select_top_k(scored, settings=s, top_k=2)
    assert [c.chunk.chunk_id for c in top] == ["c9", "c3"]
    assert [c.origin_source for c in top] == ["milvus_dense", "graph"]
    assert all(c.source == "reranked" for c in top)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py -k "rerank_scores or select_top_k" -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'rerank_scores'`.

- [ ] **Step 3: Refactor the reranker**

In `src/sovereign_rag/providers/reranker.py`, replace the body of `rerank` with the three functions below (keep imports, `_pick_device`, `_ranker`):

```python
def rerank_scores(
    query: str, candidates: list[RetrievedChunk]
) -> list[tuple[RetrievedChunk, float]]:
    """Cross-encode every candidate; return (chunk, score) sorted desc.

    The FULL ranking — no score-floor, no truncation. The inspector trace uses
    this to show how the reranker reordered the whole pool.
    """
    if not candidates:
        return []
    pairs: list[tuple[str, str]] = [(query, c.chunk.text) for c in candidates]
    scores = _ranker().predict(pairs, show_progress_bar=False)  # type: ignore[arg-type]
    return sorted(
        zip(candidates, scores, strict=True), key=lambda p: float(p[1]), reverse=True
    )


def select_top_k(
    scored: list[tuple[RetrievedChunk, float]], *, settings: Settings, top_k: int
) -> list[RetrievedChunk]:
    """Apply score-floor + adaptive truncation + top_k to a scored ranking.

    Output chunks carry ``source="reranked"`` and the input's ``origin_source``
    so downstream can still tell which retriever leg first found each chunk.
    """
    paired = scored
    if settings.rerank_score_floor > 0:
        paired = [(c, sc) for c, sc in paired if float(sc) >= settings.rerank_score_floor]
    if settings.adaptive_rerank and paired:
        total = sum(max(0.0, float(sc)) for _, sc in paired[:top_k]) or 1.0
        running = 0.0
        kept: list[tuple[RetrievedChunk, float]] = []
        for c, sc in paired[:top_k]:
            kept.append((c, sc))
            running += max(0.0, float(sc))
            if running / total >= 0.85:
                break
        paired = kept
    else:
        paired = paired[:top_k]
    return [
        RetrievedChunk(
            chunk=original.chunk,
            score=float(score),
            source="reranked",
            origin_source=original.origin_source,
        )
        for original, score in paired
    ]


def rerank(
    query: str, candidates: list[RetrievedChunk], top_k: int | None = None
) -> list[RetrievedChunk]:
    """Rerank ``candidates`` against ``query``; return the top_k by score."""
    if not candidates:
        return []
    s = get_settings()
    top_k = top_k or s.rerank_top_k
    return select_top_k(rerank_scores(query, candidates), settings=s, top_k=top_k)
```

Add `Settings` to the imports (`from sovereign_rag.config import Settings, get_settings`) and extend `__all__`:

```python
__all__ = ["rerank", "rerank_scores", "select_top_k"]
```

- [ ] **Step 4: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py tests/test_reranker.py -q && uv run mypy src/`
Expected: PASS (existing `test_reranker.py` still green — contract unchanged).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/providers/reranker.py tests/test_retrieval_trace.py
git commit -m "refactor(reranker): expose rerank_scores + select_top_k, preserve origin"
```

---

### Task 4: `retrieval/trace.py` — data model + `build_trace`

**Files:**
- Create: `src/sovereign_rag/retrieval/trace.py`
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Produces: `LegHit`, `TraceChunk`, `RetrievalTrace` dataclasses; `build_trace(*, legs, rerank_ranking, top_k, pool_meta, cited_chunk_ids) -> RetrievalTrace`; `trace_to_dict(trace) -> dict[str, Any]` (camelCase wire shape).
- Consumes: nothing (pure).

- [ ] **Step 1: Write the failing test**

Append to `tests/test_retrieval_trace.py`:

```python
from sovereign_rag.retrieval.trace import LegHit, build_trace, trace_to_dict


def test_build_trace_joins_legs_rerank_and_cited() -> None:
    legs = {
        "dense": [LegHit("c9", 1, 0.9), LegHit("c3", 2, 0.4)],
        "bm25": [LegHit("c1", 1, 5.0), LegHit("c9", 2, 3.0)],
        "graph": [LegHit("c3", 1, 0.7)],
    }
    rerank_ranking = [("c9", 8.0), ("c3", 2.0), ("c1", 1.0)]
    pool_meta = {
        "c9": {"title": "Nine", "snippet": "nine", "origin": "local"},
        "c3": {"title": "Three", "snippet": "three", "origin": "web"},
        "c1": {"title": "One", "snippet": "one", "origin": "local"},
    }
    trace = build_trace(
        legs=legs,
        rerank_ranking=rerank_ranking,
        top_k=2,
        pool_meta=pool_meta,
        cited_chunk_ids={"c9"},
    )
    by_id = {c.chunk_id: c for c in trace.chunks}
    assert by_id["c9"].dense_rank == 1 and by_id["c9"].bm25_rank == 2
    assert by_id["c9"].graph_rank is None
    assert by_id["c9"].rerank_rank == 1 and by_id["c9"].in_top_k is True and by_id["c9"].cited is True
    assert by_id["c3"].graph_rank == 1 and by_id["c3"].rerank_rank == 2 and by_id["c3"].in_top_k is True
    assert by_id["c1"].in_top_k is False and by_id["c1"].cited is False
    assert trace.pool_size == 3 and trace.top_k == 2


def test_trace_to_dict_is_camel_case() -> None:
    trace = build_trace(
        legs={"dense": [LegHit("c1", 1, 0.5)], "bm25": [], "graph": []},
        rerank_ranking=[("c1", 2.0)],
        top_k=1,
        pool_meta={"c1": {"title": "T", "snippet": "s", "origin": "local"}},
        cited_chunk_ids=set(),
    )
    d = trace_to_dict(trace)
    assert d["poolSize"] == 1 and d["topK"] == 1
    assert d["legs"]["dense"][0] == {"chunkId": "c1", "rank": 1, "score": 0.5}
    assert d["chunks"][0]["denseRank"] == 1 and d["chunks"][0]["rerankRank"] == 1
    assert d["chunks"][0]["inTopK"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py -k "build_trace or trace_to_dict" -q`
Expected: FAIL — `ModuleNotFoundError: sovereign_rag.retrieval.trace`.

- [ ] **Step 3: Create the module**

Create `src/sovereign_rag/retrieval/trace.py`:

```python
"""Retrieval provenance trace — the data the inspector overlay renders.

Pure (no I/O): assembled from per-leg ranked lists, the full rerank ranking,
and the set of cited chunk ids. Streamed once on the /ask `done` SSE event.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_LEG_KEYS = ("dense", "bm25", "graph")


@dataclass(slots=True)
class LegHit:
    chunk_id: str
    rank: int  # 1-based within the leg
    score: float


@dataclass(slots=True)
class TraceChunk:
    chunk_id: str
    title: str
    snippet: str
    origin: str  # "local" | "web"
    dense_rank: int | None
    bm25_rank: int | None
    graph_rank: int | None
    rerank_rank: int | None
    rerank_score: float | None
    in_top_k: bool
    cited: bool


@dataclass(slots=True)
class RetrievalTrace:
    legs: dict[str, list[LegHit]]
    chunks: list[TraceChunk]
    pool_size: int
    top_k: int


def build_trace(
    *,
    legs: dict[str, list[LegHit]],
    rerank_ranking: list[tuple[str, float]],
    top_k: int,
    pool_meta: dict[str, dict[str, str]],
    cited_chunk_ids: set[str],
) -> RetrievalTrace:
    """Join per-leg ranks + the rerank ranking + cited set into one trace.

    The chunk universe is every id seen in any leg OR in the rerank ranking,
    so the table can show pool members that no single leg surfaced alone.
    """
    rank_in: dict[str, dict[str, int]] = {key: {} for key in _LEG_KEYS}
    for key in _LEG_KEYS:
        for hit in legs.get(key, []):
            rank_in[key][hit.chunk_id] = hit.rank

    rerank_rank: dict[str, int] = {}
    rerank_score: dict[str, float] = {}
    for i, (cid, score) in enumerate(rerank_ranking, start=1):
        rerank_rank[cid] = i
        rerank_score[cid] = float(score)

    ids: list[str] = []
    seen: set[str] = set()
    for cid, _ in rerank_ranking:
        if cid not in seen:
            seen.add(cid)
            ids.append(cid)
    for key in _LEG_KEYS:
        for hit in legs.get(key, []):
            if hit.chunk_id not in seen:
                seen.add(hit.chunk_id)
                ids.append(hit.chunk_id)

    chunks: list[TraceChunk] = []
    for cid in ids:
        meta = pool_meta.get(cid, {})
        rr = rerank_rank.get(cid)
        chunks.append(
            TraceChunk(
                chunk_id=cid,
                title=meta.get("title", ""),
                snippet=meta.get("snippet", ""),
                origin=meta.get("origin", "local"),
                dense_rank=rank_in["dense"].get(cid),
                bm25_rank=rank_in["bm25"].get(cid),
                graph_rank=rank_in["graph"].get(cid),
                rerank_rank=rr,
                rerank_score=rerank_score.get(cid),
                in_top_k=rr is not None and rr <= top_k,
                cited=cid in cited_chunk_ids,
            )
        )
    chunks.sort(key=lambda c: (c.rerank_rank is None, c.rerank_rank or 0))
    return RetrievalTrace(legs=legs, chunks=chunks, pool_size=len(ids), top_k=top_k)


def trace_to_dict(trace: RetrievalTrace) -> dict[str, Any]:
    """Serialize to the camelCase wire shape the frontend expects."""
    return {
        "legs": {
            key: [{"chunkId": h.chunk_id, "rank": h.rank, "score": h.score} for h in hits]
            for key, hits in trace.legs.items()
        },
        "chunks": [
            {
                "chunkId": c.chunk_id,
                "title": c.title,
                "snippet": c.snippet,
                "origin": c.origin,
                "denseRank": c.dense_rank,
                "bm25Rank": c.bm25_rank,
                "graphRank": c.graph_rank,
                "rerankRank": c.rerank_rank,
                "rerankScore": c.rerank_score,
                "inTopK": c.in_top_k,
                "cited": c.cited,
            }
            for c in trace.chunks
        ],
        "poolSize": trace.pool_size,
        "topK": trace.top_k,
    }


__all__ = ["LegHit", "RetrievalTrace", "TraceChunk", "build_trace", "trace_to_dict"]
```

- [ ] **Step 4: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py -q && uv run ruff check src/ tests/ && uv run mypy src/`
Expected: PASS, clean.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/retrieval/trace.py tests/test_retrieval_trace.py
git commit -m "feat(retrieval): RetrievalTrace data model + build_trace"
```

---

### Task 5: `Citation.kind` + `citation_kind()` derivation

**Files:**
- Modify: `src/sovereign_rag/retrieval/pipeline.py` (`Citation`, new `citation_kind`, `_format_context`)
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Produces: `Citation.kind: str` (`"hybrid" | "graph" | "vector" | "web"`, default `"hybrid"`); `citation_kind(origin_source: str, source_uri: str) -> str`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_retrieval_trace.py`:

```python
from sovereign_rag.retrieval.pipeline import citation_kind


def test_citation_kind_mapping() -> None:
    assert citation_kind("milvus_hybrid", "https://x.com/a") == "web"
    assert citation_kind("graph", "file:///x.pdf") == "graph"
    assert citation_kind("milvus_dense", "doc_1") == "vector"
    assert citation_kind("milvus_hybrid", "doc_1") == "hybrid"
    assert citation_kind("milvus_bm25", "") == "hybrid"
    assert citation_kind("", "") == "hybrid"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py::test_citation_kind_mapping -q`
Expected: FAIL — `ImportError: cannot import name 'citation_kind'`.

- [ ] **Step 3: Add the field, helper, and wire it**

In `src/sovereign_rag/retrieval/pipeline.py`, add `kind` to `Citation` (after `snippet: str`):

```python
    kind: str = "hybrid"  # "hybrid" | "graph" | "vector" | "web" — provenance for the UI
```

Add the helper near the other pure helpers (above `_dedup_by_chunk`):

```python
def citation_kind(origin_source: str, source_uri: str) -> str:
    """Map a chunk's origin leg + uri to a UI citation kind.

    A web-fallback document (http uri) is always ``web``; otherwise the kind
    reflects which retriever leg first found the chunk.
    """
    if source_uri and source_uri.lower().startswith(("http://", "https://")):
        return "web"
    if origin_source == "graph":
        return "graph"
    if origin_source == "milvus_dense":
        return "vector"
    return "hybrid"
```

In `_format_context`, set `kind` when building each `Citation` (add the argument):

```python
                kind=citation_kind(rc.origin_source, str(c.metadata.get("source_uri", ""))),
```

Extend `__all__` with `"citation_kind"`.

- [ ] **Step 4: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py tests/test_api.py -q && uv run mypy src/`
Expected: PASS (the `Citation` dataclass gains a defaulted field; `test_api.py` round-trip still green).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/retrieval/pipeline.py tests/test_retrieval_trace.py
git commit -m "feat(retrieval): Citation.kind derived from origin leg + uri"
```

---

### Task 6: `retrieve_local` shadow legs + state fields

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/state.py`
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py` (`retrieve_local`)
- Test: `tests/test_rag_qa.py`

**Interfaces:**
- Consumes: `pipe._milvus.dense_search/bm25_search/hybrid_search`, `pipe._graph.local_search`, `Settings.enable_retrieval_trace`, `LegHit`.
- Produces: state keys `trace_legs: dict[str, list[dict]]` (serialized `LegHit`s), `trace_pool_meta: dict[str, dict[str, str]]`. Unchanged: `candidates`.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py` (follow the file's existing async + monkeypatch style):

```python
import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import nodes as rag_nodes


class _FakeMilvus:
    async def hybrid_search(self, q, doc_id=None):  # noqa: ANN001
        return [_mk("c1", "milvus_hybrid"), _mk("c2", "milvus_hybrid")]

    async def dense_search(self, q, doc_id=None):  # noqa: ANN001
        return [_mk("c1", "milvus_dense"), _mk("c3", "milvus_dense")]

    async def bm25_search(self, q, doc_id=None):  # noqa: ANN001
        return [_mk("c2", "milvus_bm25")]


class _FakeGraph:
    async def local_search(self, q):  # noqa: ANN001
        return [_mk("c3", "graph")]


class _FakePipe:
    _milvus = _FakeMilvus()
    _graph = _FakeGraph()


def _mk(cid: str, src: str) -> RetrievedChunk:
    c = Chunk(doc_id="d", text="t", raw_text="t", chunk_id=cid,
              metadata={"title": cid, "source_uri": "doc"})
    return RetrievedChunk(chunk=c, score=1.0, source=src, origin_source=src)


@pytest.mark.asyncio
async def test_retrieve_local_captures_legs_when_enabled(monkeypatch) -> None:  # noqa: ANN001
    monkeypatch.setattr(rag_nodes, "get_pipeline", lambda: _FakePipe())
    monkeypatch.setattr(
        rag_nodes.get_settings(), "enable_retrieval_trace", True, raising=False
    )
    out = await rag_nodes.retrieve_local({"question": "q"})
    assert "candidates" in out
    legs = out["trace_legs"]
    assert [h["chunkId"] for h in legs["dense"]] == ["c1", "c3"]
    assert legs["dense"][0]["rank"] == 1
    assert [h["chunkId"] for h in legs["bm25"]] == ["c2"]
    assert [h["chunkId"] for h in legs["graph"]] == ["c3"]
    assert "c1" in out["trace_pool_meta"]
```

> Note: if `test_rag_qa.py` does not configure `asyncio_mode = auto`, keep the `@pytest.mark.asyncio` decorator; otherwise the repo's existing async tests run bare — match the file's existing convention (remove the decorator if the other async tests in the file lack it).

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::test_retrieve_local_captures_legs_when_enabled -q`
Expected: FAIL — `KeyError: 'trace_legs'`.

- [ ] **Step 3: Add the state fields**

In `src/sovereign_rag/graphs/rag_qa/state.py`, inside `RAGState`, after `reranked: list[RetrievedChunk]`:

```python
    # -- retrieval trace (inspector overlay; only when enable_retrieval_trace) --
    trace_legs: dict[str, list[dict[str, object]]]   # {"dense"|"bm25"|"graph": [LegHit-as-dict]}
    trace_pool_meta: dict[str, dict[str, str]]       # chunk_id -> {title, snippet, origin}
    trace_rerank: list[dict[str, object]]            # [{chunkId, score}] full rerank ranking
```

- [ ] **Step 4: Implement shadow-leg capture in `retrieve_local`**

In `src/sovereign_rag/graphs/rag_qa/nodes.py`, replace the `retrieve_local`
function with the version below (no new imports — `asyncio`, `RetrievedChunk`,
`_dedup_by_chunk`, `get_settings`, `get_pipeline` are already imported; trace
state holds plain dicts, so `LegHit` is **not** imported here). Keep
`_retrieve_deduped` unchanged — it serves the trace-off path and the fallback.

```python
async def retrieve_local(state: RAGState) -> dict[str, object]:
    """Hybrid Milvus + Neo4j graph local-search, deduped.

    When ``enable_retrieval_trace`` is on, the same one-shot retrieval also keeps
    the dense + BM25 legs (run as separate passes) so the inspector can show
    per-leg ranks. The answer pool is still ``dedup(hybrid + graph)`` exactly as
    in ``_retrieve_deduped`` — provenance is additive, never altering the pool.
    """
    pipe = get_pipeline()
    s = get_settings()
    question = state["question"]
    doc_id = state.get("doc_id")
    if s.enable_retrieval_trace:
        try:
            out = await _retrieve_with_trace(pipe, question, doc_id)
            logger.info("retrieve_local: %d candidates (+trace)", len(out["candidates"]))  # type: ignore[arg-type]
            return out
        except Exception as exc:  # provenance must never break retrieval
            logger.warning("retrieve_local trace path failed, falling back: %s", exc)
    candidates = await _retrieve_deduped(pipe, question, doc_id)
    logger.info("retrieve_local: %d candidates", len(candidates))
    return {"candidates": candidates}


def _leg(hits: list[RetrievedChunk]) -> list[dict[str, object]]:
    """Serialize a retriever leg's hits to ranked dicts (return order == rank)."""
    return [
        {"chunkId": h.chunk.chunk_id, "rank": i, "score": float(h.score)}
        for i, h in enumerate(hits, start=1)
    ]


async def _empty() -> list[RetrievedChunk]:
    return []


async def _retrieve_with_trace(
    pipe: object, question: str, doc_id: str | None
) -> dict[str, object]:
    """One gather: hybrid+graph build the pool; dense+bm25 add leg provenance.

    Reuses the single ``local_search`` for both the pool and the graph leg, so
    only dense+BM25 are extra queries. Per-leg failures degrade to an empty leg
    (``return_exceptions=True``); the pool tolerates a failed retriever exactly
    as ``_retrieve_deduped`` does.
    """
    milvus = pipe._milvus  # type: ignore[attr-defined]
    graph = pipe._graph  # type: ignore[attr-defined]
    results = await asyncio.gather(
        milvus.hybrid_search(question, doc_id=doc_id),
        milvus.dense_search(question, doc_id=doc_id),
        milvus.bm25_search(question, doc_id=doc_id),
        graph.local_search(question) if graph is not None else _empty(),
        return_exceptions=True,
    )
    hybrid_hits, dense_hits, bm25_hits, graph_hits = (
        r if not isinstance(r, BaseException) else [] for r in results
    )
    candidates = _dedup_by_chunk([*hybrid_hits, *graph_hits])
    pool_meta: dict[str, dict[str, str]] = {}
    for rc in candidates:
        uri = str(rc.chunk.metadata.get("source_uri", ""))
        origin = "web" if uri.lower().startswith(("http://", "https://")) else "local"
        pool_meta[rc.chunk.chunk_id] = {
            "title": str(rc.chunk.metadata.get("title", "")),
            "snippet": rc.chunk.raw_text[:240],
            "origin": origin,
        }
    return {
        "candidates": candidates,
        "trace_legs": {
            "dense": _leg(dense_hits),
            "bm25": _leg(bm25_hits),
            "graph": _leg(graph_hits),
        },
        "trace_pool_meta": pool_meta,
    }
```

- [ ] **Step 5: Run tests + gates**

Run: `uv run pytest tests/test_rag_qa.py -q && uv run ruff check src/ tests/ && uv run mypy src/`
Expected: PASS, clean.

- [ ] **Step 6: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/state.py src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(rag_qa): capture per-leg retrieval provenance in retrieve_local"
```

---

### Task 7: `do_rerank` full-ranking capture

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py` (`do_rerank`)
- Test: `tests/test_rag_qa.py`

**Interfaces:**
- Consumes: `rerank_scores`, `select_top_k`, `Settings.enable_retrieval_trace`.
- Produces: unchanged `reranked` + `retrieved`; new state key `trace_rerank: list[dict]` (`[{chunkId, score}]`, full ranking) when tracing.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
async def test_do_rerank_captures_full_ranking(monkeypatch) -> None:  # noqa: ANN001
    cands = [_mk("c1", "graph"), _mk("c2", "milvus_dense"), _mk("c3", "milvus_bm25")]
    full = [(cands[1], 9.0), (cands[0], 3.0), (cands[2], 1.0)]
    monkeypatch.setattr(rag_nodes, "rerank_scores", lambda q, c: full)
    monkeypatch.setattr(rag_nodes.get_settings(), "enable_retrieval_trace", True, raising=False)
    out = await rag_nodes.do_rerank({"question": "q", "candidates": cands})
    assert [c.chunk.chunk_id for c in out["reranked"]][0] == "c2"
    assert out["retrieved"] == 3
    assert out["trace_rerank"] == [
        {"chunkId": "c2", "score": 9.0},
        {"chunkId": "c1", "score": 3.0},
        {"chunkId": "c3", "score": 1.0},
    ]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::test_do_rerank_captures_full_ranking -q`
Expected: FAIL — `KeyError: 'trace_rerank'`.

- [ ] **Step 3: Implement**

In `src/sovereign_rag/graphs/rag_qa/nodes.py`, update the imports (replace the `rerank` import):

```python
from sovereign_rag.providers.reranker import rerank, rerank_scores, select_top_k
```

Replace `do_rerank` with:

```python
async def do_rerank(state: RAGState) -> dict[str, object]:
    """Cross-encoder rerank → top_k. Captures the full ranking when tracing."""
    s = get_settings()
    candidates = state.get("candidates") or []
    if not candidates:
        return {"reranked": [], "retrieved": 0}
    if s.enable_retrieval_trace:
        scored = rerank_scores(state["question"], candidates)
        reranked = select_top_k(scored, settings=s, top_k=s.rerank_top_k)
        trace_rerank = [
            {"chunkId": c.chunk.chunk_id, "score": float(score)} for c, score in scored
        ]
        return {"reranked": reranked, "retrieved": len(candidates), "trace_rerank": trace_rerank}
    reranked = rerank(state["question"], candidates, top_k=s.rerank_top_k)
    return {"reranked": reranked, "retrieved": len(candidates)}
```

- [ ] **Step 4: Run tests + gates**

Run: `uv run pytest tests/test_rag_qa.py -q && uv run mypy src/`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(rag_qa): capture full rerank ranking in do_rerank"
```

---

### Task 8: Assemble the trace on `done`

**Files:**
- Modify: `src/sovereign_rag/api/ask/router.py` (new `assemble_retrieval_payload`, attach to `done`)
- Test: `tests/test_retrieval_trace.py`

**Interfaces:**
- Consumes: `build_trace`, `trace_to_dict`, `LegHit`.
- Produces: `assemble_retrieval_payload(final_state: dict, citations: list[dict]) -> dict | None`; `done["retrieval"]` set when present.

- [ ] **Step 1: Write the failing test**

Append to `tests/test_retrieval_trace.py`:

```python
from sovereign_rag.api.ask.router import assemble_retrieval_payload


def test_assemble_retrieval_payload_from_state() -> None:
    final_state = {
        "trace_legs": {
            "dense": [{"chunkId": "c1", "rank": 1, "score": 0.9}],
            "bm25": [{"chunkId": "c1", "rank": 2, "score": 3.0}],
            "graph": [],
        },
        "trace_pool_meta": {"c1": {"title": "T", "snippet": "s", "origin": "local"}},
        "trace_rerank": [{"chunkId": "c1", "score": 5.0}],
        "rerank_top_k": 5,
    }
    payload = assemble_retrieval_payload(final_state, [{"chunk_id": "c1"}])
    assert payload is not None
    assert payload["poolSize"] == 1
    assert payload["chunks"][0]["cited"] is True
    assert payload["legs"]["dense"][0]["chunkId"] == "c1"


def test_assemble_retrieval_payload_absent_returns_none() -> None:
    assert assemble_retrieval_payload({}, []) is None
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_retrieval_trace.py -k assemble -q`
Expected: FAIL — `ImportError: cannot import name 'assemble_retrieval_payload'`.

- [ ] **Step 3: Implement the helper**

In `src/sovereign_rag/api/ask/router.py`, add imports:

```python
from sovereign_rag.config import get_settings
from sovereign_rag.retrieval.trace import LegHit, build_trace, trace_to_dict
```

(`get_settings` is already imported — don't duplicate.) Add the helper near the other module-level functions:

```python
def assemble_retrieval_payload(
    final_state: dict[str, Any], citations: list[dict[str, Any]]
) -> dict[str, Any] | None:
    """Build the serialized RetrievalTrace from graph final-state, or None.

    Best-effort: returns None if trace fields are absent (flag off) or on any
    assembly error — the caller then simply omits `retrieval` from `done`.
    """
    legs_raw = final_state.get("trace_legs")
    rerank_raw = final_state.get("trace_rerank")
    if not legs_raw or rerank_raw is None:
        return None
    try:
        legs = {
            key: [LegHit(h["chunkId"], int(h["rank"]), float(h["score"])) for h in hits]
            for key, hits in legs_raw.items()
        }
        rerank_ranking = [(r["chunkId"], float(r["score"])) for r in rerank_raw]
        cited = {
            str(c.get("chunk_id")) for c in citations if c.get("chunk_id") is not None
        }
        trace = build_trace(
            legs=legs,
            rerank_ranking=rerank_ranking,
            top_k=int(final_state.get("rerank_top_k") or get_settings().rerank_top_k),
            pool_meta=final_state.get("trace_pool_meta") or {},
            cited_chunk_ids=cited,
        )
        return trace_to_dict(trace)
    except Exception:  # pragma: no cover - defensive
        logger.warning("assemble_retrieval_payload failed", exc_info=True)
        return None
```

- [ ] **Step 4: Attach to the `done` event**

In the `done` event dict (the `yield _sse({"type": "done", ...})` near the end of `_stream_generator`), capture and conditionally add the payload just before the yield:

```python
    retrieval_payload = assemble_retrieval_payload(final_state, citations)
    done_event: dict[str, Any] = {
        "type": "done",
        "thread_id": thread_id,
        "answer": final_state.get("answer"),
        "citations": citations,
        "retrieved": int(final_state.get("retrieved", 0)),
        "used": int(final_state.get("used", 0)),
        "timings": timings_payload,
        "fallback_used": bool(final_state.get("fallback_used", False)),
        "grade": final_state.get("grade"),
    }
    if retrieval_payload is not None:
        done_event["retrieval"] = retrieval_payload
    yield _sse(done_event)
```

(Replace the existing inline `yield _sse({"type": "done", ...})` block with the above; keep whatever extra keys the current `done` already sends.)

- [ ] **Step 5: Run tests + gates**

Run: `uv run pytest tests/test_retrieval_trace.py -q && uv run ruff check src/ tests/ && uv run mypy src/ && uv run pytest -m "not integration" -q`
Expected: PASS, clean. **Full backend gate green.**

- [ ] **Step 6: Commit**

```bash
git add src/sovereign_rag/api/ask/router.py tests/test_retrieval_trace.py
git commit -m "feat(ask): assemble + stream RetrievalTrace on the done event"
```

---

## Phase 2 — Frontend

### Task 9: Types — `RetrievalTrace` + `CitationModel.kind`

**Files:**
- Modify: `frontend/src/lib/api.ts`
- Modify: `frontend/src/hooks/use-ask-stream.ts` (done event)

**Interfaces:**
- Produces: `LegHit`, `TraceChunk`, `RetrievalTrace` TS types; `CitationModel.kind?: CitationKind`; `done.retrieval?: RetrievalTrace`.

- [ ] **Step 1: Add the types**

In `frontend/src/lib/api.ts`, add (place near `CitationModel`):

```ts
export interface LegHit {
  chunkId: string
  rank: number
  score: number
}

export interface TraceChunk {
  chunkId: string
  title: string
  snippet: string
  origin: "local" | "web"
  denseRank: number | null
  bm25Rank: number | null
  graphRank: number | null
  rerankRank: number | null
  rerankScore: number | null
  inTopK: boolean
  cited: boolean
}

export interface RetrievalTrace {
  legs: { dense: LegHit[]; bm25: LegHit[]; graph: LegHit[] }
  chunks: TraceChunk[]
  poolSize: number
  topK: number
}
```

Add `kind?` to `CitationModel` (import `CitationKind` type if not circular; otherwise inline the union):

```ts
  kind?: "hybrid" | "graph" | "vector" | "web"
```

- [ ] **Step 2: Extend the done event type**

In `frontend/src/hooks/use-ask-stream.ts`, import `RetrievalTrace`:

```ts
import type { AskRequest, CandidateUrl, CitationModel, GradeLabel, RetrievalTrace } from "@/lib/api"
```

and add to the `done` member of `StreamEvent` (after `grade?: GradeLabel | null`):

```ts
      retrieval?: RetrievalTrace
```

- [ ] **Step 3: Verify it compiles**

Run: `cd frontend && npx tsc -b`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts frontend/src/hooks/use-ask-stream.ts
git commit -m "feat(frontend): RetrievalTrace types + done.retrieval"
```

---

### Task 10: `pickKind` reads backend kind (+ test)

**Files:**
- Modify: `frontend/src/lib/citation-kind.ts`
- Test: `frontend/src/lib/citation-kind.test.ts` (new)

**Interfaces:**
- Consumes: `CitationModel.kind`.
- Produces: `pickKind(c)` returns `c.kind` when set, else the URL heuristic.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/citation-kind.test.ts`:

```ts
import { describe, expect, it } from "vitest"

import { pickKind } from "./citation-kind"

const base = {
  chunk_id: "c1", doc_id: "d", title: "t", source_uri: "doc_1", page: null, score: 1, snippet: "s",
}

describe("pickKind", () => {
  it("prefers the backend kind when present", () => {
    expect(pickKind({ ...base, kind: "graph" })).toBe("graph")
    expect(pickKind({ ...base, kind: "vector" })).toBe("vector")
  })
  it("falls back to the url heuristic when kind is absent", () => {
    expect(pickKind({ ...base, source_uri: "https://x.com/a" })).toBe("web")
    expect(pickKind(base)).toBe("hybrid")
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/lib/citation-kind.test.ts`
Expected: FAIL — backend `kind` ignored (`graph` case returns `hybrid`).

- [ ] **Step 3: Implement**

Replace the body of `pickKind` in `frontend/src/lib/citation-kind.ts`:

```ts
export function pickKind(c: CitationModel): CitationKind {
  if (c.kind) return c.kind
  if (c.source_uri && /^https?:\/\//i.test(c.source_uri)) return "web"
  return "hybrid"
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/lib/citation-kind.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/citation-kind.ts frontend/src/lib/citation-kind.test.ts
git commit -m "feat(frontend): pickKind reads backend citation kind"
```

---

### Task 11: Thread `retrieval` into the Turn + inspector

**Files:**
- Modify: `frontend/src/pages/Ask.tsx` (`Turn`, `onDone`, `InspectableTurn` conversion)

**Interfaces:**
- Consumes: `done.retrieval`.
- Produces: `Turn.retrieval?: RetrievalTrace`, passed into `InspectableTurn.retrieval`.

- [ ] **Step 1: Add the field to `Turn`**

In `frontend/src/pages/Ask.tsx`, import `RetrievalTrace` from `@/lib/api` and add to the `Turn` interface:

```ts
  retrieval?: RetrievalTrace
```

- [ ] **Step 2: Set it on done**

In the `onDone` handler where the turn is finalized (the object built from `final`), add:

```ts
        retrieval: final.retrieval,
```

- [ ] **Step 3: Pass it to the inspector**

In the `inspectedTurn` / `InspectableTurn` conversion (around the Sheet mount), add:

```ts
        retrieval: turn.retrieval,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd frontend && npx tsc -b`
Expected: no errors (note: `InspectableTurn` gets its `retrieval` field in Task 12).

> If `tsc` flags `retrieval` as unknown on `InspectableTurn`, that's expected until Task 12 — do Task 12 before re-running the gate. Commit happens at the end of Task 12.

---

### Task 12: Retrieval section component

**Files:**
- Create: `frontend/src/components/ask/retrieval-section.tsx`
- Modify: `frontend/src/components/ask/turn-inspector-sheet.tsx` (`InspectableTurn.retrieval`, mount the section after the Pipeline section)
- Test: `frontend/src/components/ask/retrieval-section.test.tsx` (new)

**Interfaces:**
- Consumes: `RetrievalTrace`.
- Produces: `<RetrievalSection trace={...} />`.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/ask/retrieval-section.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { RetrievalSection } from "./retrieval-section"
import type { RetrievalTrace } from "@/lib/api"

const trace: RetrievalTrace = {
  legs: { dense: [{ chunkId: "c1", rank: 1, score: 0.9 }], bm25: [], graph: [] },
  chunks: [
    { chunkId: "c1", title: "Alpha", snippet: "a", origin: "local",
      denseRank: 1, bm25Rank: null, graphRank: null,
      rerankRank: 1, rerankScore: 5, inTopK: true, cited: true },
    { chunkId: "c2", title: "Beta", snippet: "b", origin: "web",
      denseRank: null, bm25Rank: 3, graphRank: null,
      rerankRank: 2, rerankScore: 2, inTopK: false, cited: false },
  ],
  poolSize: 2, topK: 1,
}

describe("RetrievalSection", () => {
  it("renders chunk titles and a cited marker", () => {
    render(<RetrievalSection trace={trace} />)
    expect(screen.getByText("Alpha")).toBeDefined()
    expect(screen.getByText("Beta")).toBeDefined()
    expect(screen.getAllByTestId("rs-row").length).toBe(2)
    expect(screen.getByTestId("rs-cited-c1")).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/components/ask/retrieval-section.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/ask/retrieval-section.tsx`:

```tsx
import { useTranslation } from "react-i18next"

import type { RetrievalTrace, TraceChunk } from "@/lib/api"

function rankCell(n: number | null): string {
  return n === null ? "—" : `#${n}`
}

/** A compact provenance table: per-leg ranks + rerank reordering + cited. */
export function RetrievalSection({ trace }: { trace: RetrievalTrace }) {
  const { t } = useTranslation()
  const counts = `dense ${trace.legs.dense.length} · bm25 ${trace.legs.bm25.length} · graph ${trace.legs.graph.length}`
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">{t("pages.ask.inspector.retrieval.title")}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {counts} · {t("pages.ask.inspector.retrieval.poolToTop", { pool: trace.poolSize, top: trace.topK })}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">#</th>
              <th className="px-2 py-1 text-left">{t("pages.ask.inspector.retrieval.chunk")}</th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.dense")}</th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.bm25")}</th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.graph")}</th>
              <th className="px-2 py-1 text-right">{t("pages.ask.inspector.retrieval.score")}</th>
            </tr>
          </thead>
          <tbody>
            {trace.chunks.map((c: TraceChunk, i) => {
              const cutoff = i === trace.topK && trace.topK < trace.chunks.length
              return (
                <tr
                  key={c.chunkId}
                  data-testid="rs-row"
                  className={`border-t ${cutoff ? "border-t-primary/50" : ""} ${c.inTopK ? "" : "opacity-60"}`}
                >
                  <td className="px-2 py-1 font-mono">{rankCell(c.rerankRank)}</td>
                  <td className="px-2 py-1">
                    <span className="font-medium">{c.title || c.chunkId}</span>
                    {c.origin === "web" && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px]">web</span>
                    )}
                    {c.cited && (
                      <span
                        data-testid={`rs-cited-${c.chunkId}`}
                        className="ml-1 rounded bg-primary/15 px-1 text-[10px] text-primary"
                      >
                        {t("pages.ask.inspector.retrieval.cited")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.denseRank)}</td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.bm25Rank)}</td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.graphRank)}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {c.rerankScore === null ? "—" : c.rerankScore.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Mount it in the inspector Sheet**

In `frontend/src/components/ask/turn-inspector-sheet.tsx`:
1. Import: `import { RetrievalSection } from "./retrieval-section"` and add `retrieval?: RetrievalTrace` to the `InspectableTurn` interface (import `RetrievalTrace` from `@/lib/api`).
2. Render right after the Pipeline/Trace section block:

```tsx
        {turn.retrieval && <RetrievalSection trace={turn.retrieval} />}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/components/ask/retrieval-section.test.tsx`
Expected: PASS.

- [ ] **Step 6: Verify compile**

Run: `cd frontend && npx tsc -b`
Expected: no errors (Task 11's `InspectableTurn.retrieval` now resolves).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/components/ask/retrieval-section.tsx frontend/src/components/ask/retrieval-section.test.tsx frontend/src/components/ask/turn-inspector-sheet.tsx frontend/src/pages/Ask.tsx
git commit -m "feat(frontend): retrieval provenance section in the inspector sheet"
```

---

### Task 13: i18n keys (EN + RU)

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ru.json`

**Interfaces:**
- Produces: `pages.ask.inspector.retrieval.*` keys used by `RetrievalSection`.

- [ ] **Step 1: Add EN keys**

In `frontend/src/locales/en.json`, inside `pages.ask.inspector`, add:

```json
        "retrieval": {
          "title": "Retrieval",
          "poolToTop": "pool {{pool}} → top {{top}}",
          "chunk": "Chunk",
          "dense": "Dense",
          "bm25": "BM25",
          "graph": "Graph",
          "score": "Score",
          "cited": "cited"
        },
```

- [ ] **Step 2: Add RU keys**

In `frontend/src/locales/ru.json`, inside `pages.ask.inspector`, add:

```json
        "retrieval": {
          "title": "Поиск",
          "poolToTop": "пул {{pool}} → топ {{top}}",
          "chunk": "Фрагмент",
          "dense": "Плотный",
          "bm25": "BM25",
          "graph": "Граф",
          "score": "Оценка",
          "cited": "процитирован"
        },
```

- [ ] **Step 3: Verify key parity**

Run:
```bash
cd frontend && node -e "const e=require('./src/locales/en.json'),r=require('./src/locales/ru.json');const a=e.pages.ask.inspector.retrieval,b=r.pages.ask.inspector.retrieval;const ka=Object.keys(a).sort(),kb=Object.keys(b).sort();if(JSON.stringify(ka)!==JSON.stringify(kb)){console.error('MISMATCH',ka,kb);process.exit(1)}console.log('parity ok')"
```
Expected: `parity ok`.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ru.json
git commit -m "i18n: retrieval inspector section (en + ru)"
```

---

### Task 14: Full verification + integration test

**Files:**
- Create/extend: one gated integration test (optional, `tests/test_rag_qa.py` or a new gated module)

**Interfaces:** none new.

- [ ] **Step 1: Backend gate**

Run: `uv run ruff check src/ tests/ && uv run ruff format --check src/ tests/ && uv run mypy src/ && uv run pytest -m "not integration" -q`
Expected: all green. Fix any fallout before proceeding.

- [ ] **Step 2: Frontend gate**

Run: `cd frontend && npx vitest run && npm run build`
Expected: vitest green; build succeeds (`tsc -b && vite build`).

- [ ] **Step 3: (Optional) gated end-to-end provenance check**

If a live stack is available (`RUN_*_IT=1`), add an integration test that POSTs `/ask/stream`, reads to the `done` event, and asserts `done.retrieval.legs.dense` is present with per-chunk ranks. Mark `@pytest.mark.integration` and gate on the project's convention (e.g. `RUN_MILVUS_IT`/`RUN_NEO4J_IT`).

- [ ] **Step 4: Final commit (if Step 3 added a test)**

```bash
git add tests/
git commit -m "test(rag_qa): gated end-to-end retrieval-trace assertion"
```

---

## Self-Review

**Spec coverage:**
- §5 data model → Task 4 (`trace.py`). ✅
- §6.1 config flag → Task 1. ✅
- §6.2 `origin_source` → Task 2. ✅
- §6.3 dense/bm25 search exist → used in Task 6 (no store change beyond `origin_source`). ✅
- §6.4 retrieve_local shadow legs → Task 6. ✅
- §6.5 `rerank_scores` → Task 3. ✅
- §6.6 do_rerank capture → Task 7. ✅
- §6.7 `Citation.kind` → Task 5. ✅
- §6.8 `RAGState` fields → Task 6 (state.py). ✅
- §6.9 done assembly → Task 8. ✅
- §7.1 types → Task 9. ✅
- §7.2 use-ask-stream → Task 9. ✅
- §7.3 Ask.tsx Turn → Task 11. ✅
- §7.4 Retrieval Sheet section → Task 12. ✅
- §7.5 pickKind → Task 10. ✅
- §7.6 i18n → Task 13. ✅
- §8 gating/degradation → Task 6 (try/except), Task 8 (best-effort), Task 1 (flag). ✅
- §9 testing → Tasks 1–13 unit/vitest + Task 14 integration. ✅

**Type consistency:** `origin_source` (str) defined Task 2, consumed Tasks 3/5/6. `LegHit`/`TraceChunk`/`RetrievalTrace` defined Task 4, serialized camelCase (Task 4 `trace_to_dict`) and mirrored in TS (Task 9). `trace_legs`/`trace_rerank`/`trace_pool_meta` state keys defined Task 6, produced Tasks 6/7, consumed Task 8. `assemble_retrieval_payload(final_state, citations)` defined + tested Task 8. Frontend `retrieval` flows `done` (Task 9) → `Turn` (Task 11) → `InspectableTurn` (Task 12) → `RetrievalSection` (Task 12). Consistent.

**Placeholder scan:** No TBD/TODO; every code step shows real code; commands have expected output. ✅
