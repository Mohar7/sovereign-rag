"""Shared FastAPI dependencies (``Annotated[T, Depends(...)]`` form).

Every router consumes the singleton ``RAGPipeline`` and the compiled
LangGraph from ``app.state``. These dependencies wrap that access so endpoint
signatures stay declarative and the legacy ``_pipe()`` / ``_graph()`` helpers
disappear.
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import Depends, HTTPException, Request

from sovereign_rag.retrieval.pipeline import RAGPipeline
from sovereign_rag.shared.pipeline_deps import get_pipeline as _get_pipeline


def get_pipeline_dep() -> RAGPipeline:
    """Return the singleton ``RAGPipeline``, 503-ing if not yet initialised."""
    try:
        return _get_pipeline()
    except RuntimeError as exc:
        raise HTTPException(503, "Pipeline not initialized") from exc


def get_graph_dep(request: Request) -> Any:
    """Return the compiled ``rag_qa`` graph that the lifespan installed."""
    g = getattr(request.app.state, "graph", None)
    if g is None:
        raise HTTPException(503, "Graph not initialized")
    return g


PipelineDep = Annotated[RAGPipeline, Depends(get_pipeline_dep)]
GraphDep = Annotated[Any, Depends(get_graph_dep)]


__all__ = ["GraphDep", "PipelineDep", "get_graph_dep", "get_pipeline_dep"]
