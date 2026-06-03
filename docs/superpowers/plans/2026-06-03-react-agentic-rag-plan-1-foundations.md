# ReAct Agentic RAG — Plan 1: Foundations (state + search tools) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the tested, offline foundation for the ReAct agentic-RAG controller — the agent state schema (with a windowed conversation-history reducer) and the corpus/web search tool executors that return *compact* observations while stashing *full* chunks for the finalize step.

**Architecture:** A custom LangGraph agent loop (Plans 2+) orchestrates existing retrieval primitives as tools. This plan delivers the pure, unit-testable pieces: `AgentState`, the history-window reducer, the `search_corpus` / `web_search` executors (reusing `_retrieve_deduped`, `rerank`, `ingestion.search`), the compact-observation formatter, and the finalize grounding-selection helper. No graph, no LLM, no interrupt yet — all of that is Plan 2.

**Tech Stack:** Python 3.12, LangGraph state + reducers, pydantic v2 (tool arg schemas), pytest (`asyncio_mode=auto`), `uv`, ruff + mypy.

**Spec:** `docs/superpowers/specs/2026-06-03-react-agentic-rag-design.md`

---

## Phase roadmap (the full feature, ~CRAG-sized)

Each phase is its own plan doc, written in full detail before execution (the cadence used for CRAG). This document is **Plan 1**.

