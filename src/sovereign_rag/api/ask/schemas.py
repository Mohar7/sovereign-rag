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


class AskResponse(BaseModel):
    thread_id: str
    status: Literal["ok"]
    answer: str | None = None
    citations: list[CitationModel] = Field(default_factory=list)
    retrieved: int = 0
    used: int = 0


__all__ = ["AskOverrides", "AskRequest", "AskResponse", "CitationModel"]
