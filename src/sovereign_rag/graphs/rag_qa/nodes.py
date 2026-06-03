"""Graph nodes — each is a small async function over ``RAGState``.

Nodes don't own services; they fetch the pipeline / config / LLM / reranker
from the shared layer so they stay testable (unit tests can swap any of
them out via monkeypatch).
"""

from __future__ import annotations

import asyncio
import logging
from typing import Literal

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import HumanMessage, SystemMessage
from langgraph.types import Command, interrupt

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.graphs.rag_qa.state import RAGState
from sovereign_rag.ingestion.search import search
from sovereign_rag.ingestion.web import crawl_url
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.retrieval.grading import grade_candidates
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
    via the web; otherwise answer with what we have.

    Note: in the live graph this node is only wired as a conditional edge when
    ``enable_corrective_rag=True`` (a build-time structural switch decided in
    ``_build_state_graph``).  The ``if not s.enable_corrective_rag`` guard below
    is defensive for direct/unit callers that invoke the function outside the graph.
    """
    s = get_settings()
    if not s.enable_corrective_rag:
        return "generate"
    label = state.get("grade")
    attempts = state.get("correction_attempts", 0)
    if label in ("ambiguous", "incorrect") and attempts < s.crag_max_corrections:
        return "transform_query"
    return "generate"


# ---------------------------------------------------------------------------
# Node: transform_query  (CRAG)
# ---------------------------------------------------------------------------
_REWRITE_SYSTEM = (
    "Rewrite the user's question as a concise web search query. "
    "Return only the query — keywords, no punctuation, no explanation."
)


async def transform_query(state: RAGState) -> dict[str, object]:
    """Light-tier rewrite of the question into a keyword web-search query."""
    llm = get_chat_model(model_tier="light")
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_REWRITE_SYSTEM),
            HumanMessage(content=state["question"]),
        ]
    )
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    query = text.strip() or state["question"]
    logger.info("transform_query: %r", query)
    return {"search_query": query}


# ---------------------------------------------------------------------------
# Node: web_search  (CRAG) — SearXNG only; the interrupt lives in request_approval
# ---------------------------------------------------------------------------
async def web_search(state: RAGState) -> dict[str, object]:
    """Search the web for candidate URLs. No interrupt here, so resuming the
    graph never re-runs this network call (the resumed node is request_approval)."""
    s = get_settings()
    query = state.get("search_query") or state["question"]
    hits = await search(query, max_results=s.web_fallback_max_urls)
    candidates = [
        {"title": h.get("title", ""), "url": h["url"], "snippet": h.get("content", "")}
        for h in hits
        if h.get("url")
    ]
    logger.info("web_search: %d candidate urls for %r", len(candidates), query)
    return {"candidate_urls": candidates}


# ---------------------------------------------------------------------------
# Node: request_approval  (CRAG / HITL) — the only interrupt() in the graph
# ---------------------------------------------------------------------------
def _parse_resume(resume: object) -> list[str]:
    """Normalize the Command(resume=...) payload into a list of approved URLs.

    Approve → non-empty list of URL strings. Decline → empty list (any other
    shape — None, non-dict, non-string items — degrades to decline)."""
    if not isinstance(resume, dict):
        return []
    urls = resume.get("approved_urls")
    if not isinstance(urls, list):
        return []
    return [u for u in urls if isinstance(u, str) and u]


async def request_approval(state: RAGState) -> Command[Literal["crawl_index", "generate"]]:
    """Pause for human URL approval, then branch.

    APPROVE (non-empty urls) → crawl_index.
    DECLINE ([] or anything else) → generate, answering from the local corpus.

    No I/O precedes interrupt(), so the mandatory node re-run on resume is a
    no-op replay — the SearXNG search already ran in web_search."""
    decision = interrupt(
        {
            "reason": "approve_urls",
            "question": state["question"],
            "grade": {
                "label": state.get("grade"),
                "confidence": state.get("grade_confidence"),
                "reason": state.get("grade_reason"),
            },
            "candidate_urls": state.get("candidate_urls", []),
        }
    )
    approved = _parse_resume(decision)
    if approved:
        logger.info("request_approval: APPROVED %d urls", len(approved))
        return Command(goto="crawl_index", update={"approved_urls": approved})
    logger.info("request_approval: DECLINED")
    return Command(
        goto="generate",
        update={"approved_urls": [], "declined": True, "fallback_used": False},
    )


# ---------------------------------------------------------------------------
# Node: crawl_index  (CRAG) — crawl approved URLs, index, increment the guard
# ---------------------------------------------------------------------------
# Extra wall-clock budget (seconds) added on top of ``crawl_timeout_s`` to form
# the *hard* per-URL ceiling. Crawl4AI's page_timeout bounds page navigation but
# NOT browser launch/teardown, so a hostile site (LinkedIn was the live repro)
# can wedge ``crawl_url`` indefinitely. ``asyncio.wait_for`` at this ceiling
# guarantees the node always returns — without it, one bad URL hangs the whole
# /ask stream forever (no ``done`` event ever fires).
_CRAWL_HARD_TIMEOUT_MARGIN_S = 15.0


async def _crawl_and_index_one(pipe: object, url: str, hard_timeout_s: float) -> int:
    """Crawl + index one URL under a hard timeout, emitting progress events.

    Returns the chunk count indexed (0 on timeout/failure). Never raises: a
    single bad URL must neither sink the batch nor wedge the graph node."""
    await adispatch_custom_event("crawl_progress", {"url": url, "status": "crawling"})

    async def _do() -> int:
        doc = await crawl_url(url)
        n = await pipe.index_document(doc)  # type: ignore[attr-defined]
        return int(n)

    try:
        n = await asyncio.wait_for(_do(), timeout=hard_timeout_s)
    except TimeoutError:
        # The hostile-site case: the browser never came back within the ceiling.
        logger.warning("crawl_index: URL exceeded %.0fs ceiling, skipping: %s", hard_timeout_s, url)
        await adispatch_custom_event("crawl_progress", {"url": url, "status": "failed"})
        return 0
    except Exception:  # one bad URL must not sink the batch
        logger.warning("crawl_index: skipping URL that failed: %s", url, exc_info=True)
        await adispatch_custom_event("crawl_progress", {"url": url, "status": "failed"})
        return 0
    await adispatch_custom_event("crawl_progress", {"url": url, "status": "indexed", "chunks": n})
    return n


async def crawl_index(state: RAGState) -> dict[str, object]:
    """Crawl the approved URLs **concurrently** and index each, then bump the
    correction counter. Emits a ``crawl_progress`` custom event per URL
    (``crawling`` → ``indexed``/``failed``) so the SSE layer can render per-URL
    progress.

    Robustness (prod-hardened): each URL runs under a hard wall-clock timeout
    (``crawl_timeout_s`` + margin) so a site that wedges Crawl4AI past its
    internal page_timeout degrades to ``failed`` instead of hanging the stream.
    Crawls fan out up to ``crawl_concurrency`` at a time so a 3-URL approval
    doesn't serialize three full browser launches. A single bad URL is logged +
    skipped, never fatal. Always loops back to retrieve_local (the guard stops a
    second round)."""
    s = get_settings()
    pipe = get_pipeline()
    urls = state.get("approved_urls") or []
    attempts = state.get("correction_attempts", 0)
    hard_timeout_s = s.crawl_timeout_s + _CRAWL_HARD_TIMEOUT_MARGIN_S
    sem = asyncio.Semaphore(max(1, s.crawl_concurrency))

    async def _guarded(url: str) -> int:
        async with sem:
            return await _crawl_and_index_one(pipe, url, hard_timeout_s)

    counts = await asyncio.gather(*(_guarded(u) for u in urls))
    total = sum(counts)
    logger.info("crawl_index: indexed %d chunks from %d urls", total, len(urls))
    return {
        "web_ingested": total,
        "fallback_used": total > 0,
        "correction_attempts": attempts + 1,
    }


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
    answer_text = answer_text.strip()
    # Honesty caveat: we answered on a weak grade (corrections exhausted or
    # the human declined the web search). Doesn't fire on a "correct" grade.
    if state.get("grade") in ("ambiguous", "incorrect"):
        if state.get("declined"):
            answer_text += "\n\n_Confidence is lower than usual — the web was not consulted._"
        elif not state.get("fallback_used"):
            answer_text += "\n\n_Confidence is lower than usual — local sources were thin._"
        else:
            answer_text += (
                "\n\n_Confidence is lower than usual — web sources did not improve coverage._"
            )
    return {
        "answer": answer_text,
        "citations": citations,
        "used": len(citations),
    }


__all__ = [
    "crawl_index",
    "do_rerank",
    "generate",
    "grade",
    "request_approval",
    "retrieve_local",
    "route_after_grade",
    "transform_query",
    "web_search",
]
