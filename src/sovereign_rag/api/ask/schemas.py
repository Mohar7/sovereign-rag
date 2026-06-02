"""Ask request / response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AskOverrides(BaseModel):
    """Per-question knob overrides applied for the duration of a single /ask call.

    Each field is optional; ``None`` means "use the current Settings value".
    The override is restored after the request, so other in-flight calls (and
    the next call from the same client) see the saved Settings again.

    NOTE: applying overrides mutates the global ``Settings`` singleton during
    the request, so concurrent /ask calls with *different* overrides will race
    on the data plane. Fine for a single-user dev system; not safe for
    multi-tenant prod (will need a contextvar-scoped settings shim).
    """

    model: str | None = Field(
        default=None,
        min_length=1,
        max_length=200,
        description="Override the LLM model for this call only. "
        "Format depends on provider (ollama tag or OpenAI model id).",
    )
    retrieve_top_k: int | None = Field(default=None, ge=1, le=500)
    rerank_top_k: int | None = Field(default=None, ge=1, le=50)
    enable_graph_retrieval: bool | None = None


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    doc_id: str | None = None
    # If supplied, the run is associated with this thread (for multi-turn).
    # Otherwise a fresh UUID is minted per call.
    thread_id: str | None = None
    overrides: AskOverrides | None = None


class CitationModel(BaseModel):
    chunk_id: str
    doc_id: str
    title: str
    source_uri: str
    page: int | None
    score: float
    snippet: str


class CandidateUrl(BaseModel):
    """One web result the human may approve for crawling."""

    url: str
    title: str
    snippet: str
    # Optional trust hint (e.g. domain not on a low-trust list). None = unknown;
    # the UI only renders an "unverified" badge when this is explicitly False.
    verified: bool | None = None


class GradeModel(BaseModel):
    """The retrieval grade surfaced to the client."""

    label: Literal["correct", "ambiguous", "incorrect"]
    confidence: float
    reason: str


class InterruptModel(BaseModel):
    """Payload when the graph paused for human URL approval."""

    reason: Literal["approve_urls"]
    candidate_urls: list[CandidateUrl] = Field(default_factory=list)


class ResumeRequest(BaseModel):
    """Body for /ask/resume. ``approved_urls`` non-empty = approve those;
    ``[]`` = decline (answer from the local corpus only)."""

    thread_id: str = Field(min_length=1)
    approved_urls: list[str] = Field(default_factory=list)


class AskResponse(BaseModel):
    thread_id: str
    status: Literal["ok", "interrupted"]
    answer: str | None = None
    citations: list[CitationModel] = Field(default_factory=list)
    retrieved: int = 0
    used: int = 0
    fallback_used: bool = False
    grade: GradeModel | None = None
    interrupt: InterruptModel | None = None


__all__ = [
    "AskOverrides",
    "AskRequest",
    "AskResponse",
    "CandidateUrl",
    "CitationModel",
    "GradeModel",
    "InterruptModel",
    "ResumeRequest",
]
