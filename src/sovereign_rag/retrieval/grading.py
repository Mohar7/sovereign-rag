"""Hybrid retrieval grader for Corrective RAG.

Grades the *reranked* candidates so it reads the calibrated cross-encoder
relevance score (``RetrievedChunk.score`` with ``source="reranked"``) rather
than a fresh model. The score is sigmoid-normalized to (0, 1) so the
thresholds are stable and interpretable:

    norm(top1) >= crag_correct_threshold   → "correct"   (no LLM)
    norm(top1) <= crag_incorrect_threshold → "incorrect" (no LLM)
    in between                             → one light-tier LLM call decides

Pure and service-free: the LLM call is injected as ``llm_judge`` so unit tests
(and the eval harness) run offline. Stores nothing — the node flattens the
returned ``Grade`` into ``RAGState`` primitives.
"""

from __future__ import annotations

import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from sovereign_rag.config import Settings
    from sovereign_rag.documents import RetrievedChunk

GradeLabel = Literal["correct", "ambiguous", "incorrect"]

# An injectable async judge: (question, top-k snippets) -> (label, one-line reason).
LlmJudge = Callable[[str, list[str]], Awaitable[tuple[GradeLabel, str]]]


@dataclass(slots=True)
class Grade:
    """The grader's verdict. ``confidence`` is the normalized top-1 score (0..1)
    regardless of which path produced the label, so the UI always has a number."""

    label: GradeLabel
    confidence: float
    reason: str


def _sigmoid(x: float) -> float:
    """Numerically-stable logistic squash of an unbounded reranker logit."""
    if x >= 0:
        return 1.0 / (1.0 + math.exp(-x))
    e = math.exp(x)
    return e / (1.0 + e)


async def grade_candidates(
    question: str,
    reranked: list[RetrievedChunk],
    settings: Settings,
    *,
    llm_judge: LlmJudge | None = None,
) -> Grade:
    """Grade the reranked context. See module docstring for the band logic."""
    if not reranked:
        return Grade("incorrect", 0.0, "no candidates retrieved")

    top1 = _sigmoid(float(reranked[0].score))
    if top1 >= settings.crag_correct_threshold:
        return Grade("correct", top1, "top reranked chunk is a strong match")
    if top1 <= settings.crag_incorrect_threshold:
        return Grade("incorrect", top1, "top reranked chunk is a weak match")

    judge = llm_judge or _default_llm_judge
    snippets = [rc.chunk.raw_text[:240] for rc in reranked[: settings.rerank_top_k]]
    label, reason = await judge(question, snippets)
    return Grade(label, top1, reason)


async def _default_llm_judge(question: str, snippets: list[str]) -> tuple[GradeLabel, str]:
    """Light-tier structured grade for the uncertain middle band."""
    from typing import cast

    from pydantic import BaseModel, Field

    from sovereign_rag.config import get_settings
    from sovereign_rag.shared.llm_factory import ModelTier, get_chat_model

    class _Verdict(BaseModel):
        label: GradeLabel = Field(
            description="'correct' if the passages fully answer the question, "
            "'incorrect' if they are irrelevant, otherwise 'ambiguous'."
        )
        reason: str = Field(description="one short sentence explaining the label")

    s = get_settings()
    llm = get_chat_model(model_tier=cast(ModelTier, s.crag_grader_tier))
    structured = llm.with_structured_output(_Verdict)
    context = "\n\n".join(f"[{i + 1}] {t}" for i, t in enumerate(snippets))
    prompt = (
        f"Question: {question}\n\n"
        f"Retrieved passages:\n{context}\n\n"
        "Judge whether these passages are sufficient to answer the question."
    )
    verdict = cast(_Verdict, await structured.ainvoke(prompt))
    return verdict.label, verdict.reason


__all__ = ["Grade", "GradeLabel", "LlmJudge", "grade_candidates"]
