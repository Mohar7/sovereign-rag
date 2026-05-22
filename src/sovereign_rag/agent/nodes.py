"""Graph nodes — each is a small async function over ``RAGState``.

Nodes don't own services; they fetch the pipeline / config / search and
crawl callables from the dependency module so they stay testable
(unit tests can swap any of them out).
"""

from __future__ import annotations

import logging
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import interrupt

from sovereign_rag.agent._deps import get_pipeline
from sovereign_rag.agent.state import (
    INTERRUPT_REASON_APPROVE_URLS,
    CandidateURL,
    RAGState,
)
from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.ingestion import crawl_url, search
from sovereign_rag.providers.ollama import get_llm
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.retrieval.pipeline import (
    _ANSWER_SYSTEM,
    _dedup_by_chunk,
    _format_context,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Node: retrieve_local
# ---------------------------------------------------------------------------
async def retrieve_local(state: RAGState) -> dict[str, object]:
    """Hybrid Milvus + Neo4j graph local-search, deduped."""
    pipe = get_pipeline()
    # Reuse the pipeline's retrieve path up to the dedup step; we don't want
    # rerank here (we rerank after a possible web fallback).
    candidates = await _retrieve_deduped(pipe, state["question"], state.get("doc_id"))
    logger.info("retrieve_local: %d candidates", len(candidates))
    return {"candidates": candidates}


async def _retrieve_deduped(
    pipe: object, question: str, doc_id: str | None
) -> list[RetrievedChunk]:
    """Run Milvus hybrid + Neo4j graph (if enabled), dedup, no rerank.

    Mirrors ``RAGPipeline.retrieve`` up to the rerank step. Kept here so
    the agent can decide whether to rerank now or after a web fallback.
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
# Conditional edge: should we run a web fallback?
# ---------------------------------------------------------------------------
def decide_after_local(state: RAGState) -> Literal["web_fallback", "rerank"]:
    """If local retrieval came up short and we haven't already tried, fallback."""
    s = get_settings()
    candidates = state.get("candidates") or []
    if state.get("web_fallback_attempted"):
        return "rerank"
    if s.web_fallback_min_chunks <= 0:
        return "rerank"
    if len(candidates) >= s.web_fallback_min_chunks:
        return "rerank"
    return "web_fallback"


# ---------------------------------------------------------------------------
# Node: web_fallback (HITL)
# ---------------------------------------------------------------------------
async def web_fallback(state: RAGState) -> dict[str, object]:
    """Search the web, ask the user which URLs to crawl, ingest the approved.

    Flow:
      1. SearXNG search → list[{url, title, snippet}]
      2. ``interrupt({reason, candidate_urls})`` → graph pauses.
      3. Client resumes with ``Command(resume={"approved_urls": [...]})``.
      4. Crawl + index each approved URL.
      5. Re-run local retrieval; mark ``web_fallback_attempted=True`` so we
         don't loop.
    """
    s = get_settings()

    candidate_urls: list[CandidateURL] = []
    try:
        hits = await search(state["question"], max_results=s.web_fallback_max_urls)
        candidate_urls = [
            CandidateURL(
                url=str(h.get("url", "")),
                title=str(h.get("title", "")),
                snippet=str(h.get("snippet", "")),
            )
            for h in hits
            if h.get("url")
        ]
    except Exception as exc:
        logger.warning("web search failed: %s", exc)

    if not candidate_urls:
        # Nothing to approve. Mark attempted and fall through to rerank
        # with whatever local candidates we already had — no need to touch
        # the pipeline.
        return {"web_fallback_attempted": True, "fallback_used": False}

    # Pause for human approval. The resume payload is expected to be
    # ``{"approved_urls": [url, ...]}``; an empty list means "skip all".
    decision = interrupt(
        {
            "reason": INTERRUPT_REASON_APPROVE_URLS,
            "candidate_urls": candidate_urls,
        }
    )
    approved: list[str] = []
    if isinstance(decision, dict):
        raw = decision.get("approved_urls") or []
        approved = [str(u) for u in raw if isinstance(u, str)]
    logger.info("user approved %d of %d candidate URLs", len(approved), len(candidate_urls))

    # Only touch the pipeline once we actually have URLs to crawl + index.
    pipe = get_pipeline()
    indexed_any = False
    for url in approved:
        try:
            doc = await crawl_url(url)
        except Exception as exc:
            logger.warning("crawl failed for %s: %s", url, exc)
            continue
        await pipe.index_document(doc)
        indexed_any = True

    # Re-run local retrieval; even if nothing was ingested, mark attempted
    # so we don't recurse.
    candidates = await _retrieve_deduped(pipe, state["question"], state.get("doc_id"))
    return {
        "candidates": candidates,
        "web_fallback_attempted": True,
        "fallback_used": indexed_any,
    }


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
    llm = get_llm()
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
    "decide_after_local",
    "do_rerank",
    "generate",
    "retrieve_local",
    "web_fallback",
]
