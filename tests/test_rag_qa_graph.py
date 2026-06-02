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
