"""Indexer graph nodes.

Two nodes:

- ``prepare_chunks`` — splits the source document and optionally adds the
  contextual-retrieval prefix to each chunk.
- ``index_chunks`` — upserts to Milvus and Neo4j concurrently (the Neo4j leg
  is skipped when ``enable_graph_retrieval`` is off).

Splitting prep from indexing makes the heavy work visible in the Studio UI —
chunking + LLM contextualization typically dominates wall time, the upsert is
fast.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from sovereign_rag.chunking import chunk_document, contextualize
from sovereign_rag.config import get_settings
from sovereign_rag.documents import SourceDocument
from sovereign_rag.graphs.indexer.state import IndexerState
from sovereign_rag.shared.pipeline_deps import get_pipeline

logger = logging.getLogger(__name__)


def _hydrate(doc: SourceDocument | dict[str, Any]) -> SourceDocument:
    """Accept either a SourceDocument or a JSON-shaped dict.

    Lets clients invoking via the LangGraph Platform API post a plain JSON
    object without needing to know about the dataclass.
    """
    if isinstance(doc, SourceDocument):
        return doc
    return SourceDocument(**doc)


# ---------------------------------------------------------------------------
# Node: prepare_chunks
# ---------------------------------------------------------------------------
async def prepare_chunks(state: IndexerState) -> dict[str, object]:
    """Chunk the document and (if enabled) prepend contextual summaries."""
    s = get_settings()
    doc = _hydrate(state["document"])

    chunks = chunk_document(doc)
    if not chunks:
        logger.info("prepare_chunks: doc %s produced 0 chunks", doc.doc_id)
        return {"chunks": [], "contextualized": False}

    if s.enable_contextual_retrieval:
        chunks = await contextualize(doc, chunks)

    logger.info(
        "prepare_chunks: doc %s → %d chunks (contextualized=%s)",
        doc.doc_id,
        len(chunks),
        s.enable_contextual_retrieval,
    )
    return {"chunks": chunks, "contextualized": s.enable_contextual_retrieval}


# ---------------------------------------------------------------------------
# Node: index_chunks
# ---------------------------------------------------------------------------
async def index_chunks(state: IndexerState) -> dict[str, object]:
    """Upsert chunks to Milvus and (if enabled) the Neo4j graph in parallel."""
    chunks = state.get("chunks") or []
    if not chunks:
        return {"chunks_indexed": 0, "kg_indexed": False}

    pipe = get_pipeline()
    milvus = pipe._milvus
    graph = pipe._graph

    await milvus.ensure_collection()
    tasks: list[Any] = [milvus.add_chunks(chunks)]
    kg_indexed = False
    if graph is not None:
        await graph.ensure_schema()
        tasks.append(graph.add_chunks(chunks))
        kg_indexed = True

    await asyncio.gather(*tasks)
    logger.info("index_chunks: %d chunks (kg=%s)", len(chunks), kg_indexed)
    return {"chunks_indexed": len(chunks), "kg_indexed": kg_indexed}


__all__ = ["index_chunks", "prepare_chunks"]
