"""Process-wide handle to the singleton ``RAGPipeline``.

Graph nodes are pure functions of state and don't carry a FastAPI app
reference, so we expose the pipeline via a module-level accessor.

Two callers populate it:

1. **FastAPI lifespan** — calls ``set_pipeline(p)`` at startup and
   ``set_pipeline(None)`` at shutdown. Lets FastAPI own ``aclose()`` so the
   Milvus / Neo4j clients close cleanly.

2. **LangGraph deployment** (``langgraph dev`` / ``langgraph build`` /
   LangGraph Platform) — does *not* run FastAPI, so it never reaches the
   lifespan. ``get_pipeline()`` lazy-constructs the singleton on first call
   instead of raising. The client connections live for the lifetime of the
   runtime process, which is what we want there.
"""

from __future__ import annotations

import logging
import threading
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from sovereign_rag.retrieval.pipeline import RAGPipeline

logger = logging.getLogger(__name__)

_pipeline: RAGPipeline | None = None
_lock = threading.Lock()


def set_pipeline(pipeline: RAGPipeline | None) -> None:
    """Install (or clear) the process-wide pipeline. Called from the FastAPI
    lifespan; not needed under a LangGraph-only deployment."""
    global _pipeline
    with _lock:
        _pipeline = pipeline


def get_pipeline() -> RAGPipeline:
    """Return the singleton, building it lazily if no one set it.

    The first call from a LangGraph runtime takes ~1-2 s while the Milvus and
    Neo4j async clients open; subsequent calls reuse the same instance.
    """
    global _pipeline
    if _pipeline is not None:
        return _pipeline
    with _lock:
        if _pipeline is None:
            from sovereign_rag.retrieval.pipeline import RAGPipeline

            logger.info("shared.pipeline_deps: lazy-initializing RAGPipeline")
            _pipeline = RAGPipeline()
    return _pipeline


__all__ = ["get_pipeline", "set_pipeline"]
