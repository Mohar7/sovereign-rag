"""StateGraph wiring.

Two exports:

- ``graph`` — the *uncompiled* ``StateGraph``. ``langgraph dev`` and the
  Studio UI consume this and provide their own (in-memory) checkpointer,
  so the dev server works out of the box without Postgres.
- ``build_graph(checkpointer)`` — factory returning a compiled ``CompiledGraph``
  with the supplied checkpointer (FastAPI uses ``AsyncPostgresSaver`` here
  so threads persist across restarts).

Shape:
    START -> retrieve_local -> {web_fallback (HITL) | rerank} -> rerank -> generate -> END
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from langgraph.graph import END, START, StateGraph

from sovereign_rag.agent.nodes import (
    decide_after_local,
    do_rerank,
    generate,
    retrieve_local,
    web_fallback,
)
from sovereign_rag.agent.state import RAGState

if TYPE_CHECKING:
    from langgraph.checkpoint.base import BaseCheckpointSaver


def _build_state_graph() -> StateGraph[RAGState]:
    g: StateGraph[RAGState] = StateGraph(RAGState)
    g.add_node("retrieve_local", retrieve_local)
    g.add_node("web_fallback", web_fallback)
    g.add_node("rerank", do_rerank)
    g.add_node("generate", generate)

    g.add_edge(START, "retrieve_local")
    g.add_conditional_edges(
        "retrieve_local",
        decide_after_local,
        {"web_fallback": "web_fallback", "rerank": "rerank"},
    )
    # Web fallback always re-routes through rerank; the node itself marks
    # ``web_fallback_attempted`` so the conditional edge can't recurse.
    g.add_edge("web_fallback", "rerank")
    g.add_edge("rerank", "generate")
    g.add_edge("generate", END)
    return g


# Uncompiled — for `langgraph dev` / Studio. The CLI attaches its own
# in-memory checkpointer.
graph = _build_state_graph()


def build_graph(checkpointer: BaseCheckpointSaver[Any] | None = None) -> Any:
    """Compile the graph with a production checkpointer (Postgres in prod)."""
    return _build_state_graph().compile(checkpointer=checkpointer)


__all__ = ["build_graph", "graph"]
