"""Graph-level CRAG tests: interrupt, approve-loop, decline, loop guard.

Every collaborator (pipeline, rerank, grader, query-rewrite LLM, web search,
crawler, answer LLM) is stubbed so the suite is offline. The graph is compiled
with an InMemorySaver so interrupt()/Command(resume=...) work.
"""

from __future__ import annotations

import asyncio
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


def _build_stubbed_graph(
    monkeypatch: pytest.MonkeyPatch,
    checkpointer: Any = None,
) -> Any:
    """Build a compiled CRAG graph with all node collaborators stubbed.

    Can be imported by other test modules (e.g. test_checkpoint_serde) to
    reuse the same stub configuration without duplicating setup.

    grade_candidates always returns 'ambiguous' → the corrective path fires on
    every grade; the correction_attempts guard is what stops the loop.
    If ``checkpointer`` is None an ``InMemorySaver`` is used.
    """
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "enable_corrective_rag", True)

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

    if checkpointer is None:
        checkpointer = InMemorySaver()
    return _build_state_graph().compile(checkpointer=checkpointer)


@pytest.fixture
def stub_graph(monkeypatch: pytest.MonkeyPatch) -> Any:
    """A compiled CRAG graph with all node collaborators stubbed.

    Delegates to the module-level ``_build_stubbed_graph`` so other test
    modules can reuse the same stub configuration.
    """
    return _build_stubbed_graph(monkeypatch)


def _config() -> dict[str, Any]:
    return {"configurable": {"thread_id": str(uuid.uuid4())}}


async def test_weak_grade_interrupts_with_candidate_urls(stub_graph: Any) -> None:
    result = await stub_graph.ainvoke({"question": "q"}, _config())
    assert "__interrupt__" in result
    # Interrupt.value is the stable public API for non-streaming clients (LangGraph >=0.2.24).
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
    assert "web sources did not improve coverage" in final["answer"]


async def test_decline_answers_from_local(stub_graph: Any) -> None:
    cfg = _config()
    await stub_graph.ainvoke({"question": "q"}, cfg)
    final = await stub_graph.ainvoke(Command(resume={"approved_urls": []}), cfg)
    assert "__interrupt__" not in final
    assert final["declined"] is True
    assert final["fallback_used"] is False
    # decline never reaches crawl_index, so the counter is never written:
    assert final.get("correction_attempts", 0) == 0


async def test_loop_guard_stops_after_max_corrections(
    stub_graph: Any, monkeypatch: pytest.MonkeyPatch
) -> None:
    # grade is always 'ambiguous'; with max_corrections=2 the graph may interrupt
    # twice, but the third grade (attempts==2) must route to generate, not pause again.
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "crag_max_corrections", 2)
    cfg = _config()

    first = await stub_graph.ainvoke({"question": "q"}, cfg)
    assert "__interrupt__" in first  # pass 1 → interrupt

    second = await stub_graph.ainvoke(
        Command(resume={"approved_urls": ["https://example.com/a"]}), cfg
    )
    assert "__interrupt__" in second  # attempts==1 < 2 → interrupt again

    third = await stub_graph.ainvoke(
        Command(resume={"approved_urls": ["https://example.com/a"]}), cfg
    )
    assert "__interrupt__" not in third  # attempts==2 → guard stops the loop
    assert third["correction_attempts"] == 2
    assert third["answer"]


