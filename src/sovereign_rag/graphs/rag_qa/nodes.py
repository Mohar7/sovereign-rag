"""Graph nodes — each is a small async function over ``RAGState``.

Nodes don't own services; they fetch the pipeline / config / LLM / reranker
from the shared layer so they stay testable (unit tests can swap any of
them out via monkeypatch).
"""

from __future__ import annotations

import logging
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.retrieval.grading import grade_candidates
from sovereign_rag.graphs.rag_qa.state import RAGState
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.retrieval.pipeline import (
    _ANSWER_SYSTEM,
    _dedup_by_chunk,
    _format_context,
)
from sovereign_rag.shared.llm_factory import get_chat_model
from sovereign_rag.shared.pipeline_deps import get_pipeline

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node: retrieve_local
# ---------------------------------------------------------------------------
async def retrieve_local(state: RAGState) -> dict[str, object]:
    """Hybrid Milvus + Neo4j graph local-search, deduped."""
    pipe = get_pipeline()
    candidates = await _retrieve_deduped(pipe, state["question"], state.get("doc_id"))
    logger.info("retrieve_local: %d candidates", len(candidates))
    return {"candidates": candidates}


async def _retrieve_deduped(
    pipe: object, question: str, doc_id: str | None
) -> list[RetrievedChunk]:
    """Run Milvus hybrid + Neo4j graph (if enabled), dedup, no rerank.

    Mirrors ``RAGPipeline.retrieve`` up to the rerank step. Kept here so the
    agent node owns dedup independently of the synchronous pipeline path.
    """
    import asyncio

    milvus = pipe._milvus  # type: ignore[attr-defined]
    graph = pipe._graph  # type: ignore[attr-defined]

    coros = [milvus.hybrid_search(question, doc_id=doc_id)]
    if graph is not None:
        coros.append(graph.local_search(question))

    results = await asyncio.gather(*coros, return_exceptions=True)
    merged: list[RetrievedChunk] = []
    for r in results:
        if isinstance(r, BaseException):
            logger.warning("a retriever failed: %s", r)
            continue
        merged.extend(r)
    return _dedup_by_chunk(merged)


# ---------------------------------------------------------------------------
# Node: rerank
# ---------------------------------------------------------------------------
async def do_rerank(state: RAGState) -> dict[str, object]:
    """Cross-encoder rerank → top_k."""
    s = get_settings()
    candidates = state.get("candidates") or []
    reranked = rerank(state["question"], candidates, top_k=s.rerank_top_k) if candidates else []
    return {"reranked": reranked, "retrieved": len(candidates)}


# ---------------------------------------------------------------------------
# Node: grade  (CRAG)
# ---------------------------------------------------------------------------
async def grade(state: RAGState) -> dict[str, object]:
    """Grade the reranked context; flatten the Grade into state primitives."""
    s = get_settings()
    reranked = state.get("reranked") or []
    g = await grade_candidates(state["question"], reranked, s)
    logger.info("grade: %s (%.3f) — %s", g.label, g.confidence, g.reason)
    return {
        "grade": g.label,
        "grade_confidence": g.confidence,
        "grade_reason": g.reason,
    }


def route_after_grade(state: RAGState) -> Literal["transform_query", "generate"]:
    """Conditional edge after grade. Weak + under the correction budget → correct
    via the web; otherwise answer with what we have."""
    s = get_settings()
    if not s.enable_corrective_rag:
        return "generate"
    label = state.get("grade")
    attempts = state.get("correction_attempts", 0)
    if label in ("ambiguous", "incorrect") and attempts < s.crag_max_corrections:
        return "transform_query"
    return "generate"


# ---------------------------------------------------------------------------
# Node: generate
# ---------------------------------------------------------------------------
async def generate(state: RAGState) -> dict[str, object]:
    """LLM answer with inline [n] citations."""
    reranked = state.get("reranked") or []
    if not reranked:
        return {
            "answer": "I couldn't find anything relevant in the indexed sources.",
            "citations": [],
            "used": 0,
        }

    context_block, citations = _format_context(reranked)
    llm = get_chat_model(model_tier="default")
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_ANSWER_SYSTEM),
            HumanMessage(
                content=f"Context passages:\n{context_block}\n\nQuestion: {state['question']}"
            ),
        ]
    )
    answer_text = resp.content if isinstance(resp.content, str) else str(resp.content)
    return {
        "answer": answer_text.strip(),
        "citations": citations,
        "used": len(citations),
    }


__all__ = [
    "do_rerank",
    "generate",
    "retrieve_local",
]
