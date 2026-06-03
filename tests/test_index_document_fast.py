"""RAGPipeline.index_document fast-path flags.

The CRAG web-fallback indexes crawled docs Milvus-only to stay responsive:
``with_context=False`` skips the per-chunk contextual-retrieval LLM pass and
``with_graph=False`` skips the per-chunk graph entity/relation extraction. Both
are what made indexing a long web page take minutes (and blow the crawl ceiling).
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

from sovereign_rag.config import Settings
from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.retrieval import pipeline as pipe_mod
from sovereign_rag.retrieval.pipeline import RAGPipeline


def _doc() -> SourceDocument:
    return SourceDocument(
        title="Silverstone",
        source_uri="https://example.com/s",
        source_type=SourceType.WEB,
        markdown=(
            "Silverstone Circuit is a motor racing venue in England. "
            "It hosts the British Grand Prix. " * 20
        ),
        metadata={},
    )


def _pipe(monkeypatch) -> tuple[RAGPipeline, dict, MagicMock]:  # type: ignore[no-untyped-def]
    calls = {"ctx": 0}

    async def spy_contextualize(doc, chunks):  # type: ignore[no-untyped-def]
        calls["ctx"] += 1
        return chunks

    monkeypatch.setattr(pipe_mod, "contextualize", spy_contextualize)

    milvus = MagicMock()
    milvus.ensure_collection = AsyncMock()
    milvus.add_chunks = AsyncMock(return_value=None)
    graph = MagicMock()
    graph.ensure_schema = AsyncMock()
    graph.add_chunks = AsyncMock(return_value=None)

    s = Settings(_env_file=None)  # contextual + graph both default-on
    return RAGPipeline(settings=s, milvus=milvus, graph=graph), calls, graph


async def test_fast_path_skips_context_and_graph(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    pipe, calls, graph = _pipe(monkeypatch)
    n = await pipe.index_document(_doc(), with_context=False, with_graph=False)
    assert n >= 1
    assert calls["ctx"] == 0  # contextual retrieval NOT run
    graph.add_chunks.assert_not_called()  # graph extraction NOT run
    pipe._milvus.add_chunks.assert_awaited_once()  # but Milvus IS indexed


async def test_full_path_runs_context_and_graph(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    pipe, calls, graph = _pipe(monkeypatch)
    await pipe.index_document(_doc())  # defaults: with_context=True, with_graph=True
    assert calls["ctx"] == 1
    graph.add_chunks.assert_awaited_once()
