"""Indexer graph factory.

Topology::

    START -> prepare_chunks -> index_chunks -> END
"""

from __future__ import annotations

from typing import Any

from langgraph.graph import END, START, StateGraph

from sovereign_rag.graphs.indexer.nodes import index_chunks, prepare_chunks
from sovereign_rag.graphs.indexer.state import IndexerState
from sovereign_rag.shared.tracing import setup_tracing


async def make_graph() -> Any:
    """Build and compile the indexer graph.

    Graph topology::

        START -> prepare_chunks -> index_chunks -> END
    """
    setup_tracing()

    builder: StateGraph[IndexerState] = StateGraph(IndexerState)
    builder.add_node("prepare_chunks", prepare_chunks)
    builder.add_node("index_chunks", index_chunks)

    builder.add_edge(START, "prepare_chunks")
    builder.add_edge("prepare_chunks", "index_chunks")
    builder.add_edge("index_chunks", END)

    return builder.compile()


__all__ = ["make_graph"]
