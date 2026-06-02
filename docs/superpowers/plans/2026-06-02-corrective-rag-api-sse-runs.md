# Corrective RAG — API + SSE + Runs (Plan 2 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the FastAPI layer drive the CRAG graph's human-in-the-loop pause — so `/ask` returns `status:"interrupted"` with candidate URLs, `/ask/resume` (and a streaming variant) resumes with the human's approve/decline decision, the SSE stream surfaces `grade` / `interrupt` / per-URL `crawl_progress` events, and every completed run is recorded with its CRAG fields.

**Architecture:** Extend `api/ask` and `api/runs` (no graph topology changes except adding a custom-event emit inside the existing `crawl_index` node). Keep the existing `astream_events(version="v2")` streaming loop — it already streams tokens and per-node timings — and add: a `grade` SSE event off the grade node's `on_chain_end`; interrupt detection via `aget_state(config)` after the stream (the top-level `on_chain_end` does not fire on a pause); per-URL `crawl_progress` via LangChain custom events surfaced as `on_custom_event`. `/ask` (non-stream) detects the pause via `result["__interrupt__"]`. Resume passes `Command(resume={"approved_urls": [...]})` on the same `thread_id`. Runs are recorded only on **final** completion (a pause is not a run). The `runs` table grows CRAG columns via lazy `ALTER ... IF NOT EXISTS`.

**Tech Stack:** Python 3.12 · FastAPI · LangGraph 1.x (`interrupt`/`Command` from `langgraph.types`, `astream_events` v2, `aget_state`) · `langchain_core` custom events (`adispatch_custom_event`) · psycopg / Postgres · pytest (async) · uv.

**Scope note:** Plan **2 of 5**. Depends on Plan 1 (the CRAG graph, on branch `feat/corrective-rag-backend`). Out of scope: eval (Plan 3), frontend (Plan 4), README/architecture/CLAUDE.md reconciliation (Plan 5). Spec: `docs/superpowers/specs/2026-06-02-corrective-rag-hitl-design.md` §5.3, §5.5, §6.

**Enablement (important):** Plan 1 ships `enable_corrective_rag=False`, so the prod graph is linear and never interrupts. This plan makes the API *able* to handle interrupts; it does **not** flip the default on. Enabling CRAG in prod stays a deliberate ops decision (set `ENABLE_CORRECTIVE_RAG=true` on the deploy), ideally after Plan 3's eval proves the lift. Every test here that needs the interrupting graph builds it explicitly with the flag on — never relying on the default.

**Conventions:** Conventional-commit messages, **no `Co-Authored-By` footer**. `uv run pytest -m "not integration"`; `uv run ruff check`; `uv run mypy src/`. Match existing `api/ask/router.py` patterns (the `_apply_overrides` contextmanager, `record_run`, `_sse` helper).

---

## Background: exactly what exists today (Plan 1 result)

- The graph (built with `enable_corrective_rag=True`) is `retrieve_local → rerank → grade →[correct]→ generate` or `→[weak]→ transform_query → web_search → request_approval(interrupt) →[approve]→ crawl_index → loop / [decline]→ generate`. Proven at graph level with `InMemorySaver`.
- `request_approval` calls `interrupt({"reason":"approve_urls","question":...,"grade":{"label","confidence","reason"},"candidate_urls":[{title,url,snippet},...]})`. Resume value is read as `{"approved_urls": [...]}` (empty = decline).
- `RAGState` carries `grade`, `grade_confidence`, `grade_reason`, `correction_attempts`, `candidate_urls`, `approved_urls`, `web_ingested`, `fallback_used`, `declined`.
- `api/ask/router.py`: `/ask` does `state = await graph.ainvoke(initial, config)`; `/ask/stream` runs `_stream_generator` which iterates `graph.astream_events(initial, config, version="v2")` emitting `open`/`token`/`node`(start|done, for `{retrieve_local,rerank,generate}`)/`citations`/`done`/`error`, then `record_run`. `AskResponse.status` is `Literal["ok"]` only.
- `api/runs/service.py`: `runs` table (`_CREATE_SQL`), `record_run(...)`, `list_runs(...)`. `api/runs/router.py`: `RunRow` model + `/api/runs`.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `src/sovereign_rag/api/ask/schemas.py` | interrupted status, interrupt/grade models, resume request | modify |
| `src/sovereign_rag/api/ask/router.py` | interrupt detection, `/ask/resume`(+stream), SSE grade/interrupt/crawl_progress, CRAG fields to record_run | modify |
| `src/sovereign_rag/graphs/rag_qa/nodes.py` | `crawl_index` emits per-URL `crawl_progress` custom events | modify |
| `src/sovereign_rag/api/runs/service.py` | ALTER columns; record_run/list_runs carry CRAG fields | modify |
| `src/sovereign_rag/api/runs/router.py` | `RunRow` gains CRAG fields | modify |
| `tests/test_custom_events.py` | verify the custom-event mechanism surfaces in astream_events v2 | **create** |
| `tests/test_ask_interrupt.py` | /ask interrupted shape, /ask/resume approve+decline, SSE events | **create** |
| `tests/test_runs_crag.py` | runs round-trip with CRAG columns (unit, pool mocked) | **create** |

---

## Task 1: Verify the custom-event mechanism (de-risk crawl_progress first)

Before wiring per-URL progress, prove that a custom event dispatched inside a node **surfaces in `astream_events(version="v2")`** as `on_custom_event` — the streaming loop already uses v2, so this is the lowest-risk path. This is a spike encoded as a test.

**Files:**
- Create: `tests/test_custom_events.py`

- [ ] **Step 1: Write the test that asserts the mechanism**

```python
"""Confirm langchain_core custom events surface in astream_events v2.

This pins the mechanism crawl_index uses to emit per-URL crawl_progress.
If this ever breaks on a dependency bump, the streaming progress UI loses
its per-URL events — so we assert it explicitly.
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class _S(TypedDict, total=False):
    x: int


async def test_custom_event_surfaces_in_astream_events_v2() -> None:
    async def emit(state: _S) -> dict[str, Any]:
        await adispatch_custom_event("crawl_progress", {"url": "https://a", "status": "indexed"})
        return {"x": 1}

    g = StateGraph(_S)
    g.add_node("emit", emit)
    g.add_edge(START, "emit")
    g.add_edge("emit", END)
    compiled = g.compile()

    seen: list[dict[str, Any]] = []
    async for ev in compiled.astream_events({"x": 0}, version="v2"):
        if ev.get("event") == "on_custom_event" and ev.get("name") == "crawl_progress":
            seen.append(ev.get("data") or {})

    assert seen == [{"url": "https://a", "status": "indexed"}]
```

