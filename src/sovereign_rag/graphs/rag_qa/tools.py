"""Tool layer for the ReAct agentic-RAG graph.

Each executor wraps an existing retrieval primitive and returns a tuple of
``(observation, state_update)``:
- ``observation`` — a COMPACT JSON string the controller LLM reasons over
  (ids + titles + scores + short snippets). Full passages never enter the loop.
- ``state_update`` — a partial ``AgentState`` dict; ``search_corpus`` stashes
  the *full* RetrievedChunks in ``retrieved_pool`` so ``finalize`` (Plan 2) can
  ground the answer in full text.

No graph, no LLM, no interrupt here — the agent loop wires these in Plan 2.
``_retrieve_deduped`` / ``rerank`` / ``get_pipeline`` / ``search`` are imported
at module scope so tests can monkeypatch them as ``tools.<name>``.
"""

from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, Field

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.graphs.rag_qa.nodes import (
    _CRAWL_HARD_TIMEOUT_MARGIN_S,
    _crawl_and_index_one,
    _parse_resume,
    _retrieve_deduped,
)
from sovereign_rag.ingestion.search import search
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.retrieval.grading import _sigmoid
from sovereign_rag.shared.pipeline_deps import get_pipeline

_SNIPPET = 200


def _compact_chunks(retrieved: list[RetrievedChunk]) -> list[dict[str, Any]]:
    """Compact, controller-facing view of reranked chunks (no full text)."""
    return [
        {
            "id": rc.chunk.chunk_id,
            "title": str(rc.chunk.metadata.get("title", "")),
            "score": round(float(rc.score), 4),
            "snippet": rc.chunk.raw_text[:_SNIPPET],
        }
        for rc in retrieved
    ]


async def run_search_corpus(query: str, doc_id: str | None) -> tuple[str, dict[str, Any]]:
    """Hybrid Milvus + graph retrieve → rerank. Returns a compact observation
    (with the top-1 score as the 'good enough?' signal) and stashes the full
    reranked chunks in ``retrieved_pool``."""
    s = get_settings()
    pipe = get_pipeline()
    candidates = await _retrieve_deduped(pipe, query, doc_id)
    reranked = rerank(query, candidates, top_k=s.rerank_top_k) if candidates else []
    pool = {rc.chunk.chunk_id: rc for rc in reranked}
    top1 = _sigmoid(float(reranked[0].score)) if reranked else None
    obs = json.dumps({"results": _compact_chunks(reranked), "top_score": top1}, ensure_ascii=False)
    return obs, {"retrieved_pool": pool, "retrieved": len(candidates)}


async def run_web_search(query: str) -> tuple[str, dict[str, Any]]:
    """SearXNG search → compact candidate URLs. Crawling is a separate tool
    (``crawl_and_index``, Plan 2) so this network call is cheap and side-effect
    free; the agent decides whether to crawl."""
    s = get_settings()
    hits = await search(query, max_results=s.web_fallback_max_urls)
    candidates = [
        {"title": h.get("title", ""), "url": h["url"], "snippet": h.get("content", "")}
        for h in hits
        if h.get("url")
    ]
    obs = json.dumps({"candidates": candidates}, ensure_ascii=False)
    return obs, {"candidate_urls": candidates}


def select_grounding(pool: dict[str, RetrievedChunk], top_k: int) -> list[RetrievedChunk]:
    """Pick the chunks the finalize step grounds the answer in: the highest-
    scoring ``top_k`` across the whole turn's retrieved_pool (the union of all
    search_corpus calls — so multi-hop answers ground in every relevant hit)."""
    ranked = sorted(pool.values(), key=lambda rc: rc.chunk.chunk_id)
    ranked.sort(key=lambda rc: float(rc.score), reverse=True)
    return ranked[:top_k]


# ── Tool schemas (bound to the controller LLM in agent.py) ──────────────


class SearchCorpus(BaseModel):
    """Search the indexed local knowledge base for passages relevant to a
    standalone query. Resolve pronouns/references from the conversation first."""

    query: str = Field(description="Standalone search query.")


class WebSearch(BaseModel):
    """Search the public web for candidate source URLs when the local corpus is
    insufficient. Returns candidates only — it does not read them."""

    query: str = Field(description="Web search query.")


class CrawlAndIndex(BaseModel):
    """Crawl and index specific web URLs (from a prior web_search) into the
    corpus so they become searchable. Requires human approval before crawling."""

    urls: list[str] = Field(description="URLs to crawl and index.")


TOOL_SCHEMAS: list[type[BaseModel]] = [SearchCorpus, WebSearch, CrawlAndIndex]


# ── Crawl tool (HITL) ───────────────────────────────────────────────────


async def _do_crawl(approved: list[str]) -> tuple[str, dict[str, Any]]:
    """Crawl + fast-index approved URLs in parallel (no interrupt here — the
    caller gates approval). Reuses the per-URL helper that bounds each crawl
    with a hard timeout and degrades a bad URL to 'failed'."""
    import asyncio

    s = get_settings()
    pipe = get_pipeline()
    hard = s.crawl_timeout_s + _CRAWL_HARD_TIMEOUT_MARGIN_S
    sem = asyncio.Semaphore(max(1, s.crawl_concurrency))

    async def _one(url: str) -> int:
        async with sem:
            return await _crawl_and_index_one(pipe, url, hard, enrich=not s.crag_fast_web_index)

    counts = await asyncio.gather(*(_one(u) for u in approved))
    total = sum(counts)
    return (
        f"Indexed {total} chunks from {len(approved)} URL(s). Call search_corpus again to use them.",
        {"fallback_used": total > 0, "approved_urls": approved},
    )


async def run_crawl_and_index(
    urls: list[str], question: str, candidates: list[dict[str, str]]
) -> tuple[str, dict[str, Any]]:
    """HITL: pause for human approval of ``urls`` (interrupt), then crawl+index
    on approve. Decline (or empty resume) answers from local context."""
    from langgraph.types import interrupt

    selected = [c for c in candidates if c.get("url") in set(urls)] or [
        {"url": u, "title": "", "snippet": ""} for u in urls
    ]
    decision = interrupt(
        {"reason": "approve_urls", "question": question, "candidate_urls": selected}
    )
    approved = _parse_resume(decision)
    if not approved:
        return (
            "User declined the web fallback; answer from local context.",
            {"declined": True, "fallback_used": False, "approved_urls": []},
        )
    return await _do_crawl(approved)


async def dispatch_tool(
    name: str, args: dict[str, Any], state: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    """Route an LLM tool call to its executor with the state it needs."""
    if name == "SearchCorpus":
        return await run_search_corpus(args["query"], state.get("doc_id"))
    if name == "WebSearch":
        return await run_web_search(args["query"])
    if name == "CrawlAndIndex":
        return await run_crawl_and_index(
            args["urls"], state.get("question", ""), state.get("candidate_urls", []) or []
        )
    return f"Unknown tool: {name}", {}


__all__ = [
    "TOOL_SCHEMAS",
    "CrawlAndIndex",
    "SearchCorpus",
    "WebSearch",
    "_compact_chunks",
    "dispatch_tool",
    "run_crawl_and_index",
    "run_search_corpus",
    "run_web_search",
    "select_grounding",
]
