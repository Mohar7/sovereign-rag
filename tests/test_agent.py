"""Agent / LangGraph unit tests.

Each node is exercised with the heavy collaborators (pipeline, retrievers,
LLM, reranker, web search/crawl, the `interrupt()` call) stubbed out via
monkeypatch — so the suite stays offline and fast while still pinning the
node contracts.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from sovereign_rag.agent import nodes as agent_nodes
from sovereign_rag.agent.state import INTERRUPT_REASON_APPROVE_URLS
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _rc(chunk_id: str, score: float = 0.5, source: str = "milvus_hybrid") -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d",
        text="chunk text",
        raw_text="chunk text",
        position=0,
        chunk_id=chunk_id,
    )
    return RetrievedChunk(chunk=chunk, score=score, source=source)


# ---------------------------------------------------------------------------
# decide_after_local
# ---------------------------------------------------------------------------
class TestDecideAfterLocal:
    def test_enough_candidates_goes_to_rerank(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "web_fallback_min_chunks", 3)
        state = {"candidates": [_rc("a"), _rc("b"), _rc("c")]}
        assert agent_nodes.decide_after_local(state) == "rerank"

    def test_few_candidates_triggers_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "web_fallback_min_chunks", 3)
        state = {"candidates": [_rc("a")]}
        assert agent_nodes.decide_after_local(state) == "web_fallback"

    def test_already_attempted_short_circuits(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """Once web_fallback has fired, the conditional edge must not loop."""
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "web_fallback_min_chunks", 10)
        state = {"candidates": [], "web_fallback_attempted": True}
        assert agent_nodes.decide_after_local(state) == "rerank"

    def test_zero_threshold_disables_fallback(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """WEB_FALLBACK_MIN_CHUNKS=0 means 'never fall back', even with nothing."""
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "web_fallback_min_chunks", 0)
        state = {"candidates": []}
        assert agent_nodes.decide_after_local(state) == "rerank"


# ---------------------------------------------------------------------------
# do_rerank
# ---------------------------------------------------------------------------
class TestDoRerank:
    async def test_calls_rerank_with_candidates(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        captured: dict[str, Any] = {}

        def fake_rerank(
            query: str, candidates: list[RetrievedChunk], top_k: int | None = None
        ) -> list[RetrievedChunk]:
            captured.update(query=query, candidates=candidates, top_k=top_k)
            return [_rc("top", score=0.99, source="reranked")]

        monkeypatch.setattr(agent_nodes, "rerank", fake_rerank)

        out = await agent_nodes.do_rerank({"question": "q?", "candidates": [_rc("a")]})

        assert captured["query"] == "q?"
        assert captured["candidates"] == [_rc("a")]
        assert isinstance(out["reranked"], list)
        assert out["retrieved"] == 1

    async def test_empty_candidates_no_rerank_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sentinel = MagicMock(side_effect=AssertionError("rerank shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "rerank", sentinel)
        out = await agent_nodes.do_rerank({"question": "q", "candidates": []})
        assert out == {"reranked": [], "retrieved": 0}


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------
class TestGenerate:
    async def test_calls_llm_and_returns_citations(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        chunk = Chunk(
            doc_id="d",
            text="enriched",
            raw_text="The codeword is FERRET.",
            position=0,
            chunk_id="c1",
            metadata={"title": "Manual", "source_uri": "smoke://manual"},
        )
        reranked = [RetrievedChunk(chunk=chunk, score=0.91, source="reranked")]

        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="The codeword is FERRET [1].")
        monkeypatch.setattr(agent_nodes, "get_llm", lambda: fake_llm)

        out = await agent_nodes.generate(
            {"question": "What's the codeword?", "reranked": reranked}
        )

        assert out["answer"] == "The codeword is FERRET [1]."
        assert out["used"] == 1
        assert isinstance(out["citations"][0], Citation)
        assert out["citations"][0].title == "Manual"
        # LLM was called with a SystemMessage + a HumanMessage carrying [1].
        args = fake_llm.ainvoke.call_args.args[0]
        assert len(args) == 2
        assert "[1]" in args[1].content

    async def test_no_reranked_returns_default_no_op(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        sentinel = MagicMock(side_effect=AssertionError("LLM shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "get_llm", sentinel)

        out = await agent_nodes.generate({"question": "?", "reranked": []})

        assert "couldn't find" in out["answer"].lower()
        assert out["citations"] == []
        assert out["used"] == 0


# ---------------------------------------------------------------------------
# retrieve_local
# ---------------------------------------------------------------------------
class TestRetrieveLocal:
    async def test_milvus_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        milvus = MagicMock()
        milvus.hybrid_search = AsyncMock(return_value=[_rc("m1", 0.7)])
        pipe = MagicMock()
        pipe._milvus = milvus
        pipe._graph = None  # graph disabled
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.retrieve_local({"question": "q"})

        assert [rc.chunk.chunk_id for rc in out["candidates"]] == ["m1"]
        milvus.hybrid_search.assert_awaited_once_with("q", doc_id=None)

    async def test_milvus_plus_graph_dedupes_keeping_highest_score(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        milvus = MagicMock()
        milvus.hybrid_search = AsyncMock(return_value=[_rc("c1", 0.30)])
        graph = MagicMock()
        graph.local_search = AsyncMock(
            return_value=[_rc("c1", 0.95, source="graph"), _rc("c2", 0.80, source="graph")]
        )
        pipe = MagicMock()
        pipe._milvus = milvus
        pipe._graph = graph
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.retrieve_local({"question": "q", "doc_id": "d1"})

        cands = {rc.chunk.chunk_id: rc for rc in out["candidates"]}
        assert set(cands) == {"c1", "c2"}
        # c1 was returned by both; the higher-scoring graph version must win dedup.
        assert cands["c1"].source == "graph"
        assert cands["c1"].score == 0.95
        # doc_id propagated to milvus call:
        milvus.hybrid_search.assert_awaited_once_with("q", doc_id="d1")


# ---------------------------------------------------------------------------
# web_fallback (HITL)
# ---------------------------------------------------------------------------
class TestWebFallback:
    async def test_pauses_with_candidate_urls_when_search_has_hits(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        hits = [
            {"url": "https://a", "title": "A", "snippet": "sa"},
            {"url": "https://b", "title": "B", "snippet": "sb"},
        ]
        monkeypatch.setattr(agent_nodes, "search", AsyncMock(return_value=hits))

        captured_payload: dict[str, Any] = {}

        def fake_interrupt(payload: dict[str, Any]) -> Any:
            captured_payload.update(payload)
            # If we got this far, the test verified the pause; raise a marker
            # so we don't need to fake the resume flow here.
            raise AssertionError("interrupt was invoked")

        monkeypatch.setattr(agent_nodes, "interrupt", fake_interrupt)

        with pytest.raises(AssertionError, match="interrupt was invoked"):
            await agent_nodes.web_fallback({"question": "q"})

        assert captured_payload["reason"] == INTERRUPT_REASON_APPROVE_URLS
        urls = [c["url"] for c in captured_payload["candidate_urls"]]
        assert urls == ["https://a", "https://b"]

    async def test_skips_interrupt_when_search_yields_nothing(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(agent_nodes, "search", AsyncMock(return_value=[]))
        sentinel = MagicMock(side_effect=AssertionError("interrupt shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "interrupt", sentinel)

        out = await agent_nodes.web_fallback({"question": "q"})

        assert out["web_fallback_attempted"] is True
        assert out["fallback_used"] is False

    async def test_search_failure_is_logged_and_falls_through(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        monkeypatch.setattr(
            agent_nodes, "search", AsyncMock(side_effect=RuntimeError("searxng down"))
        )
        sentinel = MagicMock(side_effect=AssertionError("interrupt shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "interrupt", sentinel)

        out = await agent_nodes.web_fallback({"question": "q"})

        # Empty candidate list (because of the swallowed exception) → no
        # interrupt; we mark attempted and let the next node take over.
        assert out == {"web_fallback_attempted": True, "fallback_used": False}
