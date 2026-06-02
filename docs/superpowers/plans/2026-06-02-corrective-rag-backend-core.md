# Corrective RAG — Backend Core (Plan 1 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the linear `retrieve_local → rerank → generate` QA graph into a self-correcting CRAG loop — grade the reranked context, and on a weak grade rewrite the query, search the web, pause for human approval (`interrupt()`), then crawl+index and re-retrieve — all inside the existing `graphs/rag_qa` LangGraph and fully testable in isolation.

**Architecture:** Extend `graphs/rag_qa`. A pure `retrieval/grading.py` grades the reranked top-1 (sigmoid-normalized cross-encoder score) with threshold short-circuits and a light-LLM middle band. A `route_after_grade` conditional edge loops weak grades through `transform_query → web_search → request_approval`. Following LangGraph's "a resumed node re-runs from its top" rule, the **side-effecting** SearXNG call lives in `web_search` and the `interrupt()` lives alone in `request_approval`, which returns `Command(goto=…, update=…)` to branch approve→`crawl_index` (loop back) vs decline→`generate`. A `correction_attempts` guard + `recursion_limit` bound the loop. `enable_corrective_rag=False` builds the original linear topology unchanged.

**Tech Stack:** Python 3.12 · LangGraph 1.x (`StateGraph`, `add_conditional_edges`, `interrupt`/`Command` from `langgraph.types`, `InMemorySaver`) · pydantic-settings · pytest (async) · uv.

**Scope note:** This is **Plan 1 of 5**. It delivers the graph + grader + config and proves the interrupt→resume→loop at the graph level with a `MemorySaver`. Follow-on plans (not here): **Plan 2** API interrupt-detection + `/ask/resume` + SSE (`grade`/`interrupt`/`crawl_progress`) + runs schema; **Plan 3** eval graph-driven mode + auto-approver + web fixture + A/B; **Plan 4** frontend port from `design/.../crag/`; **Plan 5** docs reconciliation. Spec: `docs/superpowers/specs/2026-06-02-corrective-rag-hitl-design.md`.

**Conventions (match this repo):** Conventional-commit messages, **no `Co-Authored-By` footer** (project rule). Async nodes over `RAGState`, deps fetched from the shared layer (`get_pipeline`/`get_chat_model`) and imported at module level so tests can monkeypatch them on `sovereign_rag.graphs.rag_qa.nodes`. Run unit tests with `uv run pytest -m "not integration"`; lint with `uv run ruff check` and `uv run mypy src/`.

**Topology refinement vs spec §5.1:** the spec drew one `web_search` node doing search **and** `interrupt()`. This plan splits it into `web_search` (search only) + `request_approval` (`interrupt()` only) because a resumed node re-runs from its top — isolating the interrupt prevents re-running the SearXNG search on every resume. Net behaviour is identical; the split is the LangGraph best practice.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/sovereign_rag/config.py` | 7 new CRAG knobs | modify |
| `src/sovereign_rag/retrieval/grading.py` | pure grader: `Grade` + `grade_candidates()` | **create** |
| `src/sovereign_rag/graphs/rag_qa/state.py` | new `RAGState` fields | modify |
| `src/sovereign_rag/graphs/rag_qa/nodes.py` | `grade`, `route_after_grade`, `transform_query`, `web_search`, `request_approval`, `crawl_index`, `generate` note | modify |
| `src/sovereign_rag/graphs/rag_qa/graph.py` | conditional topology (linear when disabled) | modify |
| `tests/test_grading.py` | grader unit tests | **create** |
| `tests/test_rag_qa.py` | new node unit tests | modify |
| `tests/test_rag_qa_graph.py` | graph-level interrupt/resume/loop tests (`InMemorySaver`) | **create** |

---

## Task 1: Config knobs

**Files:**
- Modify: `src/sovereign_rag/config.py` (after the `adaptive_rerank` block, ~line 104)
- Test: `tests/test_config_crag.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_config_crag.py`:

```python
"""CRAG config knob defaults."""

from __future__ import annotations

from sovereign_rag.config import Settings


def test_crag_defaults() -> None:
    s = Settings(_env_file=None)  # ignore the local .env; assert code defaults
    assert s.enable_corrective_rag is False
    assert s.crag_correct_threshold == 0.70
    assert s.crag_incorrect_threshold == 0.30
    assert s.crag_max_corrections == 1
    assert s.crag_grader_tier == "light"
    assert s.web_fallback_max_urls == 5
    assert s.web_fallback_crawl_top_k == 3


