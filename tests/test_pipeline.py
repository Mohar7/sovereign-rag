"""Unit tests for the retrieval pipeline's pure helpers + orchestration.

No Milvus/Neo4j/Ollama — the stores are mocked. Integration of the real
stack is exercised in a sandbox, not here.
"""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.pipeline import (
    RAGPipeline,
    _dedup_by_chunk,
    _format_context,
)


def _rc(chunk_id: str, score: float, text: str = "body", source: str = "milvus_hybrid") -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(
            doc_id="d1",
            text=text,
            raw_text=text,
            position=0,
            chunk_id=chunk_id,
            metadata={"title": "T", "source_uri": "u"},
        ),
        score=score,
        source=source,
    )


def test_dedup_keeps_highest_score() -> None:
    chunks = [
        _rc("a", 0.5, source="milvus_hybrid"),
        _rc("a", 0.9, source="graph"),
        _rc("b", 0.3),
    ]
    out = _dedup_by_chunk(chunks)
    by_id = {rc.chunk.chunk_id: rc for rc in out}
    assert len(out) == 2
    assert by_id["a"].score == 0.9
    assert by_id["a"].source == "graph"


def test_dedup_empty() -> None:
    assert _dedup_by_chunk([]) == []


def test_format_context_numbers_passages_and_builds_citations() -> None:
    retrieved = [_rc("a", 0.9, text="first passage"), _rc("b", 0.7, text="second passage")]
    block, citations = _format_context(retrieved)
    assert "[1] first passage" in block
    assert "[2] second passage" in block
    assert len(citations) == 2
    assert citations[0].chunk_id == "a"
    assert citations[0].title == "T"
    assert citations[0].score == 0.9


@pytest.mark.asyncio
async def test_retrieve_merges_and_reranks(monkeypatch) -> None:
    milvus = AsyncMock()
    milvus.hybrid_search.return_value = [_rc("a", 0.5), _rc("b", 0.4)]
    graph = AsyncMock()
    graph.local_search.return_value = [_rc("a", 0.8, source="graph"), _rc("c", 0.3, source="graph")]

    import sovereign_rag.retrieval.pipeline as pipe_mod

    def fake_rerank(query, candidates, top_k=None):
        ordered = sorted(candidates, key=lambda rc: rc.score, reverse=True)
        return ordered[: (top_k or 5)]

    monkeypatch.setattr(pipe_mod, "rerank", fake_rerank)

    pipe = RAGPipeline(milvus=milvus, graph=graph)
    out = await pipe.retrieve("q")

    ids = [rc.chunk.chunk_id for rc in out]
    assert ids[0] == "a"
    assert set(ids) == {"a", "b", "c"}


@pytest.mark.asyncio
async def test_answer_returns_empty_when_no_retrieval() -> None:
    milvus = AsyncMock()
    milvus.hybrid_search.return_value = []
    pipe = RAGPipeline(milvus=milvus, graph=None)

    result = await pipe.answer("q")
    assert result.retrieved == 0
    assert result.used == 0
    assert "couldn't find" in result.answer.lower()


@pytest.mark.asyncio
async def test_index_document_indexes_chunks() -> None:
    from sovereign_rag.documents import SourceDocument, SourceType

    milvus = AsyncMock()
    milvus.add_chunks.return_value = 3
    pipe = RAGPipeline(milvus=milvus, graph=None)
    pipe._s.enable_contextual_retrieval = False

    doc = SourceDocument(
        title="t",
        source_uri="u",
        source_type=SourceType.TEXT,
        markdown="Some text. " * 300,
    )
    n = await pipe.index_document(doc)
    assert n > 0
    milvus.ensure_collection.assert_awaited()
    milvus.add_chunks.assert_awaited()