# ---------------------------------------------------------------------------
# crawl_index robustness: a hostile URL (e.g. LinkedIn) can wedge Crawl4AI's
# browser past its internal page_timeout. The node must bound each URL with a
# hard wall-clock timeout (degrade to "failed") and crawl URLs in parallel, so
# one bad URL never hangs the whole /ask stream (the prod symptom).
# ---------------------------------------------------------------------------
async def test_crawl_index_hung_url_times_out_and_continues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sovereign_rag.config import get_settings

    # Tiny ceiling so the test is fast: hard timeout = crawl_timeout_s + margin.
    monkeypatch.setattr(get_settings(), "crawl_timeout_s", 0.05)
    monkeypatch.setattr(agent_nodes, "_CRAWL_HARD_TIMEOUT_MARGIN_S", 0.05)

    pipe = MagicMock()
    pipe.index_document = AsyncMock(return_value=7)
    monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

    async def fake_crawl(url: str) -> Any:
        if "hang" in url:
            await asyncio.sleep(30)  # never resolves within the hard timeout
        return MagicMock()

    monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)

    events: list[tuple[str | None, str | None]] = []

    async def capture(name: str, data: dict[str, Any]) -> None:
        events.append((data.get("url"), data.get("status")))

    monkeypatch.setattr(agent_nodes, "adispatch_custom_event", capture)

    state = {
        "question": "q",
        "approved_urls": ["https://good/a", "https://hang/b"],
        "correction_attempts": 0,
    }
    # The node itself must return quickly; if it wedges, this wait_for trips.
    out = await asyncio.wait_for(agent_nodes.crawl_index(state), timeout=5)  # type: ignore[arg-type]

    assert out["correction_attempts"] == 1
    assert out["web_ingested"] == 7  # only the good URL indexed
    assert out["fallback_used"] is True
    assert ("https://good/a", "indexed") in events
    assert ("https://hang/b", "failed") in events  # timed out → failed, not fatal


async def test_crawl_index_runs_urls_in_parallel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "crawl_concurrency", 3)

    pipe = MagicMock()
    pipe.index_document = AsyncMock(return_value=1)
    monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

    inflight = 0
    peak = 0

    async def fake_crawl(url: str) -> Any:
        nonlocal inflight, peak
        inflight += 1
        peak = max(peak, inflight)
        await asyncio.sleep(0.05)
        inflight -= 1
        return MagicMock()

    monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)

    async def capture(name: str, data: dict[str, Any]) -> None:
        return None

    monkeypatch.setattr(agent_nodes, "adispatch_custom_event", capture)

    state = {
        "question": "q",
        "approved_urls": ["https://a", "https://b", "https://c"],
        "correction_attempts": 0,
    }
    out = await agent_nodes.crawl_index(state)  # type: ignore[arg-type]

    assert out["web_ingested"] == 3
    assert peak >= 2  # at least two URLs crawled concurrently (serial → peak==1)


async def test_crawl_index_uses_fast_web_index_path(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Web fallback must index the fast Milvus-only way (no per-chunk LLM passes)
    so a long page indexes in seconds instead of blowing the crawl ceiling."""
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "crag_fast_web_index", True)

    pipe = MagicMock()
    pipe.index_document = AsyncMock(return_value=3)
    monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

    async def fake_crawl(url: str) -> Any:
        return MagicMock()

    monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)

    async def capture(name: str, data: dict[str, Any]) -> None:
        return None

    monkeypatch.setattr(agent_nodes, "adispatch_custom_event", capture)

    out = await agent_nodes.crawl_index(  # type: ignore[arg-type]
        {"question": "q", "approved_urls": ["https://a"], "correction_attempts": 0}
    )
    assert out["web_ingested"] == 3
    _, kwargs = pipe.index_document.call_args
    assert kwargs.get("with_context") is False  # contextual-retrieval skipped
    assert kwargs.get("with_graph") is False  # graph entity-extraction skipped


def test_disabled_builds_linear_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """enable_corrective_rag=False → no grade/correction nodes; the original
    retrieve→rerank→generate topology."""
    from sovereign_rag.config import get_settings

    # patch the lru_cache Settings singleton directly; monkeypatch restores it on teardown.
    monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
    graph = _build_state_graph().compile()
    node_names = set(graph.get_graph().nodes)
    assert "grade" not in node_names
    assert "request_approval" not in node_names
    assert {"retrieve_local", "rerank", "generate"} <= node_names