def test_crag_thresholds_orderable() -> None:
    s = Settings(_env_file=None)
    assert s.crag_incorrect_threshold < s.crag_correct_threshold
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_config_crag.py -v`
Expected: FAIL — `AttributeError: 'Settings' object has no attribute 'enable_corrective_rag'`.

- [ ] **Step 3: Add the knobs**

In `src/sovereign_rag/config.py`, immediately after the `adaptive_rerank: bool = False` line (end of the reranker post-filter block), insert:

```python
    # ---- Corrective RAG (CRAG) ----
    # Master toggle. False → the original linear retrieve→rerank→generate graph
    # is built (no grade/correction nodes). This is a build-time structural flag:
    # changing it requires recompiling the graph (process restart), so it is NOT
    # part of the per-request AskOverrides.
    # Ships OFF: the graph interrupts on weak grades, and the API/SSE that drive
    # the resume land in Plan 2 — keep prod on the linear graph until then.
    enable_corrective_rag: bool = False
    # The grade band over the sigmoid-normalized top-1 reranker score (0..1):
    #   score >= correct   → Correct   (answer now, no LLM)
    #   score <= incorrect → Incorrect (correct via web, no LLM)
    #   in between         → one light-tier LLM call decides the label
    # Defaults are placeholders pending an empirical sweep on the golden set
    # (gte-reranker logits aren't centered — see the spec's risks section).
    crag_correct_threshold: float = 0.70
    crag_incorrect_threshold: float = 0.30
    # How many corrective web rounds before the graph answers with what it has.
    crag_max_corrections: int = 1
    # Model tier for the middle-band grader (mirrors llm_factory tiers).
    crag_grader_tier: str = "light"
    # Candidate URLs surfaced to the human for approval per correction.
    web_fallback_max_urls: int = 5
    # URLs the eval auto-approver picks (Plan 3); unused by the product path.
    web_fallback_crawl_top_k: int = 3
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_config_crag.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/config.py tests/test_config_crag.py
git commit -m "feat(crag): add Corrective RAG config knobs"
```

---

## Task 2: The grader (`retrieval/grading.py`)

Pure, service-free, async. Threshold paths never touch the LLM; the middle band calls an injectable `llm_judge` so tests stay offline.

**Files:**
- Create: `src/sovereign_rag/retrieval/grading.py`
- Test: `tests/test_grading.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_grading.py`:

```python
"""Hybrid grader unit tests — threshold short-circuits + injectable LLM band."""

from __future__ import annotations

import pytest

from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.grading import Grade, grade_candidates


def _settings() -> Settings:
    # Code defaults: correct=0.70, incorrect=0.30, rerank_top_k=5.
    return Settings(_env_file=None)


def _rc(score: float) -> RetrievedChunk:
    chunk = Chunk(doc_id="d", text="t", raw_text="passage text", position=0)
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


async def test_no_candidates_is_incorrect() -> None:
    g = await grade_candidates("q", [], _settings())
    assert g.label == "incorrect"
    assert g.confidence == 0.0


async def test_high_score_is_correct_without_llm() -> None:
    async def boom(_q: str, _s: list[str]) -> tuple[str, str]:
        raise AssertionError("LLM must not be called on a decisive score")

    g = await grade_candidates("q", [_rc(5.0)], _settings(), llm_judge=boom)
    assert g.label == "correct"
    assert g.confidence > 0.70


async def test_low_score_is_incorrect_without_llm() -> None:
    async def boom(_q: str, _s: list[str]) -> tuple[str, str]:
        raise AssertionError("LLM must not be called on a decisive score")

    g = await grade_candidates("q", [_rc(-5.0)], _settings(), llm_judge=boom)
    assert g.label == "incorrect"
    assert g.confidence < 0.30


async def test_mid_score_consults_llm_judge() -> None:
    seen: dict[str, object] = {}

    async def judge(q: str, snippets: list[str]) -> tuple[str, str]:
        seen.update(q=q, snippets=snippets)
        return "ambiguous", "covers the topic generally, not the specific case"

    g = await grade_candidates("the q", [_rc(0.0)], _settings(), llm_judge=judge)
    assert g.label == "ambiguous"
    assert 0.30 < g.confidence < 0.70  # sigmoid(0) == 0.5, inside the band
    assert g.reason.startswith("covers the topic")
    assert seen["q"] == "the q"
    assert seen["snippets"] == ["passage text"]


async def test_llm_judge_may_upgrade_to_correct() -> None:
    async def judge(_q: str, _s: list[str]) -> tuple[str, str]:
        return "correct", "passages fully answer it"

    g = await grade_candidates("q", [_rc(0.0)], _settings(), llm_judge=judge)
    assert g.label == "correct"