- **Plan 1 — Foundations (this doc):** config flags, `AgentState` + history-window reducer, `search_corpus`/`web_search` executors, compact formatter, grounding-selection helper. Offline, unit-tested.
- **Plan 2 — Agent loop:** `prepare`/`agent`/`tools`/`finalize`/`record_turn` nodes; `crawl_and_index` tool with `interrupt()` (HITL); bind tool schemas to `kimi-k2.6`; step cap; degrade-to-finalize on a malformed tool call; graph builder + `enable_react_agent` topology switch; checkpoint serde check.
- **Plan 3 — API/SSE:** map tool start/end → `node` SSE events (retain `crawl_progress`); `runs` audit fields (steps, top-score signal, decision); `/ask/resume` parity for the agent's crawl interrupt.
- **Plan 4 — Eval A/B:** flag-toggle agent vs CRAG-graph vs linear; auto-approver for `crawl_and_index`; golden cases (reformat → 0 tool calls, multi-hop → ≥2 `search_corpus`, web-fallback); token/step counts in `results.json`.
- **Plan 5 — Frontend:** adapt the agentic pipeline strip to render dynamic tool steps (search #1, search #2, web, answer).

**Separate (not in this feature):** paused-turn reconstruction fix; web-fallback chunk cap (`crag_web_max_chunks`); grade-threshold calibration.

---

## File structure (Plan 1)

- **Modify** `src/sovereign_rag/config.py` — add 3 settings (`enable_react_agent`, `react_max_steps`, `react_history_turns`).
- **Create** `src/sovereign_rag/graphs/rag_qa/agent_state.py` — `AgentState`, `HistoryTurn`, `window_history` reducer. One responsibility: the agent's state contract.
- **Create** `src/sovereign_rag/graphs/rag_qa/tools.py` — tool executors + compact formatter + grounding selection. One responsibility: the tool layer (wraps existing primitives, no graph/LLM).
- **Create** `tests/test_agent_state.py`, `tests/test_agent_tools.py`.

All new files stay small and single-purpose; the agent loop that consumes them is Plan 2.

---

## Task 1: Config flags

**Files:**
- Modify: `src/sovereign_rag/config.py` (the Corrective RAG settings block, after `crag_fast_web_index`)

- [ ] **Step 1: Add the settings**

In `src/sovereign_rag/config.py`, immediately after the `crag_fast_web_index: bool = True` line, add:

```python
    # ---- ReAct agent (agentic RAG controller) ----
    # Build-time structural flag (process restart to change), like
    # enable_corrective_rag: on → the rag_qa graph is built as a ReAct agent
    # loop; off → today's linear/CRAG graph. Lets the eval harness A/B them.
    enable_react_agent: bool = False
    # Hard cap on agent loop iterations before a forced finalize (bounds cost).
    react_max_steps: int = 4
    # How many (question, answer) turns of conversation history the agent keeps
    # as short-term memory (rolling window).
    react_history_turns: int = 3
```

- [ ] **Step 2: Verify it loads**

Run: `uv run python -c "from sovereign_rag.config import Settings; s=Settings(_env_file=None); print(s.enable_react_agent, s.react_max_steps, s.react_history_turns)"`
Expected: `False 4 3`

- [ ] **Step 3: Commit**

```bash
git add src/sovereign_rag/config.py
git commit -m "feat(config): add ReAct agent flags (enable_react_agent, react_max_steps, react_history_turns)"
```

---

## Task 2: AgentState + history-window reducer

**Files:**
- Create: `src/sovereign_rag/graphs/rag_qa/agent_state.py`
- Test: `tests/test_agent_state.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent_state.py`:

```python
"""AgentState history-window reducer — trims to react_history_turns."""

from __future__ import annotations

from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa.agent_state import HistoryTurn, window_history


def _t(q: str, a: str) -> HistoryTurn:
    return {"question": q, "answer": a}


def test_window_history_appends_from_empty() -> None:
    out = window_history(None, [_t("q1", "a1")])
    assert out == [{"question": "q1", "answer": "a1"}]


def test_window_history_trims_to_setting(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "react_history_turns", 2)
    h = window_history(None, [_t("q1", "a1")])
    h = window_history(h, [_t("q2", "a2")])
    h = window_history(h, [_t("q3", "a3")])
    assert [t["question"] for t in h] == ["q2", "q3"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_state.py -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'sovereign_rag.graphs.rag_qa.agent_state'`

- [ ] **Step 3: Write the implementation**

Create `src/sovereign_rag/graphs/rag_qa/agent_state.py`:

```python
"""State contract for the ReAct agentic-RAG graph (built when
``enable_react_agent=True``).

Two memory channels with different lifetimes:
- ``history`` — cross-turn conversation memory, a rolling window of the last
  ``react_history_turns`` (question, answer) pairs. ``HistoryTurn`` is a plain
  ``TypedDict`` so it needs no checkpoint-serde registration.
- ``scratch`` — the *current turn's* ReAct working messages (tool calls +
  observations); reset each turn by the ``prepare`` node (Plan 2). Plain
  overwrite channel (the loop is sequential, so nodes return the whole list).

``retrieved_pool`` accumulates the *full* RetrievedChunks fetched this turn
(keyed by chunk_id) so ``finalize`` can ground the answer in full passages
while the controller only ever sees compact observations.
"""

from __future__ import annotations

from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation


class HistoryTurn(TypedDict):
    question: str
    answer: str


def window_history(
    existing: list[HistoryTurn] | None, new: list[HistoryTurn] | None
) -> list[HistoryTurn]:
    """Append ``new`` turns and keep only the most recent ``react_history_turns``."""
    merged = (existing or []) + (new or [])
    n = get_settings().react_history_turns
    return merged[-n:] if n > 0 else merged


class AgentState(TypedDict, total=False):
    # Inputs / per-turn
    question: str
    doc_id: str | None
    # Memory
    history: Annotated[list[HistoryTurn], window_history]  # cross-turn (windowed)
    scratch: list[AnyMessage]  # current-turn ReAct messages (overwrite)
    retrieved_pool: dict[str, RetrievedChunk]  # full chunks this turn, by id
    steps: int
    # Outputs
    answer: str | None
    citations: list[Citation]
    retrieved: int
    used: int
    fallback_used: bool
    # HITL (web fallback)
    candidate_urls: list[dict[str, str]]
    approved_urls: list[str] | None
    declined: bool


__all__ = ["AgentState", "HistoryTurn", "window_history"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_agent_state.py -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/agent_state.py tests/test_agent_state.py
git commit -m "feat(agent): AgentState + windowed history reducer"
```

---

## Task 3: Compact observation formatter

**Files:**
- Create: `src/sovereign_rag/graphs/rag_qa/tools.py`
- Test: `tests/test_agent_tools.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_agent_tools.py`:

```python
"""Agent tool layer — compact observations, full-chunk stash, grounding select."""

from __future__ import annotations

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import tools


def _rc(chunk_id: str, score: float, title: str = "T", body: str = "body") -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d", text="t", raw_text=body, position=0, chunk_id=chunk_id,
        metadata={"title": title, "source_uri": "u"},
    )
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


def test_compact_chunks_shape() -> None:
    out = tools._compact_chunks([_rc("c1", 0.9, title="Doc", body="X" * 500)])
    assert out == [{"id": "c1", "title": "Doc", "score": 0.9, "snippet": "X" * 200}]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_tools.py::test_compact_chunks_shape -q`
Expected: FAIL — `ModuleNotFoundError: No module named 'sovereign_rag.graphs.rag_qa.tools'`

- [ ] **Step 3: Write the implementation**

Create `src/sovereign_rag/graphs/rag_qa/tools.py`:

```python
"""Tool layer for the ReAct agentic-RAG graph.

Each executor wraps an existing retrieval primitive and returns a tuple of
``(observation, state_update)``:
- ``observation`` — a COMPACT JSON string the controller LLM reasons over
  (ids + titles + scores + short snippets). Full passages never enter the loop.
- ``state_update`` — a partial ``AgentState`` dict; ``search_corpus`` stashes
  the *full* RetrievedChunks in ``retrieved_pool`` so ``finalize`` (Plan 2) can
  ground the answer in full text.

No graph, no LLM, no interrupt here — the agent loop wires these in Plan 2.
``_retrieve_deduped`` / ``rerank`` / ``get_pipeline`` / ``search`` are imported
at module scope so tests can monkeypatch them as ``tools.<name>``.
"""

from __future__ import annotations

import json
from typing import Any

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.graphs.rag_qa.nodes import _retrieve_deduped
from sovereign_rag.ingestion.search import search
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.shared.pipeline_deps import get_pipeline

_SNIPPET = 200


def _compact_chunks(retrieved: list[RetrievedChunk]) -> list[dict[str, Any]]:
    """Compact, controller-facing view of reranked chunks (no full text)."""
    return [
        {
            "id": rc.chunk.chunk_id,
            "title": str(rc.chunk.metadata.get("title", "")),
            "score": round(float(rc.score), 4),
            "snippet": rc.chunk.raw_text[:_SNIPPET],
        }
        for rc in retrieved
    ]


__all__ = ["_compact_chunks"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_agent_tools.py::test_compact_chunks_shape -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/tools.py tests/test_agent_tools.py
git commit -m "feat(agent): compact observation formatter"
```

---

## Task 4: `run_search_corpus` executor

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/tools.py`
- Test: `tests/test_agent_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_agent_tools.py`:

```python
async def test_run_search_corpus_compact_and_stash(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "rerank_top_k", 5)

    async def fake_dedup(pipe, q, d):  # type: ignore[no-untyped-def]
        return [_rc("c1", 0.8), _rc("c2", 0.4)]

    monkeypatch.setattr(tools, "_retrieve_deduped", fake_dedup)
    monkeypatch.setattr(tools, "rerank", lambda q, c, top_k=None: c)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())

    import json

    obs, update = await tools.run_search_corpus("hello?", None)
    parsed = json.loads(obs)
    assert parsed["top_score"] == 0.8
    assert [r["id"] for r in parsed["results"]] == ["c1", "c2"]
    assert set(update["retrieved_pool"]) == {"c1", "c2"}
    assert update["retrieved"] == 2


