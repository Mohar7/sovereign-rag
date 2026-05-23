"""Per-thread chunk pins and exclusions, persisted to a JSON file.

The Context Manager UI lets the user pin chunks (survive summarisation)
and exclude chunks (drop from the next turn's context). Both are
thread-scoped — they only affect the conversation they belong to.

Storage is a single JSON document on disk because:

* the data is tiny (a few dozen rows per thread, max);
* it survives FastAPI restarts without a schema migration;
* it doesn't compete with the LangGraph checkpointer for Postgres
  connections during high-throughput streaming.

If volume ever grows we can promote to its own Postgres table without
touching the call sites — the public surface is the four functions at
the bottom of the module.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Literal

from pydantic import BaseModel

# We deliberately place the file under .runtime/ so it sits next to other
# runtime-only artefacts (deploy markers, log truncation buffers) and is
# ignored by git.
_STORE_PATH = Path(__file__).resolve().parent.parent.parent / ".runtime" / "thread_context.json"

# Single asyncio lock — all I/O is in-process and short. Avoids a
# torn write when two HTTP requests mutate the same thread at once.
_lock = asyncio.Lock()


PinAction = Literal["pinned", "excluded"]


class PinEntry(BaseModel):
    chunk_id: str
    action: PinAction
    note: str | None = None
    created_at: str  # ISO-8601 UTC


class ThreadContextDoc(BaseModel):
    """Materialised view of one thread's pins + exclusions."""

    thread_id: str
    pins: list[PinEntry]


def _load_raw() -> dict[str, list[dict[str, str | None]]]:
    if not _STORE_PATH.exists():
        return {}
    try:
        data: dict[str, list[dict[str, str | None]]] = json.loads(
            _STORE_PATH.read_text(encoding="utf-8")
        )
        return data
    except json.JSONDecodeError:
        # A corrupted file shouldn't crash the API. Wipe and restart with
        # an empty store. The next pin operation will rewrite cleanly.
        _STORE_PATH.write_text("{}", encoding="utf-8")
        return {}


def _save_raw(data: dict[str, list[dict[str, str | None]]]) -> None:
    _STORE_PATH.parent.mkdir(parents=True, exist_ok=True)
    # Write to a sibling temp file then rename so a crash mid-write doesn't
    # leave a half-flushed JSON on disk.
    tmp = _STORE_PATH.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(data, indent=2, sort_keys=True), encoding="utf-8")
    tmp.replace(_STORE_PATH)


async def get_thread(thread_id: str) -> ThreadContextDoc:
    """Return everything we know about a thread's pinned/excluded chunks."""
    async with _lock:
        raw = _load_raw()
    rows = raw.get(thread_id, [])
    pins = [PinEntry.model_validate(r) for r in rows]
    return ThreadContextDoc(thread_id=thread_id, pins=pins)


async def upsert_pin(
    thread_id: str,
    chunk_id: str,
    action: PinAction,
    note: str | None = None,
) -> PinEntry:
    """Pin or exclude a chunk in the thread. Idempotent on (thread_id, chunk_id)."""
    entry = PinEntry(
        chunk_id=chunk_id,
        action=action,
        note=note,
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
    )
    async with _lock:
        raw = _load_raw()
        rows = raw.get(thread_id, [])
        rows = [r for r in rows if r.get("chunk_id") != chunk_id]
        rows.append(entry.model_dump())
        raw[thread_id] = rows
        _save_raw(raw)
    return entry


async def delete_pin(thread_id: str, chunk_id: str) -> bool:
    """Remove a pin/exclusion. Returns True if a row was deleted."""
    async with _lock:
        raw = _load_raw()
        rows = raw.get(thread_id, [])
        new_rows = [r for r in rows if r.get("chunk_id") != chunk_id]
        if len(new_rows) == len(rows):
            return False
        raw[thread_id] = new_rows
        _save_raw(raw)
    return True


async def clear_thread(thread_id: str) -> int:
    """Drop every pin/exclusion for a thread. Returns the count removed."""
    async with _lock:
        raw = _load_raw()
        removed = len(raw.get(thread_id, []))
        if thread_id in raw:
            del raw[thread_id]
            _save_raw(raw)
    return removed


__all__ = [
    "PinAction",
    "PinEntry",
    "ThreadContextDoc",
    "clear_thread",
    "delete_pin",
    "get_thread",
    "upsert_pin",
]