async def test_returns_grade_dataclass() -> None:
    g = await grade_candidates("q", [], _settings())
    assert isinstance(g, Grade)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_grading.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'sovereign_rag.retrieval.grading'`.

- [ ] **Step 3: Implement the grader**

Create `src/sovereign_rag/retrieval/grading.py`:

```python
"""Hybrid retrieval grader for Corrective RAG.

Grades the *reranked* candidates so it reads the calibrated cross-encoder
relevance score (``RetrievedChunk.score`` with ``source="reranked"``) rather
than a fresh model. The score is sigmoid-normalized to (0, 1) so the
thresholds are stable and interpretable:

    norm(top1) >= crag_correct_threshold   → "correct"   (no LLM)
    norm(top1) <= crag_incorrect_threshold → "incorrect" (no LLM)
    in between                             → one light-tier LLM call decides

Pure and service-free: the LLM call is injected as ``llm_judge`` so unit tests
(and the eval harness) run offline. Stores nothing — the node flattens the
returned ``Grade`` into ``RAGState`` primitives.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from sovereign_rag.config import Settings
    from sovereign_rag.documents import RetrievedChunk

GradeLabel = Literal["correct", "ambiguous", "incorrect"]

# An injectable async judge: (question, top-k snippets) -> (label, one-line reason).
LlmJudge = Callable[[str, list[str]], Awaitable[tuple[GradeLabel, str]]]


@dataclass(slots=True)
class Grade:
    """The grader's verdict. ``confidence`` is the normalized top-1 score (0..1)
    regardless of which path produced the label, so the UI always has a number."""

    label: GradeLabel
    confidence: float
    reason: str


def _sigmoid(x: float) -> float:
    """Numerically-stable logistic squash of an unbounded reranker logit."""
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


async def grade_candidates(
    question: str,
    reranked: list[RetrievedChunk],
    settings: Settings,
    *,
    llm_judge: LlmJudge | None = None,
) -> Grade:
    """Grade the reranked context. See module docstring for the band logic."""
    if not reranked:
        return Grade("incorrect", 0.0, "no candidates retrieved")

    top1 = _sigmoid(float(reranked[0].score))
    if top1 >= settings.crag_correct_threshold:
        return Grade("correct", top1, "top reranked chunk is a strong match")
    if top1 <= settings.crag_incorrect_threshold:
        return Grade("incorrect", top1, "top reranked chunk is a weak match")

    judge = llm_judge or _default_llm_judge
    snippets = [rc.chunk.raw_text[:240] for rc in reranked[: settings.rerank_top_k]]
    label, reason = await judge(question, snippets)
    return Grade(label, top1, reason)


async def _default_llm_judge(question: str, snippets: list[str]) -> tuple[GradeLabel, str]:
    """Light-tier structured grade for the uncertain middle band."""
    from typing import cast

    from pydantic import BaseModel, Field

    from sovereign_rag.config import get_settings
    from sovereign_rag.shared.llm_factory import ModelTier, get_chat_model

    class _Verdict(BaseModel):
        label: GradeLabel = Field(
            description="'correct' if the passages fully answer the question, "
            "'incorrect' if they are irrelevant, otherwise 'ambiguous'."
        )
        reason: str = Field(description="one short sentence explaining the label")

    s = get_settings()
    llm = get_chat_model(model_tier=cast(ModelTier, s.crag_grader_tier))
    structured = llm.with_structured_output(_Verdict)
    context = "\n\n".join(f"[{i + 1}] {t}" for i, t in enumerate(snippets))
    prompt = (
        f"Question: {question}\n\n"
        f"Retrieved passages:\n{context}\n\n"
        "Judge whether these passages are sufficient to answer the question."
    )
    verdict = cast(_Verdict, await structured.ainvoke(prompt))
    return verdict.label, verdict.reason


__all__ = ["Grade", "GradeLabel", "LlmJudge", "grade_candidates"]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run pytest tests/test_grading.py -v`
Expected: PASS (6 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/retrieval/grading.py tests/test_grading.py
git commit -m "feat(crag): hybrid retrieval grader (threshold short-circuit + LLM band)"
```

---

## Task 3: RAGState fields

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/state.py`
- Test: covered by Tasks 4–11 (state is a `TypedDict`; no standalone test).

- [ ] **Step 1: Add the fields**

In `src/sovereign_rag/graphs/rag_qa/state.py`, add `from __future__` already present; extend the imports and the class. Replace the existing `class RAGState(...)` body's `-- working state --` and `-- output --` regions by inserting the CRAG fields. The full edited class:

```python
class RAGState(TypedDict, total=False):
    """State threaded through the QA graph.

    ``total=False`` so each node can return a partial dict — LangGraph merges
    by key into the running state.
    """

    # -- input --
    question: str
    doc_id: str | None  # optional restriction to one source document

    # -- working state --
    candidates: list[RetrievedChunk]
    reranked: list[RetrievedChunk]

    # -- CRAG: grade --
    grade: str  # "correct" | "ambiguous" | "incorrect"
    grade_confidence: float  # normalized top-1 reranker score, 0..1
    grade_reason: str  # one-line, surfaced to the UI

    # -- CRAG: correction loop --
    correction_attempts: int  # loop guard; incremented in crawl_index
    search_query: str  # rewritten web query
    candidate_urls: list[dict[str, str]]  # [{title, url, snippet}]
    approved_urls: list[str]  # resume value; [] == decline
    web_ingested: int  # chunks indexed this correction
    fallback_used: bool  # web contributed to the answer
    declined: bool  # human declined the web search

    # -- output --
    answer: str
    citations: list[Citation]
    retrieved: int  # candidates before rerank (post-dedup)
    used: int  # citations actually surfaced
```

- [ ] **Step 2: Verify it imports**

Run: `uv run python -c "from sovereign_rag.graphs.rag_qa.state import RAGState; print('ok')"`
Expected: prints `ok`.

- [ ] **Step 3: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/state.py
git commit -m "feat(crag): extend RAGState with grade + correction-loop fields"
```

---

## Task 4: `grade` node + `route_after_grade`

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing tests**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# grade + route_after_grade
# ---------------------------------------------------------------------------
class TestGrade:
    async def test_writes_grade_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from sovereign_rag.retrieval.grading import Grade

        async def fake_grade(question, reranked, settings, **kw):  # type: ignore[no-untyped-def]
            return Grade("ambiguous", 0.46, "thin coverage")

        monkeypatch.setattr(agent_nodes, "grade_candidates", fake_grade)
        out = await agent_nodes.grade({"question": "q", "reranked": [_rc("a", 0.4)]})
        assert out["grade"] == "ambiguous"
        assert out["grade_confidence"] == 0.46
        assert out["grade_reason"] == "thin coverage"


class TestRouteAfterGrade:
    def test_correct_goes_to_generate(self) -> None:
        assert (
            agent_nodes.route_after_grade({"grade": "correct", "correction_attempts": 0})
            == "generate"
        )

    def test_weak_under_budget_goes_to_transform(self) -> None:
        assert (
            agent_nodes.route_after_grade({"grade": "ambiguous", "correction_attempts": 0})
            == "transform_query"
        )

    def test_weak_at_budget_goes_to_generate(self) -> None:
        # default crag_max_corrections == 1, so attempts==1 is exhausted
        assert (
            agent_nodes.route_after_grade({"grade": "incorrect", "correction_attempts": 1})
            == "generate"
        )

    def test_disabled_always_generates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
        assert (
            agent_nodes.route_after_grade({"grade": "incorrect", "correction_attempts": 0})
            == "generate"
        )
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestGrade tests/test_rag_qa.py::TestRouteAfterGrade -v`
Expected: FAIL — `AttributeError: module ... has no attribute 'grade'` / `'route_after_grade'`.

- [ ] **Step 3: Implement**

In `src/sovereign_rag/graphs/rag_qa/nodes.py`, add to the imports near the top:

```python
from typing import Literal

from sovereign_rag.retrieval.grading import grade_candidates
```

Then add these two functions (place after `do_rerank`):

```python
# ---------------------------------------------------------------------------
# Node: grade  (CRAG)
# ---------------------------------------------------------------------------
async def grade(state: RAGState) -> dict[str, object]:
    """Grade the reranked context; flatten the Grade into state primitives."""
    s = get_settings()
    reranked = state.get("reranked") or []
    g = await grade_candidates(state["question"], reranked, s)
    logger.info("grade: %s (%.3f) — %s", g.label, g.confidence, g.reason)
    return {
        "grade": g.label,
        "grade_confidence": g.confidence,
        "grade_reason": g.reason,
    }


def route_after_grade(state: RAGState) -> Literal["transform_query", "generate"]:
    """Conditional edge after grade. Weak + under the correction budget → correct
    via the web; otherwise answer with what we have."""
    s = get_settings()
    if not s.enable_corrective_rag:
        return "generate"
    label = state.get("grade")
    attempts = state.get("correction_attempts", 0)
    if label in ("ambiguous", "incorrect") and attempts < s.crag_max_corrections:
        return "transform_query"
    return "generate"
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestGrade tests/test_rag_qa.py::TestRouteAfterGrade -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): grade node + route_after_grade conditional"
```

---

## Task 5: `transform_query` node

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# transform_query
# ---------------------------------------------------------------------------
class TestTransformQuery:
    async def test_rewrites_via_light_llm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="FERRET activation codeword provisioning")
        captured: dict[str, Any] = {}

        def fake_get(**kwargs: Any) -> Any:
            captured.update(kwargs)
            return fake_llm

        monkeypatch.setattr(agent_nodes, "get_chat_model", fake_get)
        out = await agent_nodes.transform_query(
            {"question": "how is FERRET's activation codeword provisioned?"}
        )
        assert out["search_query"] == "FERRET activation codeword provisioning"
        assert captured["model_tier"] == "light"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestTransformQuery -v`
Expected: FAIL — `AttributeError: ... has no attribute 'transform_query'`.

- [ ] **Step 3: Implement**

Add to `nodes.py` (after `route_after_grade`):

```python
# ---------------------------------------------------------------------------
# Node: transform_query  (CRAG)
# ---------------------------------------------------------------------------
_REWRITE_SYSTEM = (
    "Rewrite the user's question as a concise web search query. "
    "Return only the query — keywords, no punctuation, no explanation."
)


async def transform_query(state: RAGState) -> dict[str, object]:
    """Light-tier rewrite of the question into a keyword web-search query."""
    llm = get_chat_model(model_tier="light")
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_REWRITE_SYSTEM),
            HumanMessage(content=state["question"]),
        ]
    )
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    query = text.strip() or state["question"]
    logger.info("transform_query: %r", query)
    return {"search_query": query}
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestTransformQuery -v`
Expected: PASS (1 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): transform_query node (light-tier query rewrite)"
```

---

## Task 6: `web_search` node

Side-effecting (SearXNG) but **no** `interrupt()` — so a resume never re-runs it.

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# web_search
# ---------------------------------------------------------------------------
class TestWebSearch:
    async def test_searches_and_maps_candidates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict[str, Any] = {}

        async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
            captured.update(query=query, max_results=max_results)
            return [
                {"title": "Secret Key", "url": "https://1password.com/sk", "content": "snippet a"},
                {"title": "Activation", "url": "https://anthropic.com/x", "content": "snippet b"},
            ]

        monkeypatch.setattr(agent_nodes, "search", fake_search)
        out = await agent_nodes.web_search({"question": "q", "search_query": "ferret codeword"})
        assert captured["query"] == "ferret codeword"
        assert out["candidate_urls"][0] == {
            "title": "Secret Key",
            "url": "https://1password.com/sk",
            "snippet": "snippet a",
        }
        assert len(out["candidate_urls"]) == 2

    async def test_falls_back_to_question_when_no_query(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
            return []

        monkeypatch.setattr(agent_nodes, "search", fake_search)
        out = await agent_nodes.web_search({"question": "the question"})
        assert out["candidate_urls"] == []
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestWebSearch -v`
Expected: FAIL — `AttributeError: ... has no attribute 'web_search'`.

- [ ] **Step 3: Implement**

Add to `nodes.py` imports:

```python
from sovereign_rag.ingestion.search import search
```

Add the node (after `transform_query`):

```python
# ---------------------------------------------------------------------------
# Node: web_search  (CRAG) — SearXNG only; the interrupt lives in request_approval
# ---------------------------------------------------------------------------
async def web_search(state: RAGState) -> dict[str, object]:
    """Search the web for candidate URLs. No interrupt here, so resuming the
    graph never re-runs this network call (the resumed node is request_approval)."""
    s = get_settings()
    query = state.get("search_query") or state["question"]
    hits = await search(query, max_results=s.web_fallback_max_urls)
    candidates = [
        {"title": h.get("title", ""), "url": h["url"], "snippet": h.get("content", "")}
        for h in hits
        if h.get("url")
    ]
    logger.info("web_search: %d candidate urls for %r", len(candidates), query)
    return {"candidate_urls": candidates}
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestWebSearch -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): web_search node (SearXNG candidate URLs)"
```

---

## Task 7: `request_approval` node (interrupt + Command routing)

The only node that calls `interrupt()`. It does no I/O before the interrupt, so re-running it on resume is safe. The resume-parsing is factored into a pure helper so it's unit-testable without a running graph; the interrupt + routing itself is exercised at the graph level in Task 11.

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# request_approval — resume parsing helper
# ---------------------------------------------------------------------------
class TestParseResume:
    def test_dict_with_urls_is_approve(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": ["https://a", "https://b"]}) == [
            "https://a",
            "https://b",
        ]

    def test_empty_list_is_decline(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": []}) == []

    def test_none_is_decline(self) -> None:
        assert agent_nodes._parse_resume(None) == []

    def test_non_dict_is_decline(self) -> None:
        assert agent_nodes._parse_resume("nonsense") == []

    def test_non_string_urls_filtered(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": ["https://a", 5, None]}) == [
            "https://a"
        ]
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestParseResume -v`
Expected: FAIL — `AttributeError: ... has no attribute '_parse_resume'`.

- [ ] **Step 3: Implement**

Add to `nodes.py` imports:

```python
from langgraph.types import Command, interrupt
```

Add the helper + node (after `web_search`):

```python
# ---------------------------------------------------------------------------
# Node: request_approval  (CRAG / HITL) — the only interrupt() in the graph
# ---------------------------------------------------------------------------
def _parse_resume(resume: object) -> list[str]:
    """Normalize the Command(resume=...) payload into a list of approved URLs.

    Approve → non-empty list of URL strings. Decline → empty list (any other
    shape — None, non-dict, non-string items — degrades to decline)."""
    if not isinstance(resume, dict):
        return []
    urls = resume.get("approved_urls")
    if not isinstance(urls, list):
        return []
    return [u for u in urls if isinstance(u, str) and u]


async def request_approval(state: RAGState) -> Command[Literal["crawl_index", "generate"]]:
    """Pause for human URL approval, then branch.

    APPROVE (non-empty urls) → crawl_index (loops back to retrieve_local).
    DECLINE ([] or anything else) → generate, answering from the local corpus.

    No I/O precedes interrupt(), so the mandatory node re-run on resume is a
    no-op replay — the SearXNG search already ran in web_search."""
    decision = interrupt(
        {
            "reason": "approve_urls",
            "question": state["question"],
            "grade": {
                "label": state.get("grade"),
                "confidence": state.get("grade_confidence"),
                "reason": state.get("grade_reason"),
            },
            "candidate_urls": state.get("candidate_urls", []),
        }
    )
    approved = _parse_resume(decision)
    if approved:
        logger.info("request_approval: APPROVED %d urls", len(approved))
        return Command(goto="crawl_index", update={"approved_urls": approved})
    logger.info("request_approval: DECLINED")
    return Command(
        goto="generate",
        update={"approved_urls": [], "declined": True, "fallback_used": False},
    )
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestParseResume -v`
Expected: PASS (5 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): request_approval node (interrupt + approve/decline routing)"
```

---

## Task 8: `crawl_index` node

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# crawl_index
# ---------------------------------------------------------------------------
class TestCrawlIndex:
    async def test_crawls_indexes_and_increments_attempts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        crawled: list[str] = []

        async def fake_crawl(url: str) -> Any:
            crawled.append(url)
            return MagicMock(name=f"doc::{url}")

        pipe = MagicMock()
        pipe.index_document = AsyncMock(side_effect=[18, 23])
        monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.crawl_index(
            {"approved_urls": ["https://a", "https://b"], "correction_attempts": 0}
        )
        assert crawled == ["https://a", "https://b"]
        assert out["web_ingested"] == 41
        assert out["fallback_used"] is True
        assert out["correction_attempts"] == 1

    async def test_skips_failed_crawls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_crawl(url: str) -> Any:
            if "bad" in url:
                raise RuntimeError("403")
            return MagicMock()

        pipe = MagicMock()
        pipe.index_document = AsyncMock(return_value=10)
        monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.crawl_index(
            {"approved_urls": ["https://bad", "https://ok"], "correction_attempts": 0}
        )
        assert out["web_ingested"] == 10  # only the one that succeeded
        assert out["fallback_used"] is True

    async def test_no_urls_indexes_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pipe = MagicMock()
        pipe.index_document = AsyncMock(side_effect=AssertionError("should not index"))
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)
        out = await agent_nodes.crawl_index({"approved_urls": [], "correction_attempts": 0})
        assert out["web_ingested"] == 0
        assert out["fallback_used"] is False
        assert out["correction_attempts"] == 1
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestCrawlIndex -v`
Expected: FAIL — `AttributeError: ... has no attribute 'crawl_index'`.

- [ ] **Step 3: Implement**

Add to `nodes.py` imports:

```python
from sovereign_rag.ingestion.web import crawl_url
```

Add the node (after `request_approval`):

```python
# ---------------------------------------------------------------------------
# Node: crawl_index  (CRAG) — crawl approved URLs, index, increment the guard
# ---------------------------------------------------------------------------
async def crawl_index(state: RAGState) -> dict[str, object]:
    """Crawl each approved URL and index it via the pipeline, then bump the
    correction counter. A single bad URL is logged and skipped, never fatal.
    Always loops back to retrieve_local (the conditional guard already decided
    we may correct, and the counter stops a second round)."""
    pipe = get_pipeline()
    urls = state.get("approved_urls") or []
    attempts = state.get("correction_attempts", 0)
    total = 0
    for url in urls:
        try:
            doc = await crawl_url(url)
            total += await pipe.index_document(doc)
        except Exception:  # noqa: BLE001 — one bad URL must not sink the batch
            logger.warning("crawl_index: skipping URL that failed: %s", url, exc_info=True)
    logger.info("crawl_index: indexed %d chunks from %d urls", total, len(urls))
    return {
        "web_ingested": total,
        "fallback_used": total > 0,
        "correction_attempts": attempts + 1,
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestCrawlIndex -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): crawl_index node (crawl approved URLs, index, bump guard)"
```

---

## Task 9: `generate` low-confidence note

When corrections were exhausted or the human declined and the grade is still weak, append a one-line caveat so the answer is honest about lower confidence.

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py` (the existing `generate`)
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
# ---------------------------------------------------------------------------
# generate — low-confidence caveat
# ---------------------------------------------------------------------------
class TestGenerateCaveat:
    async def test_declined_weak_grade_appends_caveat(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id="c1")
        reranked = [RetrievedChunk(chunk=chunk, score=0.4, source="reranked")]
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="Partial answer [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate(
            {"question": "q", "reranked": reranked, "grade": "ambiguous", "declined": True}
        )
        assert "Partial answer [1]." in out["answer"]
        assert "confidence" in out["answer"].lower()

    async def test_correct_grade_no_caveat(self, monkeypatch: pytest.MonkeyPatch) -> None:
        chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id="c1")
        reranked = [RetrievedChunk(chunk=chunk, score=0.9, source="reranked")]
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="Full answer [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate({"question": "q", "reranked": reranked, "grade": "correct"})
        assert out["answer"] == "Full answer [1]."
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestGenerateCaveat -v`
Expected: FAIL — the declined case has no caveat appended yet.

- [ ] **Step 3: Implement**

In `nodes.py`, in `generate`, replace the final `return` block. The current code ends:

```python
    answer_text = resp.content if isinstance(resp.content, str) else str(resp.content)
    return {
        "answer": answer_text.strip(),
        "citations": citations,
        "used": len(citations),
    }
```

Replace it with:

```python
    answer_text = resp.content if isinstance(resp.content, str) else str(resp.content)
    answer_text = answer_text.strip()
    # Honesty caveat: we answered on a weak grade (corrections exhausted or
    # the human declined the web search). Doesn't fire on a "correct" grade.
    if state.get("grade") in ("ambiguous", "incorrect"):
        if state.get("declined"):
            answer_text += "\n\n_Confidence is lower than usual — the web was not consulted._"
        elif not state.get("fallback_used"):
            answer_text += "\n\n_Confidence is lower than usual — local sources were thin._"
    return {
        "answer": answer_text,
        "citations": citations,
        "used": len(citations),
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestGenerateCaveat -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): generate appends a low-confidence caveat on weak grades"
```

---

## Task 10: Graph wiring (conditional topology)

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/graph.py`
- Test: `tests/test_rag_qa_graph.py` (created next task; this task is a structural change verified by import + the Task 11/12 tests)

- [ ] **Step 1: Update `_build_state_graph`**

In `src/sovereign_rag/graphs/rag_qa/graph.py`, replace the imports of nodes and the `_build_state_graph` function.

Replace the existing node import block:

```python
from sovereign_rag.graphs.rag_qa.nodes import (
    do_rerank,
    generate,
    retrieve_local,
)
```

with:

```python
from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa.nodes import (
    crawl_index,
    do_rerank,
    generate,
    grade,
    request_approval,
    retrieve_local,
    route_after_grade,
    transform_query,
    web_search,
)
```

Replace the entire `_build_state_graph` function with:

```python
def _build_state_graph() -> StateGraph[RAGState]:
    """Construct the uncompiled StateGraph.

    Topology depends on ``enable_corrective_rag`` (a build-time structural
    flag). When off, the original linear graph is built unchanged::

        START → retrieve_local → rerank → generate → END

    When on, the self-correcting CRAG loop is added::

        START → retrieve_local → rerank → grade
          grade ─correct/exhausted──────────────────────► generate → END
          grade ─weak & under budget─► transform_query → web_search
              → request_approval ─approve─► crawl_index → retrieve_local (loop)
              request_approval ─decline─► generate → END
    """
    builder: StateGraph[RAGState] = StateGraph(RAGState)
    builder.add_node("retrieve_local", retrieve_local)
    builder.add_node("rerank", do_rerank)
    builder.add_node("generate", generate)

    builder.add_edge(START, "retrieve_local")
    builder.add_edge("retrieve_local", "rerank")

    if not get_settings().enable_corrective_rag:
        builder.add_edge("rerank", "generate")
        builder.add_edge("generate", END)
        return builder

    builder.add_node("grade", grade)
    builder.add_node("transform_query", transform_query)
    builder.add_node("web_search", web_search)
    builder.add_node("request_approval", request_approval)
    builder.add_node("crawl_index", crawl_index)

    builder.add_edge("rerank", "grade")
    # route_after_grade returns one of these keys; the dict maps them to nodes
    # (kept identical for clarity + clean Studio rendering).
    builder.add_conditional_edges(
        "grade",
        route_after_grade,
        {"transform_query": "transform_query", "generate": "generate"},
    )
    builder.add_edge("transform_query", "web_search")
    builder.add_edge("web_search", "request_approval")
    # request_approval returns Command(goto="crawl_index" | "generate"); its
    # destinations are declared by the node's Command[Literal[...]] return type,
    # so no static edges are added from it.
    builder.add_edge("crawl_index", "retrieve_local")
    builder.add_edge("generate", END)
    return builder
```

- [ ] **Step 2: Verify both topologies compile**

Run:
```bash
uv run python -c "
import asyncio
from sovereign_rag.graphs.rag_qa.graph import make_graph
g = asyncio.run(make_graph())
print('nodes:', sorted(g.get_graph().nodes))
"
```
Expected: prints a node list including `grade`, `transform_query`, `web_search`, `request_approval`, `crawl_index` (CRAG on by default).

- [ ] **Step 3: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/graph.py
git commit -m "feat(crag): wire the corrective loop into the rag_qa graph (linear when disabled)"
```

---

## Task 11: Graph-level interrupt → resume → loop tests

The end-to-end proof: compile with `InMemorySaver`, stub every collaborator, and drive a weak-grade question through the interrupt and both resume branches. This is where `request_approval`'s `interrupt()` + `Command` routing and the `crawl_index → retrieve_local` loop are exercised.

**Files:**
- Create: `tests/test_rag_qa_graph.py`

- [ ] **Step 1: Write the failing tests**

Create `tests/test_rag_qa_graph.py`:

```python
"""Graph-level CRAG tests: interrupt, approve-loop, decline, loop guard.