async def test_run_search_corpus_empty(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_dedup(pipe, q, d):  # type: ignore[no-untyped-def]
        return []

    monkeypatch.setattr(tools, "_retrieve_deduped", fake_dedup)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())
    import json

    obs, update = await tools.run_search_corpus("zzz", None)
    assert json.loads(obs) == {"results": [], "top_score": None}
    assert update["retrieved_pool"] == {} and update["retrieved"] == 0
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_tools.py -k run_search_corpus -q`
Expected: FAIL — `AttributeError: module ... has no attribute 'run_search_corpus'`

- [ ] **Step 3: Write the implementation**

In `tools.py`, add (and extend `__all__`):

```python
async def run_search_corpus(query: str, doc_id: str | None) -> tuple[str, dict[str, Any]]:
    """Hybrid Milvus + graph retrieve → rerank. Returns a compact observation
    (with the top-1 score as the 'good enough?' signal) and stashes the full
    reranked chunks in ``retrieved_pool``."""
    s = get_settings()
    pipe = get_pipeline()
    candidates = await _retrieve_deduped(pipe, query, doc_id)
    reranked = rerank(query, candidates, top_k=s.rerank_top_k) if candidates else []
    pool = {rc.chunk.chunk_id: rc for rc in reranked}
    top1 = float(reranked[0].score) if reranked else None
    obs = json.dumps(
        {"results": _compact_chunks(reranked), "top_score": top1}, ensure_ascii=False
    )
    return obs, {"retrieved_pool": pool, "retrieved": len(candidates)}
