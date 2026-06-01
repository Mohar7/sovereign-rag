"""``/api/runs`` — paginated audit log of /ask invocations.

The records are written by ``api/ask/router.py`` after each call; we read
them back here. ``citations`` and ``timings`` are returned verbatim from the
JSONB columns so the frontend can render the same shapes it sees on the
live SSE stream.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from sovereign_rag.api.runs.service import list_runs

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["runs"])


class RunRow(BaseModel):
    """One row in the audit log."""

    id: int
    thread_id: str
    question: str
    answer: str | None = None
    retrieved: int = 0
    used: int = 0
    citations: list[dict[str, Any]] = Field(default_factory=list)
    timings: dict[str, Any] = Field(default_factory=dict)
    overrides: dict[str, Any] | None = None
    model: str | None = None
    status: str = "ok"
    error: str | None = None
    created_at: datetime | None = None


@router.get("/runs", response_model=list[RunRow])
async def runs_list(limit: int = Query(50, ge=1, le=500)) -> list[RunRow]:
    """Return the most recent ``limit`` runs, newest first."""
    rows = await list_runs(limit=limit)
    out: list[RunRow] = []
    for r in rows:
        out.append(
            RunRow(
                id=int(r["id"]),
                thread_id=r["thread_id"],
                question=r["question"],
                answer=r.get("answer"),
                retrieved=int(r.get("retrieved") or 0),
                used=int(r.get("used") or 0),
                citations=r.get("citations") or [],
                timings=r.get("timings") or {},
                overrides=r.get("overrides"),
                model=r.get("model"),
                status=r.get("status") or "ok",
                error=r.get("error"),
                created_at=r.get("created_at"),
            ),
        )
    return out


__all__ = ["router"]
