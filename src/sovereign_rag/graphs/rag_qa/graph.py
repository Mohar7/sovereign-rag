"""RAG QA graph factory.

Topology::

    START -> retrieve_local -> rerank -> generate -> END

Two exported factories:

- ``make_graph()`` — async, returns a freshly compiled graph with no
  checkpointer. Used by ``langgraph dev`` / Studio (it supplies its own
  in-memory checkpointer) and by tests that don't need persistence.
- ``build_graph(checkpointer)`` — sync, returns a graph compiled with the
  given checkpointer. FastAPI's lifespan calls this with an
  ``AsyncPostgresSaver`` so threads persist across restarts.

Both wire OTEL → Langfuse + the OpenInference LangChain instrumentor
exactly once per process via ``setup_tracing()``; the CallbackHandler path
drops spans under async LangGraph (see ``shared/tracing.py``).
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langgraph.graph import END, START, StateGraph

from sovereign_rag.graphs.rag_qa.nodes import (
    do_rerank,
    generate,
    retrieve_local,
)
from sovereign_rag.graphs.rag_qa.state import RAGState
from sovereign_rag.shared.tracing import setup_tracing

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver


def _build_state_graph() -> StateGraph[RAGState]:
    """Construct the uncompiled StateGraph. Shared by both factories so the
    topology lives in one place."""
    builder: StateGraph[RAGState] = StateGraph(RAGState)
    builder.add_node("retrieve_local", retrieve_local)
    builder.add_node("rerank", do_rerank)
    builder.add_node("generate", generate)

    builder.add_edge(START, "retrieve_local")
    builder.add_edge("retrieve_local", "rerank")
    builder.add_edge("rerank", "generate")
    builder.add_edge("generate", END)
    return builder


async def make_graph() -> Any:
    """Build and compile the RAG QA graph without a checkpointer.

    Graph topology::

        START -> retrieve_local -> rerank -> generate -> END
    """
    setup_tracing()
    return _build_state_graph().compile()


def build_graph(checkpointer: BaseCheckpointSaver[Any] | None = None) -> Any:
    """Compile the graph with a (production) checkpointer.

    FastAPI's lifespan passes an ``AsyncPostgresSaver`` here so QA threads
    persist across restarts. Tests can pass ``None`` to get an in-memory
    runtime.
    """
    setup_tracing()
    return _build_state_graph().compile(checkpointer=checkpointer)


__all__ = ["build_graph", "make_graph"]