```

Update the `__all__` line to:

```python
__all__ = ["_compact_chunks", "run_search_corpus"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_agent_tools.py -k run_search_corpus -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/tools.py tests/test_agent_tools.py
git commit -m "feat(agent): search_corpus executor (compact obs + full-chunk stash)"
```

---

## Task 5: `run_web_search` executor

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/tools.py`
- Test: `tests/test_agent_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_agent_tools.py`:

```python
async def test_run_web_search_compact(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "web_fallback_max_urls", 3)

    async def fake_search(query, max_results=5):  # type: ignore[no-untyped-def]
        return [
            {"title": "A", "url": "https://a", "content": "snip a"},
            {"title": "B", "url": "", "content": "no url -> dropped"},
        ]

    monkeypatch.setattr(tools, "search", fake_search)
    import json

    obs, update = await tools.run_web_search("query")
    cands = json.loads(obs)["candidates"]
    assert cands == [{"title": "A", "url": "https://a", "snippet": "snip a"}]
    assert update["candidate_urls"] == cands
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_tools.py -k run_web_search -q`
Expected: FAIL — `AttributeError: ... 'run_web_search'`

- [ ] **Step 3: Write the implementation**

In `tools.py`, add (and extend `__all__`):

```python
async def run_web_search(query: str) -> tuple[str, dict[str, Any]]:
    """SearXNG search → compact candidate URLs. Crawling is a separate tool
    (``crawl_and_index``, Plan 2) so this network call is cheap and side-effect
    free; the agent decides whether to crawl."""
    s = get_settings()
    hits = await search(query, max_results=s.web_fallback_max_urls)
    candidates = [
        {"title": h.get("title", ""), "url": h["url"], "snippet": h.get("content", "")}
        for h in hits
        if h.get("url")
    ]
    obs = json.dumps({"candidates": candidates}, ensure_ascii=False)
    return obs, {"candidate_urls": candidates}
```

Update `__all__` to:

```python
__all__ = ["_compact_chunks", "run_search_corpus", "run_web_search"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_agent_tools.py -k run_web_search -q`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/tools.py tests/test_agent_tools.py
git commit -m "feat(agent): web_search executor (compact candidate URLs)"
```

---

## Task 6: `select_grounding` helper (finalize input)

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/tools.py`
- Test: `tests/test_agent_tools.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_agent_tools.py`:

```python
def test_select_grounding_ranks_and_caps() -> None:
    pool = {
        "c1": _rc("c1", 0.3),
        "c2": _rc("c2", 0.9),
        "c3": _rc("c3", 0.6),
    }
    top = tools.select_grounding(pool, top_k=2)
    assert [rc.chunk.chunk_id for rc in top] == ["c2", "c3"]


def test_select_grounding_empty() -> None:
    assert tools.select_grounding({}, top_k=5) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_agent_tools.py -k select_grounding -q`
Expected: FAIL — `AttributeError: ... 'select_grounding'`

- [ ] **Step 3: Write the implementation**

In `tools.py`, add (and extend `__all__`):

```python
def select_grounding(pool: dict[str, RetrievedChunk], top_k: int) -> list[RetrievedChunk]:
    """Pick the chunks the finalize step grounds the answer in: the highest-
    scoring ``top_k`` across the whole turn's retrieved_pool (the union of all
    search_corpus calls — so multi-hop answers ground in every relevant hit)."""
    ranked = sorted(pool.values(), key=lambda rc: float(rc.score), reverse=True)
    return ranked[:top_k]
```

Update `__all__` to:

```python
__all__ = ["_compact_chunks", "run_search_corpus", "run_web_search", "select_grounding"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_agent_tools.py -k select_grounding -q`
Expected: PASS (2 passed)

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/tools.py tests/test_agent_tools.py
git commit -m "feat(agent): select_grounding helper for finalize"
```

---

## Task 7: Plan-1 gate (lint + types + full suite)

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend gate**

Run:
```bash
uv run ruff check src/ tests/ && \
uv run ruff format --check src/ tests/ && \
uv run mypy src/ && \
uv run pytest -m "not integration" -q
```
Expected: ruff clean, format clean, mypy `Success`, all tests pass (existing + the new `test_agent_state.py` / `test_agent_tools.py`).

- [ ] **Step 2: If anything fails, fix inline and re-run**

Common fixes: run `uv run ruff format src/ tests/` for format; add precise type annotations flagged by mypy (do not add `# type: ignore` without the specific error code).

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A
git commit -m "chore(agent): plan-1 gate green (ruff/format/mypy/pytest)"
```

---

## Self-review (done while writing)

- **Spec coverage (Plan 1 scope):** state schema + history window (spec §5) ✓; `search_corpus` compact-obs + full stash (spec §3 tools, §4 grounding) ✓; `web_search` compact (spec §3) ✓; finalize grounding selection over the deduped pool (spec §4.2) ✓; config flags (spec §8) ✓. `crawl_and_index` + the loop + HITL are correctly deferred to Plan 2 (spec §3, §6).
- **Placeholder scan:** none — every step has runnable code/commands.
- **Type consistency:** `_compact_chunks` / `run_search_corpus` / `run_web_search` / `select_grounding` signatures match their uses across tasks; `HistoryTurn`/`window_history`/`AgentState` names are stable; reused symbols (`_retrieve_deduped`, `rerank`, `get_pipeline`, `search`, `RetrievedChunk`, `Chunk`, `Citation`, `get_settings`) verified against the codebase.
