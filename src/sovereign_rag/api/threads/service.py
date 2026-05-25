"""Business logic for the thread CRUD endpoints.

LangGraph's ``AsyncPostgresSaver`` doesn't expose a list-all-threads or
delete-thread API — both are easy to do against the underlying tables
(``checkpoints``, ``checkpoint_writes``, ``checkpoint_blobs``). We query
through ``psycopg`` directly here so the router stays declarative.

Schema reference (LangGraph 1.x checkpoint-postgres):

- ``checkpoints(thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
   type, checkpoint, metadata)`` — one row per node-step of a thread.
- ``checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id, ...)``
- ``checkpoint_blobs(thread_id, checkpoint_ns, channel, version, ...)``

We treat the latest checkpoint per thread as the thread's "state" for
listing purposes; the full historical timeline is reachable through
``checkpointer.aget_state_history(config)`` if a UI needs it later.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import psycopg

logger = logging.getLogger(__name__)


def _decode_checkpoint(blob: Any) -> dict[str, Any] | None:
    """Best-effort decode of the ``checkpoint`` bytea column into a dict.

    The serializer is ``JsonPlusSerializer`` which encodes everything as
    JSON-with-types. We try plain UTF-8 → JSON first; on failure we just
    return ``None`` so the listing endpoint doesn't blow up on a single
    weird row.
    """
    if blob is None:
        return None
    if isinstance(blob, memoryview):
        blob = bytes(blob)
    if isinstance(blob, bytes):
        try:
            text = blob.decode("utf-8", errors="replace")
            data = json.loads(text)
            return data if isinstance(data, dict) else None
        except Exception:
            return None
    if isinstance(blob, dict):
        return blob
    return None


def _extract_question(values: dict[str, Any] | None) -> str | None:
    if not values:
        return None
    q = values.get("question")
    if isinstance(q, str) and q.strip():
        return q
    return None


def _extract_answer(values: dict[str, Any] | None) -> str | None:
    if not values:
        return None
    a = values.get("answer")
    if isinstance(a, str) and a.strip():
        return a
    return None


def _extract_citations(values: dict[str, Any] | None) -> int:
    if not values:
        return 0
    c = values.get("citations") or values.get("used")
    if isinstance(c, list):
        return len(c)
    if isinstance(c, int):
        return c
    return 0


async def list_threads(pg_uri: str, *, limit: int = 50) -> list[dict[str, Any]]:
    """Return one row per distinct thread_id, latest checkpoint first.

    The shape matches ``ThreadSummary`` in the router.
    """
    sql = """
        WITH latest AS (
            SELECT
                thread_id,
                MAX(checkpoint_id) AS checkpoint_id
            FROM checkpoints
            GROUP BY thread_id
        )
        SELECT
            c.thread_id,
            c.checkpoint_id,
            c.checkpoint
        FROM checkpoints c
        JOIN latest l
          ON c.thread_id = l.thread_id
         AND c.checkpoint_id = l.checkpoint_id
        ORDER BY c.checkpoint_id DESC
        LIMIT %s
    """
    try:
        async with (
            await psycopg.AsyncConnection.connect(pg_uri) as conn,
            conn.cursor() as cur,
        ):
            await cur.execute(sql, (limit,))
            rows = await cur.fetchall()
    except psycopg.errors.UndefinedTable:
        # First boot — checkpointer.setup() hasn't run yet.
        return []
    except Exception as exc:
        logger.warning("list_threads failed: %s", exc)
        return []

    out: list[dict[str, Any]] = []
    for thread_id, checkpoint_id, checkpoint_blob in rows:
        values = (_decode_checkpoint(checkpoint_blob) or {}).get("channel_values")
        answer = _extract_answer(values)
        snippet = (answer[:200] + "…") if answer and len(answer) > 200 else answer
        out.append(
            {
                "thread_id": thread_id,
                "question": _extract_question(values),
                "answer_snippet": snippet,
                "citations": _extract_citations(values),
                "updated_at": str(checkpoint_id) if checkpoint_id else None,
            }
        )
    return out


async def read_thread(checkpointer: Any, thread_id: str) -> dict[str, Any] | None:
    """Return the latest state for a single thread, or ``None`` if missing.

    Uses the checkpointer's native API rather than raw SQL so the values
    are properly deserialized.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        snapshot = await checkpointer.aget(config)
    except Exception as exc:
        logger.warning("aget(%s) failed: %s", thread_id, exc)
        return None
    if snapshot is None:
        return None
    values = snapshot.get("channel_values") if isinstance(snapshot, dict) else None
    if values is None:
        # Older API returned a StateSnapshot dataclass — try .values
        values = getattr(snapshot, "values", None)
    if not values:
        return None
    return {
        "thread_id": thread_id,
        "question": _extract_question(values),
        "answer": _extract_answer(values),
        "citations": _extract_citations(values),
        "retrieved": int(values.get("retrieved", 0)) if isinstance(values, dict) else 0,
        "used": int(values.get("used", 0)) if isinstance(values, dict) else 0,
        "updated_at": None,
    }


