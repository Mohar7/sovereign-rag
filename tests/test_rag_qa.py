"""RAG QA graph unit tests.

Each node is exercised with the heavy collaborators (pipeline, retrievers,
LLM, reranker) stubbed out via monkeypatch — so the suite stays offline
and fast while still pinning the node contracts.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import nodes as agent_nodes
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
# do_rerank
# ---------------------------------------------------------------------------
class TestDoRerank:
    async def test_calls_rerank_with_candidates(self, monkeypatch: pytest.MonkeyPatch) -> None:
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

    async def test_empty_candidates_no_rerank_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sentinel = MagicMock(side_effect=AssertionError("rerank shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "rerank", sentinel)
        out = await agent_nodes.do_rerank({"question": "q", "candidates": []})
        assert out == {"reranked": [], "retrieved": 0}


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------
class TestGenerate:
    async def test_calls_llm_and_returns_citations(self, monkeypatch: pytest.MonkeyPatch) -> None:
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
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate({"question": "What's the codeword?", "reranked": reranked})

        assert out["answer"] == "The codeword is FERRET [1]."
        assert out["used"] == 1
        assert isinstance(out["citations"][0], Citation)
        assert out["citations"][0].title == "Manual"
        # LLM was called with a SystemMessage + a HumanMessage carrying [1].
        args = fake_llm.ainvoke.call_args.args[0]
        assert len(args) == 2
        assert "[1]" in args[1].content

    async def test_no_reranked_returns_default_no_op(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sentinel = MagicMock(side_effect=AssertionError("LLM shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "get_chat_model", sentinel)

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
