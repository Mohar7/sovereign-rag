"""``/api/evals/*`` — surface ``eval/results.json`` for the Evals dashboard.

The eval harness in ``eval/evaluate.py`` writes its output to
``eval/results.json`` after each run. We don't (yet) keep historical
runs — every harness invocation overwrites that file — so the API
exposes only:

- :func:`evals_latest` — the most recent results JSON, surfaced as the
  same shape ``evaluate.py`` writes. Returns ``{available: false}``
  when no results file exists yet.

When historical runs are introduced (a ``eval/runs/<timestamp>.json``
archive layout), :func:`evals_runs` will list them. Today it returns
``[]`` so the frontend can render an empty state.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/evals", tags=["evals"])


# Resolve eval/results.json relative to the repo root. ``__file__`` here is
# src/sovereign_rag/api/evals/router.py, so three .parent hops reach src/,
# one more reaches the repo root.
_REPO_ROOT = Path(__file__).resolve().parent.parent.parent.parent.parent
_RESULTS_PATH = _REPO_ROOT / "eval" / "results.json"


# ─────────────────────────────────────────────────────────────────
# schemas
# ─────────────────────────────────────────────────────────────────


class RetrievalPerQuestion(BaseModel):
    question: str
    n_retrieved: int = 0
    precision_at_k: float = Field(0.0, alias="precision@5")
    recall_at_k: float = Field(0.0, alias="recall@5")
    mrr: float = 0.0
    ndcg_at_k: float = Field(0.0, alias="ndcg@5")

    class Config:
        populate_by_name = True


class RetrievalAggregate(BaseModel):
    n_retrieved: float = 0.0
    precision_at_k: float = Field(0.0, alias="precision@5")
    recall_at_k: float = Field(0.0, alias="recall@5")
    mrr: float = 0.0
    ndcg_at_k: float = Field(0.0, alias="ndcg@5")

    class Config:
        populate_by_name = True


def _empty_aggregate() -> RetrievalAggregate:
    return RetrievalAggregate.model_validate({})


class RetrievalBlock(BaseModel):
    per_question: list[RetrievalPerQuestion] = Field(default_factory=list)
    aggregate: RetrievalAggregate = Field(default_factory=_empty_aggregate)


class RagasBlock(BaseModel):
    available: bool = False
    scores: dict[str, float] = Field(default_factory=dict)
    reason: str | None = None


class EvalsResults(BaseModel):
    """The whole results.json payload, plus metadata about the file."""

    available: bool
    mode: str = "live"
    k: int = 5
    retrieval: RetrievalBlock = Field(default_factory=RetrievalBlock)
    ragas: RagasBlock = Field(default_factory=RagasBlock)
    generated_at: datetime | None = None
    path: str | None = None


class EvalsRunSummary(BaseModel):
    """One row in the (future) historical runs list. Empty today."""

    id: str
    generated_at: datetime
    precision_at_k: float = Field(0.0, alias="precision@5")
    ndcg_at_k: float = Field(0.0, alias="ndcg@5")
    faithfulness: float | None = None

    class Config:
        populate_by_name = True


# ─────────────────────────────────────────────────────────────────
# routes
# ─────────────────────────────────────────────────────────────────


def _load_results() -> tuple[dict[str, Any] | None, datetime | None]:
    """Read + parse ``eval/results.json``. Returns ``(payload, mtime)``."""
    if not _RESULTS_PATH.exists():
        return None, None
    try:
        raw = _RESULTS_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
    except Exception as exc:
        logger.warning("failed to parse %s: %s", _RESULTS_PATH, exc)
        raise HTTPException(500, f"Could not parse eval/results.json: {exc}") from exc
    mtime = datetime.fromtimestamp(_RESULTS_PATH.stat().st_mtime).astimezone()
    return data, mtime


@router.get("/latest", response_model=EvalsResults)
async def evals_latest() -> EvalsResults:
    """Return the most recent eval results, or ``available: false`` if absent."""
    data, mtime = _load_results()
    if data is None:
        return EvalsResults(available=False)
    return EvalsResults(
        available=True,
        mode=str(data.get("mode") or "live"),
        k=int(data.get("k") or 5),
        retrieval=RetrievalBlock(**(data.get("retrieval") or {})),
        ragas=RagasBlock(**(data.get("ragas") or {})),
        generated_at=mtime,
        path=str(_RESULTS_PATH.relative_to(_REPO_ROOT)),
    )


@router.get("/runs", response_model=list[EvalsRunSummary])
async def evals_runs() -> list[EvalsRunSummary]:
    """List historical eval runs.

    Today this is always empty — the harness overwrites ``eval/results.json``
    instead of archiving. When archive support lands (planned: a
    ``eval/runs/<timestamp>.json`` layout), this endpoint enumerates them.
    """
    return []


__all__ = ["router"]