def _normalize_citations(raw: Any) -> list[dict[str, Any]]:
    """Coerce a checkpoint's ``citations`` value to a list of plain dicts.

    The graph state stores citations as Pydantic models, but the JSON
    deserializer returns them as dicts already (with a ``lc_kwargs`` wrapper
    for langchain types). We strip that envelope here.
    """
    if not isinstance(raw, list):
        return []
    out: list[dict[str, Any]] = []
    for item in raw:
        if isinstance(item, dict):
            inner = item.get("kwargs") if "kwargs" in item else item
            if isinstance(inner, dict):
                out.append(inner)
    return out


async def read_thread_messages(checkpointer: Any, thread_id: str) -> list[dict[str, Any]]:
    """Walk the checkpoint history and return one (user, assistant) pair per turn.

    The graph state schema overwrites ``question`` / ``answer`` each turn, so
    we iterate ``alist`` chronologically and emit a new pair every time both
    fields are present and ``answer`` differs from what we've already emitted.

    Returns a flat list of message dicts in the order the conversation
    happened — ready to render in the UI's conversation timeline.
    """
    config = {"configurable": {"thread_id": thread_id}}
    try:
        snapshots: list[Any] = []
        async for snap in checkpointer.alist(config):
            snapshots.append(snap)
    except Exception as exc:
        logger.warning("alist(%s) failed: %s", thread_id, exc)
        return []
    # alist yields newest-first; reverse so we walk forwards in time.
    snapshots.reverse()

    messages: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for snap in snapshots:
        values: Any
        # CheckpointTuple-like; values are under .checkpoint.channel_values
        cp = getattr(snap, "checkpoint", None)
        if isinstance(cp, dict):
            values = cp.get("channel_values")
        else:
            values = (
                snap.get("channel_values") if isinstance(snap, dict) else None
            ) or getattr(snap, "values", None)
        if not isinstance(values, dict):
            continue
        q = _extract_question(values)
        a = _extract_answer(values)
        if not q or not a:
            continue
        key = (q, a)
        if key in seen:
            continue
        seen.add(key)
        citations = _normalize_citations(values.get("citations"))
        messages.append({"role": "user", "content": q})
        messages.append(
            {
                "role": "assistant",
                "content": a,
                "citations": citations,
                "retrieved": int(values.get("retrieved", 0) or 0),
                "used": int(values.get("used", 0) or 0),
            },
        )
    return messages


async def delete_thread(pg_uri: str, thread_id: str) -> int:
    """Wipe every checkpoint row for ``thread_id``. Returns the row count.

    Touches all three checkpoint tables so the thread is fully gone.
    """
    deleted_checkpoints = 0
    try:
        async with await psycopg.AsyncConnection.connect(pg_uri) as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM checkpoint_writes WHERE thread_id = %s", (thread_id,)
                )
                await cur.execute(
                    "DELETE FROM checkpoint_blobs WHERE thread_id = %s", (thread_id,)
                )
                await cur.execute(
                    "DELETE FROM checkpoints WHERE thread_id = %s", (thread_id,)
                )
                deleted_checkpoints = cur.rowcount or 0
            await conn.commit()
    except psycopg.errors.UndefinedTable:
        return 0
    except Exception as exc:
        logger.warning("delete_thread(%s) failed: %s", thread_id, exc)
        return 0
    return deleted_checkpoints


__all__ = ["delete_thread", "list_threads", "read_thread", "read_thread_messages"]
