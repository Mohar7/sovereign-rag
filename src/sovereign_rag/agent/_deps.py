"""Process-wide handle to the singleton RAGPipeline.

Graph nodes are pure functions of state and don't carry a FastAPI app
reference, so we expose the pipeline via a module-level setter that the
FastAPI lifespan populates at startup. Keep the surface small —
production code should only call ``get_pipeline`` from inside a node.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sovereign_rag.retrieval.pipeline import RAGPipeline


_pipeline: RAGPipeline | None = None


def set_pipeline(pipeline: RAGPipeline | None) -> None:
    """Install (or clear) the process-wide pipeline. Called from lifespan."""
    global _pipeline
    _pipeline = pipeline


def get_pipeline() -> RAGPipeline:
    """Return the installed pipeline or raise if startup hasn't run."""
    if _pipeline is None:
        raise RuntimeError(
            "RAGPipeline is not initialized — startup hasn't finished or "
            "set_pipeline was never called (e.g. running graph outside the FastAPI app)."
        )
    return _pipeline


__all__ = ["get_pipeline", "set_pipeline"]
