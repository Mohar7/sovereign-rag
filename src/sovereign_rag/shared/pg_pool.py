"""Process-wide handle to the shared psycopg connection pool.

The FastAPI lifespan opens one ``AsyncConnectionPool`` — the same pool that
backs the LangGraph ``AsyncPostgresSaver`` checkpointer — and installs it here
so the runs/threads services reuse it instead of opening a fresh
``psycopg.AsyncConnection`` per request. One pool, validated + reconnecting
connections, safe under concurrency.

Only the FastAPI app populates this; the routes that call ``get_pg_pool()``
(runs, threads, /ask persistence) are served exclusively by FastAPI, so the
pool is always installed by the time they run.
"""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from psycopg import AsyncConnection
    from psycopg.rows import DictRow
    from psycopg_pool import AsyncConnectionPool

logger = logging.getLogger(__name__)

_pool: AsyncConnectionPool[AsyncConnection[DictRow]] | None = None


def set_pg_pool(pool: AsyncConnectionPool[AsyncConnection[DictRow]] | None) -> None:
    """Install (or clear) the process-wide Postgres pool. Called from the
    FastAPI lifespan at startup and shutdown."""
    global _pool
    _pool = pool


def get_pg_pool() -> AsyncConnectionPool[AsyncConnection[DictRow]]:
    """Return the shared pool, or raise if the lifespan never installed it."""
    if _pool is None:
        raise RuntimeError(
            "Postgres pool not initialized — set_pg_pool() runs in the FastAPI lifespan."
        )
    return _pool


__all__ = ["get_pg_pool", "set_pg_pool"]