Every collaborator (pipeline, rerank, grader, query-rewrite LLM, web search,
crawler, answer LLM) is stubbed so the suite is offline. The graph is compiled
with an InMemorySaver so interrupt()/Command(resume=...) work.
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import nodes as agent_nodes
from sovereign_rag.graphs.rag_qa.graph import _build_state_graph


def _rc(chunk_id: str, score: float, source: str = "reranked") -> RetrievedChunk:
    chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id=chunk_id)
    return RetrievedChunk(chunk=chunk, score=score, source=source)


@pytest.fixture
def stub_graph(monkeypatch: pytest.MonkeyPatch) -> Any:
    """A compiled CRAG graph with all node collaborators stubbed.

    grade_candidates always returns 'ambiguous' → the corrective path fires on
    every grade; the correction_attempts guard is what stops the loop.
    """
    from sovereign_rag.retrieval.grading import Grade

    pipe = MagicMock()
    pipe._milvus = MagicMock()
    pipe._milvus.hybrid_search = AsyncMock(return_value=[_rc("m1", 0.4)])
    pipe._graph = None
    pipe.index_document = AsyncMock(return_value=12)
    monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

    monkeypatch.setattr(agent_nodes, "rerank", lambda q, c, top_k=None: [_rc("m1", 0.4)])

    async def fake_grade(question, reranked, settings, **kw):  # type: ignore[no-untyped-def]
        return Grade("ambiguous", 0.46, "thin")

    monkeypatch.setattr(agent_nodes, "grade_candidates", fake_grade)

    async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
        return [{"title": "T", "url": "https://example.com/a", "content": "snip"}]

    monkeypatch.setattr(agent_nodes, "search", fake_search)

    async def fake_crawl(url: str) -> Any:
        return MagicMock()

    monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)

    fake_llm = AsyncMock()
    fake_llm.ainvoke.return_value = MagicMock(content="rewritten or answer text [1]")
    monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

    return _build_state_graph().compile(checkpointer=InMemorySaver())


