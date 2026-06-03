"""State contract for the ReAct agentic-RAG graph (built when
``enable_react_agent=True``).

Two memory channels with different lifetimes:
- ``history`` — cross-turn conversation memory, a rolling window of the last
  ``react_history_turns`` (question, answer) pairs. ``HistoryTurn`` is a plain
  ``TypedDict`` so it needs no checkpoint-serde registration.
- ``scratch`` — the *current turn's* ReAct working messages (tool calls +
  observations); reset each turn by the ``prepare`` node (Plan 2). Plain
  overwrite channel (the loop is sequential, so nodes return the whole list).

``retrieved_pool`` accumulates the *full* RetrievedChunks fetched this turn
(keyed by chunk_id) so ``finalize`` can ground the answer in full passages
while the controller only ever sees compact observations.
"""

from __future__ import annotations

from typing import Annotated, TypedDict

from langchain_core.messages import AnyMessage

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation


class HistoryTurn(TypedDict):
    question: str
    answer: str


def window_history(
    existing: list[HistoryTurn] | None, new: list[HistoryTurn] | None
) -> list[HistoryTurn]:
    """Append ``new`` turns and keep only the most recent ``react_history_turns``."""
    merged = (existing or []) + (new or [])
    n = get_settings().react_history_turns
    return merged[-n:] if n > 0 else merged


class AgentState(TypedDict, total=False):
    # Inputs / per-turn
    question: str
    doc_id: str | None
    # Memory
    history: Annotated[list[HistoryTurn], window_history]  # cross-turn (windowed)
    scratch: list[AnyMessage]  # current-turn ReAct messages (overwrite)
    retrieved_pool: dict[str, RetrievedChunk]  # full chunks this turn, by id
    steps: int
    # Outputs
    answer: str | None
    citations: list[Citation]
    retrieved: int
    used: int
    fallback_used: bool
    # HITL (web fallback)
    candidate_urls: list[dict[str, str]]
    approved_urls: list[str]  # resume value; [] == decline
    declined: bool


__all__ = ["AgentState", "HistoryTurn", "window_history"]
