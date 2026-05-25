"""Run-history persistence — write + read against Postgres.

We re-use the same database the LangGraph checkpointer already opens
(``langgraph_pg_uri``). Adds a single ``runs`` table that records every
``/ask`` invocation: question, answer, citations, per-stage timings,
overrides used, and timing/status metadata. The table is created
lazily on app startup via :func:`ensure_runs_table` so a brand-new
deploy has no migration step.

The frontend's Run history screen reads from :func:`list_runs`.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import psycopg

logger = logging.getLogger(__name__)


_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS runs (
    id BIGSERIAL PRIMARY KEY,
    thread_id TEXT NOT NULL,
    question TEXT NOT NULL,
    answer TEXT,
    retrieved INT NOT NULL DEFAULT 0,
    used INT NOT NULL DEFAULT 0,
    citations JSONB NOT NULL DEFAULT '[]'::jsonb,
    timings JSONB NOT NULL DEFAULT '{}'::jsonb,
    overrides JSONB,
    model TEXT,
    status TEXT NOT NULL DEFAULT 'ok',
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_INDEXES_SQL = [
    "CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs (created_at DESC);",
    "CREATE INDEX IF NOT EXISTS idx_runs_thread_id ON runs (thread_id);",
]


async def ensure_runs_table(pg_uri: str) -> None:
    """Idempotent: create the runs table + indexes if they don't exist."""
    try:
        async with (
            await psycopg.AsyncConnection.connect(pg_uri) as conn,
            conn.cursor() as cur,
        ):
            await cur.execute(_CREATE_SQL)
            for stmt in _INDEXES_SQL:
                await cur.execute(stmt)
            await conn.commit()
        logger.info("runs table ready")
    except Exception as exc:
        # Non-fatal: the app still serves /ask without persistence.
        logger.warning("ensure_runs_table failed: %s", exc)


async def record_run(
    pg_uri: str,
    *,
    thread_id: str,
    question: str,
    answer: str | None,
    retrieved: int,
    used: int,
    citations: list[dict[str, Any]],
    timings: dict[str, Any],
    overrides: dict[str, Any] | None,
    model: str | None,
    status: str = "ok",
    error: str | None = None,
) -> None:
    """Insert one row into ``runs``. Best-effort: errors are logged, not raised.

    Called from /ask and /ask/stream after the graph completes (or fails).
    Keeping this out of the request-handler critical path means a Postgres
    blip doesn't break the user-visible response.
    """
    sql = """
        INSERT INTO runs (thread_id, question, answer, retrieved, used,
                          citations, timings, overrides, model, status, error)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s)
    """
    try:
        async with (
            await psycopg.AsyncConnection.connect(pg_uri) as conn,
            conn.cursor() as cur,
        ):
            await cur.execute(
                sql,
                (
                    thread_id,
                    question,
                    answer,
                    int(retrieved),
                    int(used),
                    json.dumps(citations),
                    json.dumps(timings),
                    json.dumps(overrides) if overrides is not None else None,
                    model,
                    status,
                    error,
                ),
            )
            await conn.commit()
    except Exception as exc:
        logger.warning("record_run failed: %s", exc)


async def list_runs(pg_uri: str, *, limit: int = 50) -> list[dict[str, Any]]:
    """Return the most-recent runs (newest first)."""
    sql = """
        SELECT id, thread_id, question, answer, retrieved, used,
               citations, timings, overrides, model, status, error, created_at
        FROM runs
        ORDER BY created_at DESC
        LIMIT %s
    """
    try:
        async with (
            await psycopg.AsyncConnection.connect(pg_uri) as conn,
            conn.cursor() as cur,
        ):
            await cur.execute(sql, (limit,))
            rows = await cur.fetchall()
            cols = [c.name for c in cur.description] if cur.description else []
    except psycopg.errors.UndefinedTable:
        # Table not yet created — ensure_runs_table will run on next boot.
        return []
    except Exception as exc:
        logger.warning("list_runs failed: %s", exc)
        return []
    return [dict(zip(cols, r, strict=False)) for r in rows]


__all__ = ["ensure_runs_table", "list_runs", "record_run"]