def _config() -> dict[str, Any]:
    return {"configurable": {"thread_id": str(uuid.uuid4())}}


async def test_weak_grade_interrupts_with_candidate_urls(stub_graph: Any) -> None:
    result = await stub_graph.ainvoke({"question": "q"}, _config())
    assert "__interrupt__" in result
    payload = result["__interrupt__"][0].value
    assert payload["reason"] == "approve_urls"
    assert payload["candidate_urls"][0]["url"] == "https://example.com/a"
    assert payload["grade"]["label"] == "ambiguous"


async def test_approve_loops_then_answers(stub_graph: Any) -> None:
    cfg = _config()
    first = await stub_graph.ainvoke({"question": "q"}, cfg)
    assert "__interrupt__" in first
    final = await stub_graph.ainvoke(
        Command(resume={"approved_urls": ["https://example.com/a"]}), cfg
    )
    assert "__interrupt__" not in final  # max_corrections=1 → no second pause
    assert final["fallback_used"] is True
    assert final["correction_attempts"] == 1
    assert final["answer"]  # generate ran


async def test_decline_answers_from_local(stub_graph: Any) -> None:
    cfg = _config()
    await stub_graph.ainvoke({"question": "q"}, cfg)
    final = await stub_graph.ainvoke(Command(resume={"approved_urls": []}), cfg)
    assert "__interrupt__" not in final
    assert final["declined"] is True
    assert final["fallback_used"] is False
    # decline never reaches crawl_index, so the counter is never written:
    assert final.get("correction_attempts", 0) == 0


