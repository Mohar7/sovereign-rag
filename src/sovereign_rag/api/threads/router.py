"""Per-thread endpoints — checkpoint-backed list/get/delete + context pins.

The thread surface has two flavours:

- **Thread CRUD** — driven by the LangGraph ``AsyncPostgresSaver`` tables
  (``checkpoints``, ``checkpoint_writes``, ``checkpoint_blobs``). Frontend
  consumes ``GET /api/threads`` to render the Threads card grid, plus
  ``GET /api/threads/{id}`` for individual conversations and
  ``DELETE /api/threads/{id}`` to forget one.

- **Context pins** — held in ``thread_context`` (separate Postgres table)
  outside the checkpointer. Pins / exclusions are user-curated chunks
  carried across turns; the checkpointer doesn't model them.
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query, Request
from pydantic import BaseModel

from sovereign_rag.api.threads.service import (
    delete_thread,
    list_threads,
    read_thread,
    read_thread_messages,
)
from sovereign_rag.config import get_settings
from sovereign_rag.thread_context import (
    PinEntry,
    ThreadContextDoc,
    clear_thread,
    delete_pin,
    get_thread,
    upsert_pin,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["threads"])


# ---------- schemas ----------


class ThreadSummary(BaseModel):
    """One row in the Threads card grid."""

    thread_id: str
    question: str | None = None
    answer_snippet: str | None = None
    citations: int = 0
    updated_at: str | None = None
    # Joined from the runs audit table. Empty for threads that predate the
    # runs feature or that never had a recorded run.
    model: str | None = None
    status: str = "ok"
    error_count: int = 0


class ThreadDetail(BaseModel):
    """Full thread payload for the per-thread view."""

    thread_id: str
    question: str | None = None
    answer: str | None = None
    citations: int = 0
    retrieved: int = 0
    used: int = 0
    updated_at: str | None = None


class CitationModel(BaseModel):
    chunk_id: str
    doc_id: str = ""
    title: str = ""
    source_uri: str = ""
    page: int | None = None
    score: float = 0.0
    snippet: str = ""


class ThreadMessage(BaseModel):
    """One slot in the conversation timeline (alternating user/assistant)."""

    role: Literal["user", "assistant"]
    content: str
    citations: list[CitationModel] = []
    retrieved: int = 0
    used: int = 0


class PinRequest(BaseModel):
    chunk_id: str
    action: Literal["pinned", "excluded"] = "pinned"
    note: str | None = None


# ---------- thread CRUD ----------


@router.get("/threads", response_model=list[ThreadSummary])
async def threads_list(
    limit: int = Query(50, ge=1, le=500),
) -> list[ThreadSummary]:
    """Return up to ``limit`` most-recently-updated threads."""
    s = get_settings()
    rows = await list_threads(s.langgraph_pg_uri, limit=limit)
    return [ThreadSummary(**row) for row in rows]


@router.get("/threads/{thread_id}", response_model=ThreadDetail)
async def threads_get(thread_id: str, request: Request) -> ThreadDetail:
    """Return the latest checkpoint state for one thread, or 404 if unknown."""
    checkpointer = getattr(request.app.state, "checkpointer", None)
    if checkpointer is None:
        raise HTTPException(503, "Checkpointer not initialized")
    state = await read_thread(checkpointer, thread_id)
    if state is None:
        raise HTTPException(404, f"Thread {thread_id} not found")
    return ThreadDetail(**state)


@router.get("/threads/{thread_id}/messages", response_model=list[ThreadMessage])
async def threads_messages(thread_id: str, request: Request) -> list[ThreadMessage]:
    """Return the conversation timeline (one row per question or answer).

    Walks the LangGraph checkpoint history forwards and emits an alternating
    user/assistant sequence so the UI can render a real multi-turn thread.
    """
    checkpointer = getattr(request.app.state, "checkpointer", None)
    if checkpointer is None:
        raise HTTPException(503, "Checkpointer not initialized")
    rows = await read_thread_messages(checkpointer, thread_id)
    out: list[ThreadMessage] = []
    for row in rows:
        out.append(
            ThreadMessage(
                role=row["role"],
                content=row.get("content", ""),
                citations=[
                    CitationModel(**c)
                    for c in row.get("citations", [])
                    if isinstance(c, dict) and c.get("chunk_id")
                ],
                retrieved=int(row.get("retrieved", 0) or 0),
                used=int(row.get("used", 0) or 0),
            ),
        )
    return out


@router.delete("/threads/{thread_id}")
async def threads_delete(thread_id: str) -> dict[str, Any]:
    """Wipe all checkpoint state + context pins for ``thread_id``."""
    s = get_settings()
    removed = await delete_thread(s.langgraph_pg_uri, thread_id)
    pins_removed = await clear_thread(thread_id)
    return {"thread_id": thread_id, "checkpoints_removed": removed, "pins_removed": pins_removed}


# ---------- thread context (pins + exclusions) ----------


@router.get("/threads/{thread_id}/context", response_model=ThreadContextDoc)
async def thread_context_get(thread_id: str) -> ThreadContextDoc:
    """Return all pins + exclusions for a thread (empty list for unknown id)."""
    return await get_thread(thread_id)


@router.post("/threads/{thread_id}/context", response_model=PinEntry)
async def thread_context_post(thread_id: str, body: PinRequest) -> PinEntry:
    """Pin or exclude a chunk in the thread (idempotent on chunk_id)."""
    return await upsert_pin(thread_id, body.chunk_id, body.action, body.note)


@router.delete("/threads/{thread_id}/context/{chunk_id}")
async def thread_context_delete(thread_id: str, chunk_id: str) -> dict[str, bool]:
    """Remove one pin/exclusion. 404 if no such entry."""
    removed = await delete_pin(thread_id, chunk_id)
    if not removed:
        raise HTTPException(status_code=404, detail="no such pin/exclusion")
    return {"ok": True}


@router.delete("/threads/{thread_id}/context")
async def thread_context_clear(thread_id: str) -> dict[str, int]:
    """Wipe every pin/exclusion for the thread. Returns the count removed."""
    return {"removed": await clear_thread(thread_id)}


__all__ = ["router"]
