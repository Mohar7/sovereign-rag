"""Ask request / response models."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    doc_id: str | None = None
    # If supplied, the run is associated with this thread (for multi-turn).
    # Otherwise a fresh UUID is minted per call.
    thread_id: str | None = None


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


__all__ = ["AskRequest", "AskResponse", "CitationModel"]