async def test_loop_guard_stops_after_max_corrections(stub_graph: Any) -> None:
    # grade is always 'ambiguous'; after one approved correction the guard
    # (crag_max_corrections=1) must route to generate, not interrupt again.
    cfg = _config()
    await stub_graph.ainvoke({"question": "q"}, cfg)
    final = await stub_graph.ainvoke(
        Command(resume={"approved_urls": ["https://example.com/a"]}), cfg
    )
    assert "__interrupt__" not in final
    assert final["answer"]
```

- [ ] **Step 2: Run to verify it fails (then drives the implementation)**

Run: `uv run pytest tests/test_rag_qa_graph.py -v`
Expected initially: PASS if Tasks 4–10 are complete. If any FAIL, the failure pinpoints a wiring bug (e.g. a missing edge or a bad `Command(goto=...)` target) — fix it in `nodes.py`/`graph.py` until green. This task is the integration gate for Tasks 4–10.

- [ ] **Step 3: Commit**

```bash
git add tests/test_rag_qa_graph.py
git commit -m "test(crag): graph-level interrupt/approve-loop/decline/guard tests"
```

---

## Task 12: Disabled-topology test (linear graph preserved)

**Files:**
- Modify: `tests/test_rag_qa_graph.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa_graph.py`:

```python
def test_disabled_builds_linear_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """enable_corrective_rag=False → no grade/correction nodes; the original
    retrieve→rerank→generate topology."""
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
    graph = _build_state_graph().compile()
    node_names = set(graph.get_graph().nodes)
    assert "grade" not in node_names
    assert "request_approval" not in node_names
    assert {"retrieve_local", "rerank", "generate"} <= node_names
