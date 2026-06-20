"""Guarded corpus re-embed — runs when the embedding model/dimension changes.

Reads the chunk text back out of Milvus, recreates both stores at the new
dimension, and re-embeds. Single-flight: a process-global state + lock means
only one reindex runs at a time, and the UI can poll progress.

v1 is in-place (a brief retrieval-unavailable window) and re-embeds twice
(Milvus ``add_chunks`` + Neo4j ``reembed_chunks``); an embed-once / atomic
dual-collection cutover is a future optimization.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass

from sovereign_rag.admin import wipe_milvus
from sovereign_rag.api.settings.service import bust_embeddings_cache
from sovereign_rag.graph.neo4j_store import Neo4jGraphStore
from sovereign_rag.vectorstore.milvus_store import MilvusHybridStore

logger = logging.getLogger(__name__)


class ReindexBusy(RuntimeError):
    """Raised when a reindex is requested while one is already running."""


@dataclass
class ReindexState:
    status: str = "idle"  # idle | running | done | error
    total: int = 0
    done_count: int = 0
    error: str | None = None


_STATE = ReindexState()
_LOCK = asyncio.Lock()


def get_reindex_state() -> ReindexState:
    return _STATE


async def reembed_corpus() -> ReindexState:
    """Re-embed the whole corpus at the current ``embed_dim``. Single-flight.

    The lock is the real mutex; callers may optimistically set ``status`` to
    ``running`` before scheduling this (for immediate UI feedback), so the busy
    check is lock-based, not status-based.
    """
    if _LOCK.locked():
        raise ReindexBusy("a reindex is already running")
    async with _LOCK:
        _STATE.status, _STATE.error, _STATE.done_count, _STATE.total = "running", None, 0, 0
        try:
            bust_embeddings_cache()
            exporter = MilvusHybridStore()
            chunks = await exporter.export_chunks()
            await exporter.close()
            _STATE.total = len(chunks)
            # Milvus: drop the old-dim collection, then recreate with a FRESH
            # store. ``ensure_collection`` on ``exporter`` would be a no-op — it
            # cached ``_ensured=True`` during export_chunks, before the drop —
            # which would leave the collection deleted. A new instance re-creates
            # it at the current embed_dim; add_chunks then re-embeds.
            await wipe_milvus()
            milvus = MilvusHybridStore()
            await milvus.ensure_collection()
            if chunks:
                await milvus.add_chunks(chunks)
            await milvus.close()
            # Neo4j: recreate the vector index at the new dim + recompute embeddings.
            graph = Neo4jGraphStore()
            await graph.reembed_chunks(chunks)
            await graph.close()
            _STATE.done_count = len(chunks)
            _STATE.status = "done"
            logger.info("reembed_corpus done: %d chunks", len(chunks))
        except Exception as exc:
            _STATE.status, _STATE.error = "error", str(exc)
            logger.exception("reembed_corpus failed")
        return _STATE


__all__ = ["ReindexBusy", "ReindexState", "get_reindex_state", "reembed_corpus"]