- [ ] **Step 2: Run it**

Run: `uv run pytest tests/test_custom_events.py -v`

Expected: **PASS**. If it FAILS (the event doesn't surface as `on_custom_event`), STOP and switch the approach for Tasks 4/6 to `langgraph.config.get_stream_writer()` + migrate `_stream_generator` to `graph.astream(stream_mode=["messages","updates","custom"])`; record the change in the plan before continuing. (Python is 3.12 here, so `adispatch_custom_event`'s contextvar propagation works.)

- [ ] **Step 3: Commit**

```bash
git add tests/test_custom_events.py
git commit -m "test(crag): pin custom-event surfacing in astream_events v2"
```

---

## Task 2: Schemas — interrupted status + interrupt/grade/resume models

**Files:**
- Modify: `src/sovereign_rag/api/ask/schemas.py`
- Test: `tests/test_ask_interrupt.py` (created here; grows in later tasks)

- [ ] **Step 1: Write the failing test**

Create `tests/test_ask_interrupt.py`:

```python
"""CRAG API: schema shapes + interrupt/resume behavior."""

from __future__ import annotations

from sovereign_rag.api.ask.schemas import (
    AskResponse,
    CandidateUrl,
    GradeModel,
    InterruptModel,
    ResumeRequest,
)


def test_ask_response_supports_interrupted_status() -> None:
    r = AskResponse(
        thread_id="t1",
        status="interrupted",
        interrupt=InterruptModel(
            reason="approve_urls",
            candidate_urls=[
                CandidateUrl(url="https://a", title="A", snippet="s"),
                CandidateUrl(url="https://b", title="B", snippet="s2", verified=False),
            ],
        ),
        grade=GradeModel(label="ambiguous", confidence=0.46, reason="thin"),
    )
    assert r.status == "interrupted"
    assert r.answer is None
    assert r.interrupt is not None
    assert r.interrupt.candidate_urls[0].url == "https://a"
    assert r.interrupt.candidate_urls[1].verified is False
    assert r.grade is not None and r.grade.label == "ambiguous"
    assert r.fallback_used is False


def test_ask_response_ok_still_valid() -> None:
    r = AskResponse(thread_id="t", status="ok", answer="hi", fallback_used=True)
    assert r.status == "ok"
    assert r.interrupt is None
    assert r.fallback_used is True


def test_resume_request_defaults_and_decline() -> None:
    approve = ResumeRequest(thread_id="t", approved_urls=["https://a"])
    decline = ResumeRequest(thread_id="t", approved_urls=[])
    assert approve.approved_urls == ["https://a"]
    assert decline.approved_urls == []


def test_candidate_url_verified_optional() -> None:
    c = CandidateUrl(url="https://a", title="A", snippet="s")
    assert c.verified is None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ask_interrupt.py -v`
Expected: FAIL — `ImportError: cannot import name 'CandidateUrl'` (etc.).

- [ ] **Step 3: Implement the schema changes**

Replace the contents of `src/sovereign_rag/api/ask/schemas.py` with (keeping `AskOverrides`, `AskRequest`, `CitationModel` as-is and extending the rest):