```

- [ ] **Step 2: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa_graph.py::test_disabled_builds_linear_graph -v`
Expected: PASS. (If `get_settings()` is cached with CRAG on, the monkeypatch mutates the cached instance for the test's duration and restores after — the build reads the flag at call time.)

- [ ] **Step 3: Full suite + lint + types**

Run:
```bash
uv run pytest -m "not integration" -q
uv run ruff check src/ tests/
uv run mypy src/
```
Expected: all green. Fix any `mypy --strict` complaints (most likely: annotate the `Command[Literal[...]]` return, or `cast` the `crag_grader_tier` str→`ModelTier` already handled in Task 2).

- [ ] **Step 4: Commit**

```bash
git add tests/test_rag_qa_graph.py
git commit -m "test(crag): disabled flag preserves the linear topology"
```

---

## Self-review (completed against the spec)

**Spec coverage (Plan 1 scope = spec §5.1, §5.2, §6 RAGState, §7 config):**
- §7 config knobs → Task 1. ✅
- §5.2 hybrid grader → Task 2. ✅
- §6 `RAGState` fields → Task 3. ✅
- §5.1 nodes `grade`/`transform_query`/`web_search`/`crawl_index`/`generate` note → Tasks 4–9. ✅ (`web_search`'s interrupt split into `request_approval` per the best-practice note — behaviour identical.)
- §5.1 routing + bounded loop + linear-when-disabled → Tasks 10–12. ✅
- §5.1 checkpointer (interrupt needs one) → Task 11 uses `InMemorySaver`; prod `AsyncPostgresSaver` is unchanged and wired in Plan 2. ✅

**Deferred to later plans (intentionally not in Plan 1):** API interrupt-detection / `/ask/resume` / SSE `grade`+`interrupt`+`crawl_progress` (Plan 2); runs schema (Plan 2); eval graph-driven mode + auto-approver + fixtures (Plan 3); frontend (Plan 4); docs reconciliation (Plan 5). The graph-level tests in Task 11 prove the interrupt/resume contract that Plan 2's API will drive.

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `grade_candidates(question, reranked, settings, *, llm_judge=None) -> Grade` (Task 2) is called by the `grade` node (Task 4) with positional `question, reranked, s`. `_parse_resume(resume) -> list[str]` (Task 7) is used by `request_approval` and tested directly. `route_after_grade` returns the literals used as `add_conditional_edges` path-map keys (Task 10). `RAGState` keys written by nodes (`grade`, `grade_confidence`, `candidate_urls`, `approved_urls`, `web_ingested`, `fallback_used`, `declined`, `correction_attempts`) all exist in Task 3.

---

## Execution handoff

After this plan is approved, the remaining four plans should be written (each its own spec-derived plan) and executed in spec rollout order: **Plan 2** API+SSE+runs, **Plan 3** eval, **Plan 4** frontend, **Plan 5** docs. Plan 2's `/ask/stream` work must also decide whether to migrate the existing `astream_events(version="v2")` loop to the newer `stream_events(version="v3")` typed-projection API (cleaner `stream.interrupted`/`stream.interrupts` handling) or detect interrupts on v2 via `result["__interrupt__"]` / `aget_state` — capture that decision in Plan 2.

**Carried into Plan 2 from Plan 1's final review:**
- **C1 — flip the default on.** Plan 1 ships `enable_corrective_rag=False` so merging to the auto-deploying `main` keeps prod on the linear graph. Plan 2 owns flipping it to default-on (or per-deploy enabling it) **only after** `/ask` returns `status:"interrupted"`, `/ask/resume` is live, and `/ask/stream` handles the `grade`/`interrupt`/`crawl_progress` events — otherwise the running app silently swallows interrupts (returns `answer:null`) and parks them in prod Postgres.
- **M1 — checkpoint serialization.** Heavy `RetrievedChunk`/`Citation` dataclasses in `RAGState` already emit a msgpack "Deserializing unregistered type … will be blocked in a future version" warning on `main`. It becomes load-bearing once interrupt state persists across a human pause (the `candidates`/`reranked` lists sit in prod Postgres for the duration of the pause). Plan 2 should register a `SerializerProtocol`/allowed-modules for these types, or keep heavy retrieval objects out of checkpointed state.
