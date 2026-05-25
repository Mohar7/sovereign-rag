"""State contract for the indexer graph.

The input is a parsed ``SourceDocument`` (already converted to text/markdown by
the ingestion layer — Docling for files, Crawl4AI for web). The graph chunks
it, optionally contextualizes, and upserts into Milvus (and Neo4j when graph
retrieval is enabled).

Notes on serialization: the LangGraph CLI / Platform serializes state via the
checkpointer. ``SourceDocument`` / ``Chunk`` are slotted dataclasses, which the
default JsonPlusSerializer handles fine. Callers invoking the graph from JSON
(e.g. the LangGraph Platform API) should pass ``document`` as a dict; the first
node hydrates it.
"""

from __future__ import annotations

from typing import TypedDict

from sovereign_rag.documents import Chunk, SourceDocument


class IndexerState(TypedDict, total=False):
    """State threaded through the indexer graph."""

    # -- input --
    # Either a SourceDocument or a JSON-shaped dict (hydrated on entry).
    document: SourceDocument | dict[str, object]

    # -- working state --
    chunks: list[Chunk]
    contextualized: bool

    # -- output --
    chunks_indexed: int
    kg_indexed: bool  # whether the Neo4j leg ran (depends on enable_graph_retrieval)


__all__ = ["IndexerState"]
