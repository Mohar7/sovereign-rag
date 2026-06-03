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

import logging
import math
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Literal

if TYPE_CHECKING:
    from sovereign_rag.config import Settings
    from sovereign_rag.documents import RetrievedChunk

logger = logging.getLogger(__name__)

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
    # rerank_top_k also controls how many snippets the LLM judge sees — tuning it down reduces grader context.
    snippets = [rc.chunk.raw_text[:240] for rc in reranked[: settings.rerank_top_k]]
    try:
        label, reason = await judge(question, snippets)
    except Exception as exc:
        # Infra failure (LLM down / unparseable). Degrade to "correct" so the
        # request still answers with the (middle-band) context it already has,
        # rather than crashing or forcing a spurious web-fallback interrupt.
        logger.warning("grade judge failed (%s); degrading to 'correct'", exc)
        return Grade("correct", top1, "grader unavailable; answered from available context")
    return Grade(label, top1, reason)


_GRADER_SYSTEM = (
    "You grade whether retrieved passages are SUFFICIENT to answer a question. "
    "Reply with exactly one word:\n"
    "- 'correct' if the passages fully answer the question,\n"
    "- 'incorrect' if they are irrelevant or do not cover the topic,\n"
    "- 'ambiguous' if they are only partially relevant.\n"
    "Output only that one word."
)


def _parse_verdict(text: str) -> tuple[GradeLabel, str]:
    """Lenient parse of a grader response into a (label, reason).

    Small light-tier models routinely ignore "reply with one word" and answer
    in prose, and they choke on JSON structured output — so we keyword-match the
    free text instead of demanding JSON. Negative/insufficient cues are checked
    BEFORE the positive ones because 'incorrect' contains 'correct' and
    'not sufficient'/'insufficient' contain 'sufficient'. Anything unrecognized
    defaults to 'ambiguous' (the safe middle that routes to web fallback)."""
    reason = " ".join(text.split())[:240] or "no grader output"
    t = text.casefold()
    if any(
        cue in t
        for cue in (
            "incorrect",
            "insufficient",
            "not sufficient",
            "irrelevant",
            "no information",
            "does not",
            "cannot answer",
            "not enough",
            "unrelated",
        )
    ):
        return "incorrect", reason
    if any(cue in t for cue in ("ambiguous", "partial", "unclear", "uncertain", "somewhat")):
        return "ambiguous", reason
    if any(cue in t for cue in ("correct", "sufficient", "fully answer", "yes")):
        return "correct", reason
    return "ambiguous", reason


async def _default_llm_judge(question: str, snippets: list[str]) -> tuple[GradeLabel, str]:
    """Light-tier grade for the uncertain middle band.

    Uses a plain one-word prompt + lenient keyword parsing rather than JSON
    structured output — small models emit prose, not valid JSON, and a parse
    failure here must never crash /ask (``grade_candidates`` also guards)."""
    from langchain_core.messages import HumanMessage, SystemMessage

    from sovereign_rag.config import get_settings
    from sovereign_rag.shared.llm_factory import get_chat_model

    s = get_settings()
    llm = get_chat_model(model_tier=s.crag_grader_tier)
    context = "\n\n".join(f"[{i + 1}] {t}" for i, t in enumerate(snippets))
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_GRADER_SYSTEM),
            HumanMessage(content=f"Question: {question}\n\nRetrieved passages:\n{context}"),
        ]
    )
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    return _parse_verdict(text)


__all__ = ["Grade", "GradeLabel", "LlmJudge", "grade_candidates"]