```python
"""Ask request / response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AskOverrides(BaseModel):
    """Per-question knob overrides applied for the duration of a single /ask call.

    Each field is optional; ``None`` means "use the current Settings value".
    The override is restored after the request, so other in-flight calls (and
    the next call from the same client) see the saved Settings again.

    NOTE: applying overrides mutates the global ``Settings`` singleton during
    the request, so concurrent /ask calls with *different* overrides will race
    on the data plane. Fine for a single-user dev system; not safe for
    multi-tenant prod (will need a contextvar-scoped settings shim).
    """

    model: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="Override the LLM model for this call only. "
        "Format depends on provider (ollama tag or OpenAI model id).",
    )
    retrieve_top_k: int | None = Field(default=None, ge=1, le=500)
    rerank_top_k: int | None = Field(default=None, ge=1, le=50)
    enable_graph_retrieval: bool | None = None


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    doc_id: str | None = None
    # If supplied, the run is associated with this thread (for multi-turn).
    # Otherwise a fresh UUID is minted per call.
    thread_id: str | None = None
    overrides: AskOverrides | None = None


class CitationModel(BaseModel):
    chunk_id: str
    doc_id: str
    title: str
    source_uri: str
    page: int | None
    score: float
    snippet: str


class CandidateUrl(BaseModel):
    """One web result the human may approve for crawling."""

    url: str
    title: str
    snippet: str
    # Optional trust hint (e.g. domain not on a low-trust list). None = unknown;
    # the UI only renders an "unverified" badge when this is explicitly False.
    verified: bool | None = None


class GradeModel(BaseModel):
    """The retrieval grade surfaced to the client."""

    label: Literal["correct", "ambiguous", "incorrect"]
    confidence: float
    reason: str


class InterruptModel(BaseModel):
    """Payload when the graph paused for human URL approval."""

    reason: Literal["approve_urls"]
    candidate_urls: list[CandidateUrl] = Field(default_factory=list)


class ResumeRequest(BaseModel):
    """Body for /ask/resume. ``approved_urls`` non-empty = approve those;
    ``[]`` = decline (answer from the local corpus only)."""

    thread_id: str = Field(min_length=1)
    approved_urls: list[str] = Field(default_factory=list)


class AskResponse(BaseModel):
    thread_id: str
    status: Literal["ok", "interrupted"]
    answer: str | None = None
    citations: list[CitationModel] = Field(default_factory=list)
    retrieved: int = 0
    used: int = 0
    fallback_used: bool = False
    grade: GradeModel | None = None
    interrupt: InterruptModel | None = None


__all__ = [
    "AskOverrides",
    "AskRequest",
    "AskResponse",
    "CandidateUrl",
    "CitationModel",
    "GradeModel",
    "InterruptModel",
    "ResumeRequest",
]
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_ask_interrupt.py -v`
Expected: PASS (4 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/ask/schemas.py tests/test_ask_interrupt.py
git commit -m "feat(crag): API schemas for interrupted status, candidate URLs, grade, resume"
```

---

## Task 3: `/ask` interrupt detection + a shared interrupt-extraction helper

**Files:**
- Modify: `src/sovereign_rag/api/ask/router.py`
- Test: `tests/test_ask_interrupt.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ask_interrupt.py`:

```python
import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest

from sovereign_rag.api.ask import router as ask_router


def _interrupt_obj(value: dict[str, Any]) -> Any:
    # Mimic langgraph.types.Interrupt: an object with a .value attribute.
    class _I:
        def __init__(self, v: dict[str, Any]) -> None:
            self.value = v

    return _I(value)


class TestExtractInterrupt:
    def test_pulls_reason_candidates_grade(self) -> None:
        state = {
            "__interrupt__": (
                _interrupt_obj(
                    {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [
                            {"title": "A", "url": "https://a", "snippet": "s"},
                        ],
                    }
                ),
            )
        }
        out = ask_router._extract_interrupt(state)
        assert out is not None
        interrupt, grade = out
        assert interrupt.reason == "approve_urls"
        assert interrupt.candidate_urls[0].url == "https://a"
        assert grade is not None and grade.label == "ambiguous"

    def test_no_interrupt_returns_none(self) -> None:
        assert ask_router._extract_interrupt({"answer": "done"}) is None


class TestAskEndpointInterrupt:
    async def test_ask_returns_interrupted_status(self, monkeypatch: pytest.MonkeyPatch) -> None:
        graph = AsyncMock()
        graph.ainvoke.return_value = {
            "__interrupt__": (
                _interrupt_obj(
                    {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [{"title": "A", "url": "https://a", "snippet": "s"}],
                    }
                ),
            )
        }
        # record_run must NOT be called for a pause.
        rec = AsyncMock(side_effect=AssertionError("a pause is not a completed run"))
        monkeypatch.setattr(ask_router, "record_run", rec)

        from sovereign_rag.api.ask.schemas import AskRequest

        resp = await ask_router.ask(AskRequest(question="q?"), graph)
        assert resp.status == "interrupted"
        assert resp.answer is None
        assert resp.interrupt is not None
        assert resp.interrupt.candidate_urls[0].url == "https://a"
        assert resp.grade is not None and resp.grade.label == "ambiguous"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ask_interrupt.py::TestExtractInterrupt tests/test_ask_interrupt.py::TestAskEndpointInterrupt -v`
Expected: FAIL — `AttributeError: module ... has no attribute '_extract_interrupt'`.

- [ ] **Step 3: Implement**

In `src/sovereign_rag/api/ask/router.py`:

Add imports (extend the existing schema import + add the new models):

```python
from sovereign_rag.api.ask.schemas import (
    AskOverrides,
    AskRequest,
    AskResponse,
    CandidateUrl,
    CitationModel,
    GradeModel,
    InterruptModel,
    ResumeRequest,
)
```

Add the helper (place after `_build_response`):

```python
def _extract_interrupt(
    state: dict[str, Any],
) -> tuple[InterruptModel, GradeModel | None] | None:
    """If the graph paused, build the InterruptModel (+ grade) from the state.

    ``ainvoke`` surfaces a pending interrupt under ``state["__interrupt__"]`` —
    a tuple of Interrupt objects whose ``.value`` is the payload our
    ``request_approval`` node passed to ``interrupt(...)``. Returns None when
    the state carries no interrupt.
    """
    interrupts = state.get("__interrupt__")
    if not interrupts:
        return None
    payload = getattr(interrupts[0], "value", None)
    if not isinstance(payload, dict):
        return None
    candidates = [
        CandidateUrl(
            url=str(c.get("url", "")),
            title=str(c.get("title", "")),
            snippet=str(c.get("snippet", "")),
            verified=c.get("verified"),
        )
        for c in (payload.get("candidate_urls") or [])
        if isinstance(c, dict) and c.get("url")
    ]
    interrupt = InterruptModel(reason="approve_urls", candidate_urls=candidates)
    grade_raw = payload.get("grade") or {}
    grade = None
    if isinstance(grade_raw, dict) and grade_raw.get("label"):
        grade = GradeModel(
            label=grade_raw["label"],
            confidence=float(grade_raw.get("confidence") or 0.0),
            reason=str(grade_raw.get("reason") or ""),
        )
    return interrupt, grade
```

Then in `ask(...)`, right after `state = await graph.ainvoke(initial, config=config)` (inside the `with _apply_overrides(...)` / after the try succeeds, before `_build_response`), insert the interrupt branch:

```python
    paused = _extract_interrupt(state)
    if paused is not None:
        interrupt, grade = paused
        # A pause is not a completed run — do not record_run here.
        return AskResponse(
            thread_id=thread_id,
            status="interrupted",
            answer=None,
            interrupt=interrupt,
            grade=grade,
        )
```

(Leave the existing success path — `_build_response` + `record_run` — untouched; it now only runs when there was no interrupt.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_ask_interrupt.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/ask/router.py tests/test_ask_interrupt.py
git commit -m "feat(crag): /ask returns status=interrupted with candidate URLs + grade"
```

---

## Task 4: `crawl_index` emits per-URL `crawl_progress` custom events

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/nodes.py`
- Test: `tests/test_rag_qa.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_rag_qa.py`:

```python
class TestCrawlIndexProgress:
    async def test_emits_crawl_progress_per_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        events: list[tuple[str, dict[str, Any]]] = []

        async def fake_dispatch(name: str, data: dict[str, Any], **_: Any) -> None:
            events.append((name, data))

        async def fake_crawl(url: str) -> Any:
            if "bad" in url:
                raise RuntimeError("403")
            return MagicMock()

        pipe = MagicMock()
        pipe.index_document = AsyncMock(return_value=7)
        monkeypatch.setattr(agent_nodes, "adispatch_custom_event", fake_dispatch)
        monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.crawl_index(
            {"approved_urls": ["https://ok", "https://bad"], "correction_attempts": 0}
        )

        names = [n for n, _ in events]
        # one "crawling" then a terminal status per url
        assert ("crawl_progress", {"url": "https://ok", "status": "crawling"}) in events
        assert ("crawl_progress", {"url": "https://ok", "status": "indexed", "chunks": 7}) in events
        assert ("crawl_progress", {"url": "https://bad", "status": "failed"}) in events
        assert names.count("crawl_progress") == 4  # 2 crawling + indexed + failed
        assert out["web_ingested"] == 7
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_rag_qa.py::TestCrawlIndexProgress -v`
Expected: FAIL — `AttributeError: ... has no attribute 'adispatch_custom_event'` (it's not imported/used yet).

- [ ] **Step 3: Implement**

In `src/sovereign_rag/graphs/rag_qa/nodes.py`, add the import:

```python
from langchain_core.callbacks.manager import adispatch_custom_event
```

Replace the body of `crawl_index` with the progress-emitting version (same return contract as Plan 1, plus per-URL events):

```python
async def crawl_index(state: RAGState) -> dict[str, object]:
    """Crawl each approved URL and index it via the pipeline, then bump the
    correction counter. Emits a ``crawl_progress`` custom event per URL
    (``crawling`` → ``indexed``/``failed``) so the SSE layer can render
    per-URL progress. A single bad URL is logged + skipped, never fatal.
    Always loops back to retrieve_local (the guard stops a second round)."""
    pipe = get_pipeline()
    urls = state.get("approved_urls") or []
    attempts = state.get("correction_attempts", 0)
    total = 0
    for url in urls:
        await adispatch_custom_event("crawl_progress", {"url": url, "status": "crawling"})
        try:
            doc = await crawl_url(url)
            n = await pipe.index_document(doc)
            total += n
            await adispatch_custom_event(
                "crawl_progress", {"url": url, "status": "indexed", "chunks": n}
            )
        except Exception:  # one bad URL must not sink the batch
            logger.warning("crawl_index: skipping URL that failed: %s", url, exc_info=True)
            await adispatch_custom_event("crawl_progress", {"url": url, "status": "failed"})
    logger.info("crawl_index: indexed %d chunks from %d urls", total, len(urls))
    return {
        "web_ingested": total,
        "fallback_used": total > 0,
        "correction_attempts": attempts + 1,
    }
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_rag_qa.py::TestCrawlIndexProgress tests/test_rag_qa.py::TestCrawlIndex -v`
Expected: PASS (the original `TestCrawlIndex` still passes — return contract unchanged; the new test passes).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/nodes.py tests/test_rag_qa.py
git commit -m "feat(crag): crawl_index emits per-URL crawl_progress custom events"
```

---

## Task 5: SSE — `grade` event, interrupt detection, `crawl_progress` in `_stream_generator`

Extend the existing `astream_events(version="v2")` loop. Keep token + node-timing logic; add the CRAG node names, a `grade` event, a `crawl_progress` passthrough, and an interrupt branch that emits `interrupt` (and skips `record_run`, since a pause is not a run).

**Files:**
- Modify: `src/sovereign_rag/api/ask/router.py`
- Test: `tests/test_ask_interrupt.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ask_interrupt.py`:

```python
class TestStreamGenerator:
    async def _drain(self, gen: Any) -> list[dict[str, Any]]:
        import json

        out: list[dict[str, Any]] = []
        async for raw in gen:
            line = raw.decode() if isinstance(raw, bytes) else raw
            for part in line.strip().split("\n"):
                if part.startswith("data: "):
                    out.append(json.loads(part[len("data: ") :]))
        return out

    async def _events_from(self, evlist: list[dict[str, Any]]) -> Any:
        for e in evlist:
            yield e

    async def test_grade_and_interrupt_events(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # astream_events emits: grade node end (with grade fields), then the
        # run pauses. aget_state reports the pending interrupt.
        ev = [
            {"event": "on_chain_start", "name": "grade", "data": {}},
            {
                "event": "on_chain_end",
                "name": "grade",
                "data": {"output": {"grade": "ambiguous", "grade_confidence": 0.46,
                                    "grade_reason": "thin"}},
            },
        ]
        graph = AsyncMock()
        graph.astream_events = lambda *a, **k: self._events_from(ev)

        class _Snap:
            next = ("request_approval",)

            class _Task:
                interrupts = (
                    type("I", (), {"value": {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [{"title": "A", "url": "https://a", "snippet": "s"}],
                    }})(),
                )

            tasks = (_Task(),)

        graph.aget_state = AsyncMock(return_value=_Snap())
        rec = AsyncMock(side_effect=AssertionError("pause is not a run"))
        monkeypatch.setattr(ask_router, "record_run", rec)

        gen = ask_router._stream_generator(
            graph, {"question": "q"}, {"configurable": {"thread_id": "t"}}, "t", None
        )
        events = await self._drain(gen)
        types = [e["type"] for e in events]
        assert "grade" in types
        grade_ev = next(e for e in events if e["type"] == "grade")
        assert grade_ev["label"] == "ambiguous" and grade_ev["confidence"] == 0.46
        assert "interrupt" in types
        intr = next(e for e in events if e["type"] == "interrupt")
        assert intr["candidate_urls"][0]["url"] == "https://a"
        assert "done" not in types  # a pause does not emit done

    async def test_crawl_progress_passthrough(self, monkeypatch: pytest.MonkeyPatch) -> None:
        ev = [
            {"event": "on_custom_event", "name": "crawl_progress",
             "data": {"url": "https://a", "status": "indexed", "chunks": 7}},
        ]
        graph = AsyncMock()
        graph.astream_events = lambda *a, **k: self._events_from(ev)

        class _Snap:
            next = ()
            tasks = ()
            values = {"answer": "done", "citations": [], "retrieved": 1, "used": 1}

        graph.aget_state = AsyncMock(return_value=_Snap())
        monkeypatch.setattr(ask_router, "record_run", AsyncMock())

        gen = ask_router._stream_generator(
            graph, {"question": "q"}, {"configurable": {"thread_id": "t"}}, "t", None
        )
        events = await self._drain(gen)
        cp = [e for e in events if e["type"] == "crawl_progress"]
        assert cp and cp[0]["url"] == "https://a" and cp[0]["chunks"] == 7
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ask_interrupt.py::TestStreamGenerator -v`
Expected: FAIL — no `grade`/`interrupt`/`crawl_progress` events emitted yet.

- [ ] **Step 3: Implement**

In `_stream_generator` in `src/sovereign_rag/api/ask/router.py`:

(a) Broaden the tracked node set. Replace both `name in {"retrieve_local","rerank","generate"}` sets (the `on_chain_start` and `on_chain_end` branches) with the module-level constant — add near the top of the file:

```python
_CRAG_NODES = {
    "retrieve_local",
    "rerank",
    "grade",
    "transform_query",
    "web_search",
    "crawl_index",
    "generate",
}
```

and use `name in _CRAG_NODES` in both branches.

(b) In the `on_chain_end` branch, after the existing `citations` emission for `generate`, add a `grade` emission:

```python
                    if name == "grade":
                        yield _sse(
                            {
                                "type": "grade",
                                "label": output.get("grade"),
                                "confidence": output.get("grade_confidence"),
                                "reason": output.get("grade_reason"),
                            }
                        )
```

(c) Add a custom-event branch inside the loop (alongside the `on_chat_model_stream` / `on_chain_*` branches):

```python
                elif kind == "on_custom_event" and name == "crawl_progress":
                    data = event.get("data") or {}
                    if isinstance(data, dict):
                        yield _sse({"type": "crawl_progress", **data})
```

(d) After the loop, BEFORE the `if not final_state:` fallback, detect a pause and emit `interrupt` instead of `done`:

```python
        # The graph may have paused at request_approval — the top-level
        # on_chain_end does not fire on an interrupt, so check the snapshot.
        try:
            snapshot = await graph.aget_state(config)
        except Exception as exc:  # pragma: no cover - defensive
            logger.warning("aget_state failed: %s", exc)
            snapshot = None
        pending = _pending_interrupt(snapshot)
        if pending is not None:
            interrupt, grade = pending
            if grade is not None:
                yield _sse(
                    {"type": "grade", "label": grade.label,
                     "confidence": grade.confidence, "reason": grade.reason}
                )
            yield _sse(
                {
                    "type": "interrupt",
                    "thread_id": thread_id,
                    "reason": interrupt.reason,
                    "candidate_urls": [c.model_dump() for c in interrupt.candidate_urls],
                }
            )
            return  # a pause is not a completed run — no record_run, no done
```

Add the snapshot helper near `_extract_interrupt`:

```python
def _pending_interrupt(
    snapshot: Any,
) -> tuple[InterruptModel, GradeModel | None] | None:
    """Build the interrupt from a state snapshot's pending tasks, if any.

    On a pause, ``aget_state`` returns a snapshot whose ``.tasks[*].interrupts``
    carry the Interrupt objects (and ``.next`` names the paused node)."""
    if snapshot is None or not getattr(snapshot, "next", None):
        return None
    for task in getattr(snapshot, "tasks", ()) or ():
        for intr in getattr(task, "interrupts", ()) or ():
            payload = getattr(intr, "value", None)
            if isinstance(payload, dict):
                return _extract_interrupt({"__interrupt__": (intr,)})
    return None
```

Note: the `final_state` fallback path already calls `aget_state`; the implementer may dedupe by computing `snapshot` once and reusing it for both the interrupt check and the `final_state` fallback. Keep the existing `done`/`record_run` path unchanged for the non-interrupt case.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_ask_interrupt.py::TestStreamGenerator -v`
Expected: PASS (2 passed). Also run `uv run pytest tests/test_api.py -v` to confirm the existing stream tests still pass (the linear path emits no grade/interrupt and still reaches `done`).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/ask/router.py tests/test_ask_interrupt.py
git commit -m "feat(crag): SSE grade + interrupt + crawl_progress events on /ask/stream"
```

---

## Task 6: `/ask/resume` and `/ask/resume/stream`

**Files:**
- Modify: `src/sovereign_rag/api/ask/router.py`
- Test: `tests/test_ask_interrupt.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ask_interrupt.py`:

```python
class TestResume:
    async def test_resume_approve_completes_with_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from langgraph.types import Command

        graph = AsyncMock()
        graph.ainvoke.return_value = {
            "answer": "answer with web [1]",
            "citations": [],
            "retrieved": 4,
            "used": 1,
            "fallback_used": True,
            "grade": "correct",
            "grade_confidence": 0.79,
            "grade_reason": "ok",
            "correction_attempts": 1,
        }
        captured: dict[str, Any] = {}
        monkeypatch.setattr(
            ask_router,
            "record_run",
            AsyncMock(side_effect=lambda **kw: captured.update(kw)),
        )

        from sovereign_rag.api.ask.schemas import ResumeRequest

        resp = await ask_router.ask_resume(
            ResumeRequest(thread_id="t1", approved_urls=["https://a"]), graph
        )
        # resumed with Command(resume={"approved_urls": [...]}) on the same thread
        sent = graph.ainvoke.call_args.args[0]
        assert isinstance(sent, Command)
        assert sent.resume == {"approved_urls": ["https://a"]}
        assert graph.ainvoke.call_args.kwargs["config"]["configurable"]["thread_id"] == "t1"
        assert resp.status == "ok"
        assert resp.fallback_used is True
        assert resp.answer == "answer with web [1]"
        # the run was recorded with CRAG fields
        assert captured["fallback_used"] is True
        assert captured["grade"] == "correct"

    async def test_resume_decline_answers_local(self, monkeypatch: pytest.MonkeyPatch) -> None:
        graph = AsyncMock()
        graph.ainvoke.return_value = {
            "answer": "local only [1]",
            "citations": [],
            "retrieved": 2,
            "used": 1,
            "fallback_used": False,
            "declined": True,
            "grade": "ambiguous",
            "grade_confidence": 0.46,
            "grade_reason": "thin",
        }
        monkeypatch.setattr(ask_router, "record_run", AsyncMock())

        from sovereign_rag.api.ask.schemas import ResumeRequest

        resp = await ask_router.ask_resume(
            ResumeRequest(thread_id="t1", approved_urls=[]), graph
        )
        assert resp.status == "ok"
        assert resp.fallback_used is False
        assert resp.answer == "local only [1]"
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ask_interrupt.py::TestResume -v`
Expected: FAIL — `AttributeError: ... has no attribute 'ask_resume'`.

- [ ] **Step 3: Implement**

In `src/sovereign_rag/api/ask/router.py`, add the import and a richer response builder + the two endpoints.

Add import:

```python
from langgraph.types import Command
```

Extend `_build_response` to carry the CRAG fields (replace the existing function):

```python
def _build_response(thread_id: str, state: dict[str, Any]) -> AskResponse:
    """Convert a compiled-graph result dict into the API response."""
    citations = state.get("citations") or []
    grade = None
    if state.get("grade"):
        grade = GradeModel(
            label=state["grade"],
            confidence=float(state.get("grade_confidence") or 0.0),
            reason=str(state.get("grade_reason") or ""),
        )
    return AskResponse(
        thread_id=thread_id,
        status="ok",
        answer=state.get("answer"),
        citations=[CitationModel(**asdict(c)) for c in citations],
        retrieved=int(state.get("retrieved", 0)),
        used=int(state.get("used", 0)),
        fallback_used=bool(state.get("fallback_used", False)),
        grade=grade,
    )
```

Add the resume endpoints (after `ask_stream`):

```python
@router.post("/ask/resume", response_model=AskResponse)
async def ask_resume(req: ResumeRequest, graph: GraphDep) -> AskResponse:
    """Resume a thread paused at the HITL approval interrupt.

    ``approved_urls`` non-empty → approve those (crawl + re-retrieve);
    ``[]`` → decline (answer from the local corpus). With the default
    ``crag_max_corrections=1`` the resumed run completes without pausing again.
    """
    thread_id = req.thread_id
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    started = time.perf_counter()
    try:
        state = await graph.ainvoke(
            Command(resume={"approved_urls": req.approved_urls}), config=config
        )
    except Exception as exc:
        logger.exception("resume failed")
        raise HTTPException(500, f"Resume failed: {exc}") from exc

    # A second interrupt is possible only if crag_max_corrections > 1.
    paused = _extract_interrupt(state)
    if paused is not None:
        interrupt, grade = paused
        return AskResponse(
            thread_id=thread_id, status="interrupted", interrupt=interrupt, grade=grade
        )

    response = _build_response(thread_id, state)
    await record_run(
        thread_id=thread_id,
        question=str(state.get("question") or ""),
        answer=response.answer,
        retrieved=response.retrieved,
        used=response.used,
        citations=[c.model_dump() for c in response.citations],
        timings={"total": round((time.perf_counter() - started) * 1000)},
        overrides=None,
        model=get_settings().llm_model,
        status="ok",
        grade=state.get("grade"),
        grade_confidence=state.get("grade_confidence"),
        fallback_used=bool(state.get("fallback_used", False)),
        decision="approved" if req.approved_urls else "declined",
        correction_attempts=int(state.get("correction_attempts", 0)),
    )
    return response


@router.post("/ask/resume/stream")
async def ask_resume_stream(req: ResumeRequest, graph: GraphDep) -> StreamingResponse:
    """SSE variant of /ask/resume — streams the post-approval tokens + events."""
    thread_id = req.thread_id
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    resume_input = Command(resume={"approved_urls": req.approved_urls})
    return StreamingResponse(
        _stream_generator(graph, resume_input, config, thread_id, None),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
```

Note: `_stream_generator` already accepts any `initial` input and passes it to `astream_events`; a `Command` is a valid input, so the resume stream reuses it unchanged. The CRAG fields passed to `record_run` require Task 7's signature extension — implement Task 7 first if you hit a TypeError, or land them together.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_ask_interrupt.py::TestResume -v`
Expected: PASS (after Task 7's `record_run` signature is in place — if running tasks in order, do Task 7 before this step's final green, or temporarily the test monkeypatches `record_run` so it passes regardless).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/ask/router.py tests/test_ask_interrupt.py
git commit -m "feat(crag): /ask/resume + /ask/resume/stream (approve/decline)"
```

---

## Task 7: Runs schema — CRAG columns + record_run/list_runs + RunRow

**Files:**
- Modify: `src/sovereign_rag/api/runs/service.py`, `src/sovereign_rag/api/runs/router.py`
- Test: `tests/test_runs_crag.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_runs_crag.py`:

```python
"""record_run carries CRAG fields; the ALTER/INSERT SQL includes the columns."""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from sovereign_rag.api.runs import service


class _Cur:
    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []

    async def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    async def __aenter__(self) -> "_Cur":
        return self

    async def __aexit__(self, *a: Any) -> None:
        return None


class _Conn:
    def __init__(self, cur: _Cur) -> None:
        self._cur = cur

    def cursor(self, **_: Any) -> _Cur:
        return self._cur

    async def __aenter__(self) -> "_Conn":
        return self

    async def __aexit__(self, *a: Any) -> None:
        return None


def _pool_with(cur: _Cur, monkeypatch: pytest.MonkeyPatch) -> None:
    pool = MagicMock()
    pool.connection = lambda: _Conn(cur)
    monkeypatch.setattr(service, "get_pg_pool", lambda: pool)


async def test_record_run_includes_crag_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    await service.record_run(
        thread_id="t",
        question="q",
        answer="a",
        retrieved=4,
        used=1,
        citations=[],
        timings={"total": 10},
        overrides=None,
        model="m",
        status="ok",
        grade="ambiguous",
        grade_confidence=0.46,
        fallback_used=True,
        decision="approved",
        correction_attempts=1,
    )
    sql, params = cur.executed[-1]
    assert "grade" in sql and "fallback_used" in sql and "decision" in sql
    assert "correction_attempts" in sql and "grade_confidence" in sql
    # the new values are bound (order-independent membership check)
    assert "ambiguous" in params and 0.46 in params and "approved" in params


async def test_ensure_table_adds_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    await service.ensure_runs_table()
    all_sql = " ".join(s for s, _ in cur.executed)
    for col in ("grade", "grade_confidence", "fallback_used", "decision", "correction_attempts"):
        assert f"ADD COLUMN IF NOT EXISTS {col}" in all_sql


async def test_record_run_defaults_crag_fields_optional(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    # Called the old way (no CRAG kwargs) — must not raise.
    await service.record_run(
        thread_id="t", question="q", answer="a", retrieved=0, used=0,
        citations=[], timings={}, overrides=None, model="m",
    )
    assert cur.executed  # an INSERT ran
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_runs_crag.py -v`
Expected: FAIL — `record_run` has no `grade`/`decision`/etc. kwargs.

- [ ] **Step 3: Implement**

In `src/sovereign_rag/api/runs/service.py`:

Add the ALTER statements to `_INDEXES_SQL` execution. Extend `ensure_runs_table` to also run column adds — add a constant and execute it:

```python
_ALTER_SQL = [
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS grade TEXT;",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS grade_confidence REAL;",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS fallback_used BOOLEAN NOT NULL DEFAULT FALSE;",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS decision TEXT;",
    "ALTER TABLE runs ADD COLUMN IF NOT EXISTS correction_attempts INT NOT NULL DEFAULT 0;",
]
```

In `ensure_runs_table`, after the index loop:

```python
            for stmt in _ALTER_SQL:
                await cur.execute(stmt)
```

Extend `record_run`'s signature with optional CRAG kwargs and include them in the INSERT:

```python
async def record_run(
    *,
    thread_id: str,
    question: str,
    answer: str | None,
    retrieved: int,
    used: int,
    citations: list[dict[str, Any]],
    timings: dict[str, Any],
    overrides: dict[str, Any] | None,
    model: str | None,
    status: str = "ok",
    error: str | None = None,
    grade: str | None = None,
    grade_confidence: float | None = None,
    fallback_used: bool = False,
    decision: str | None = None,
    correction_attempts: int = 0,
) -> None:
    """Insert one row into ``runs``. Best-effort: errors are logged, not raised."""
    sql = """
        INSERT INTO runs (thread_id, question, answer, retrieved, used,
                          citations, timings, overrides, model, status, error,
                          grade, grade_confidence, fallback_used, decision,
                          correction_attempts)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s,
                %s, %s, %s, %s, %s)
    """
    try:
        async with get_pg_pool().connection() as conn, conn.cursor() as cur:
            await cur.execute(
                sql,
                (
                    thread_id, question, answer, int(retrieved), int(used),
                    json.dumps(citations), json.dumps(timings),
                    json.dumps(overrides) if overrides is not None else None,
                    model, status, error,
                    grade,
                    float(grade_confidence) if grade_confidence is not None else None,
                    bool(fallback_used),
                    decision,
                    int(correction_attempts),
                ),
            )
    except Exception as exc:
        logger.warning("record_run failed: %s", exc)
```

Extend `list_runs`' SELECT to include the new columns:

```python
        SELECT id, thread_id, question, answer, retrieved, used,
               citations, timings, overrides, model, status, error, created_at,
               grade, grade_confidence, fallback_used, decision, correction_attempts
        FROM runs
        ORDER BY created_at DESC
        LIMIT %s
```

In `src/sovereign_rag/api/runs/router.py`, add the fields to `RunRow` and map them in `runs_list`:

```python
    grade: str | None = None
    grade_confidence: float | None = None
    fallback_used: bool = False
    decision: str | None = None
    correction_attempts: int = 0
```

and in the `RunRow(...)` construction:

```python
                grade=r.get("grade"),
                grade_confidence=r.get("grade_confidence"),
                fallback_used=bool(r.get("fallback_used") or False),
                decision=r.get("decision"),
                correction_attempts=int(r.get("correction_attempts") or 0),
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_runs_crag.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/runs/service.py src/sovereign_rag/api/runs/router.py tests/test_runs_crag.py
git commit -m "feat(crag): runs schema + record_run/list_runs carry grade/fallback/decision"
```

---

## Task 8: Record CRAG fields from `/ask` and `/ask/stream` completions

Wire the CRAG fields into the two existing `record_run` call sites (the non-interrupt completions) so a directly-answered run (e.g. grade=correct, no fallback) also logs its grade.

**Files:**
- Modify: `src/sovereign_rag/api/ask/router.py`
- Test: `tests/test_ask_interrupt.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_ask_interrupt.py`:

```python
class TestAskRecordsGrade:
    async def test_ok_answer_records_grade_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        graph = AsyncMock()
        graph.ainvoke.return_value = {
            "answer": "direct [1]", "citations": [], "retrieved": 5, "used": 1,
            "fallback_used": False, "grade": "correct", "grade_confidence": 0.82,
            "grade_reason": "strong", "question": "q?",
        }
        captured: dict[str, Any] = {}
        monkeypatch.setattr(
            ask_router, "record_run", AsyncMock(side_effect=lambda **kw: captured.update(kw))
        )
        from sovereign_rag.api.ask.schemas import AskRequest

        resp = await ask_router.ask(AskRequest(question="q?"), graph)
        assert resp.status == "ok"
        assert resp.grade is not None and resp.grade.label == "correct"
        assert captured["grade"] == "correct"
        assert captured["fallback_used"] is False
        assert captured["decision"] is None  # no web fallback path was taken
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_ask_interrupt.py::TestAskRecordsGrade -v`
Expected: FAIL — `record_run` in `/ask` isn't passing `grade`/`fallback_used` yet (KeyError on `captured["grade"]`).

- [ ] **Step 3: Implement**

In `ask(...)`, the success-path `record_run(...)` call: add the CRAG kwargs:

```python
        grade=state.get("grade"),
        grade_confidence=state.get("grade_confidence"),
        fallback_used=bool(state.get("fallback_used", False)),
        decision=None,
        correction_attempts=int(state.get("correction_attempts", 0)),
```

(`decision` is None on the direct `/ask` completion — a decision only exists when a resume happened. The `state` returned by `ainvoke` here is the completed dict; use it for the grade fields. Note the success path's `record_run` currently reads `response.*` — keep those and add the `state.get(...)` CRAG fields.)

Do the same in `_stream_generator`'s final `record_run(...)` (the `done` path), reading from `final_state`:

```python
        grade=final_state.get("grade"),
        grade_confidence=final_state.get("grade_confidence"),
        fallback_used=bool(final_state.get("fallback_used", False)),
        decision=None,
        correction_attempts=int(final_state.get("correction_attempts", 0)),
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_ask_interrupt.py -v`
Expected: PASS (all classes).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/api/ask/router.py tests/test_ask_interrupt.py
git commit -m "feat(crag): record grade/fallback fields on /ask + /ask/stream completions"
```

---

## Task 9: M1 — register checkpoint serializers for retrieval dataclasses

When the graph pauses at the interrupt, `RAGState` (with `candidates`/`reranked` lists of `RetrievedChunk`, and `Citation`s) is serialized into the Postgres checkpoint and sits there for the human pause. LangGraph's msgpack serializer warns: *"Deserializing unregistered type … will be blocked in a future version."* Register these dataclasses so the pause survives reliably.

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/graph.py` (the `build_graph`/lifespan compile path)
- Test: `tests/test_checkpoint_serde.py` (create)

- [ ] **Step 1: Write the failing test**

Create `tests/test_checkpoint_serde.py`:

```python
"""A paused CRAG run round-trips RetrievedChunk/Citation through a checkpoint
without the 'unregistered type' serializer warning."""

from __future__ import annotations

import warnings

import pytest
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command

# Reuse Plan 1's stubbed graph fixture machinery.
pytestmark = pytest.mark.usefixtures()


async def test_paused_state_serializes_without_warning(monkeypatch: pytest.MonkeyPatch) -> None:
    # Build the CRAG graph with stubs (same pattern as test_rag_qa_graph.stub_graph)
    from tests.test_rag_qa_graph import _build_stubbed_graph  # helper extracted in Step 3

    graph = _build_stubbed_graph(monkeypatch, InMemorySaver())
    cfg = {"configurable": {"thread_id": "serde-1"}}

    with warnings.catch_warnings():
        warnings.simplefilter("error")  # any serializer warning becomes a failure
        first = await graph.ainvoke({"question": "q"}, cfg)
        assert "__interrupt__" in first
        # reading state back forces deserialization of the checkpointed RAGState
        snap = await graph.aget_state(cfg)
        assert snap is not None
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_checkpoint_serde.py -v`
Expected: FAIL — either the helper doesn't exist yet, or a serializer `UserWarning` is raised under `simplefilter("error")`.

- [ ] **Step 3: Implement**

This task has two parts.

(a) **Extract a reusable stubbed-graph builder** from `tests/test_rag_qa_graph.py` so both the existing graph tests and this serde test share it. Refactor the `stub_graph` fixture to delegate to a module-level `_build_stubbed_graph(monkeypatch, checkpointer=None)` that does the monkeypatching + `_build_state_graph().compile(checkpointer=checkpointer)` (enabling the flag). Keep the existing tests green.

(b) **Register the dataclasses.** The cleanest place is where the prod graph is compiled. Investigate the current serializer: LangGraph's `AsyncPostgresSaver`/`InMemorySaver` use an `JsonPlusSerializer` (msgpack-based) that supports registering additional types. Provide a small `shared/checkpoint_serde.py` that builds a serializer (or `ensure_serializable` hook) registering `Chunk`, `RetrievedChunk`, `Citation` as msgpack-encodable (encode → `dataclasses.asdict`, decode → reconstruct). Wire it into `build_graph(checkpointer)` (and the FastAPI lifespan's `AsyncPostgresSaver` construction) via the saver's `serde=` argument.

The exact registration API depends on the installed `langgraph-checkpoint` version — **verify against the installed version first** (`uv run python -c "import langgraph.checkpoint.serde.jsonplus as j; help(j)"`). If registration proves heavy, the acceptable fallback (document it in the commit) is to keep heavy retrieval objects **out** of checkpointed state across the interrupt: have `request_approval` not depend on `candidates`/`reranked` (it doesn't) and rely on re-retrieval after resume — but `web_search` already wrote `candidate_urls` (plain dicts) and the post-resume `retrieve_local` rebuilds `candidates`, so the only values that must persist across the pause are JSON-native. If the simpler path is to ensure only JSON-native fields cross the interrupt, prefer that and add a test asserting the checkpointed payload is JSON-serializable.

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_checkpoint_serde.py tests/test_rag_qa_graph.py -v`
Expected: PASS (no serializer warning escalated to error; the existing graph tests still pass after the fixture refactor).

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/ tests/test_checkpoint_serde.py tests/test_rag_qa_graph.py
git commit -m "fix(crag): register retrieval dataclasses for durable checkpoint serialization"
```

---

## Task 10: Integration test (gated) + full green

**Files:**
- Modify: `tests/test_ask_interrupt.py` (add a gated integration test) — optional but recommended
- Verify: whole suite

- [ ] **Step 1: Add a gated end-to-end interrupt/resume integration test**

Append to `tests/test_ask_interrupt.py` (skipped unless services up, matching the repo's `RUN_*_IT` convention):

```python
@pytest.mark.integration
async def test_full_interrupt_resume_against_real_graph() -> None:
    """With real services + enable_corrective_rag=True, a thin-corpus question
    grades weak, /ask returns interrupted, /ask/resume(approve) crawls + answers.
    Gated: requires Milvus/Neo4j/Postgres/SearXNG + ENABLE_CORRECTIVE_RAG=1."""
    pytest.importorskip("pymilvus")
    # ... build the real graph via build_graph(AsyncPostgresSaver), ask a
    # question with no local coverage, assert status=interrupted, resume with
    # the top candidate, assert an answer + fallback_used. (Skipped in CI unit tier.)
```

(Keep it minimal/skipped; the real coverage is the unit + graph-level suite. This documents the end-to-end contract for the self-hosted runner.)

- [ ] **Step 2: Full green**

Run:
```bash
uv run pytest -m "not integration" -q
uv run ruff check src/ tests/
uv run mypy src/
```
Expected: all green. (Confirm `tests/test_api.py` — the pre-existing API tests — still pass; the linear default path is unchanged.)

- [ ] **Step 3: Commit**

```bash
git add tests/test_ask_interrupt.py
git commit -m "test(crag): gated end-to-end interrupt/resume integration test"
```

---

## Self-review (against the spec)

**Spec coverage (Plan 2 scope = §5.3, §5.5, §6 API/SSE/runs):**
- §5.3 `/ask` interrupt detection → Task 3. ✅
- §5.3 `/ask/resume` + `/ask/resume/stream` → Task 6. ✅
- §5.3 SSE `grade` + `interrupt` + `crawl_progress` → Tasks 4 (emit) + 5 (stream). ✅
- §6 API schemas (`AskResponse` status/interrupt/fallback_used/grade, `InterruptModel`, `CandidateUrl`+verified, `ResumeRequest`, `GradeModel`) → Task 2. ✅
- §6 SSE event shapes → Tasks 4, 5. ✅
- §5.5 runs schema ALTER + record_run/list_runs + RunRow → Tasks 7, 8. ✅
- Risk M1 (checkpoint serialization across the pause) → Task 9. ✅

**Deferred (later plans):** eval graph-driven mode + auto-approver + fixtures (Plan 3); History/Evals UI surfaces + approval card (Plan 4); README/architecture/CLAUDE.md (Plan 5). Enabling CRAG in prod is an ops decision (env flag), not part of this plan.

**Placeholder scan:** Task 9 step 3 intentionally leaves the *registration API specifics* to verification-against-installed-version (the API differs across `langgraph-checkpoint` releases) and documents an explicit, acceptable fallback (keep only JSON-native fields across the pause). Every other step has complete code.

**Type consistency:** `_extract_interrupt(state) -> tuple[InterruptModel, GradeModel|None] | None` (Task 3) is reused by `_pending_interrupt` (Task 5) and by `/ask/resume` (Task 6). `record_run`'s new kwargs (`grade, grade_confidence, fallback_used, decision, correction_attempts`, Task 7) match every call site (Tasks 6, 8). `AskResponse`/`ResumeRequest`/`InterruptModel`/`CandidateUrl`/`GradeModel` (Task 2) are imported consistently in the router.

---

## Risks / decisions

- **Streaming API: stayed on `astream_events(version="v2")`.** Preserves the working token + per-node-timing logic; interrupt detected via `aget_state` after the loop; custom progress via `on_custom_event`. The alternative (`astream(stream_mode=["messages","updates","custom"])`, the newer recommended API) was rejected for this plan because it would rewrite the working timing logic for no functional gain here. Task 1 de-risks the custom-event assumption before any of it is built. Revisit if a future LangGraph drops v2.
- **Concurrency caveat (pre-existing).** `_apply_overrides` mutates the global Settings singleton; resume doesn't take overrides (a resumed thread keeps its original settings). Documented in `AskOverrides`; unchanged here.
- **`record_run` on resume** uses `state.get("question")` — the question is in the checkpointed state from the initial `/ask`, so it's present on resume. Confirmed by the graph carrying `question` in `RAGState`.

## Execution handoff

Same as Plan 1: subagent-driven, fresh subagent per unit, spec-review then quality-review per unit, on branch `feat/corrective-rag-backend`. Suggested units: **(A)** Tasks 1–2 (spike + schemas), **(B)** Tasks 3–6 (the API/SSE core — same files), **(C)** Tasks 7–8 (runs), **(D)** Task 9 (serde) + Task 10 (full green). After Plan 2: Plan 3 (eval), then 4 (frontend), then 5 (docs). Enabling CRAG in prod (the env flag) should wait until Plan 3's eval shows the lift.
