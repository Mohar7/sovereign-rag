"""State contract for the RAG QA graph.

``RAGState`` is a ``TypedDict`` (LangGraph's preferred state shape) — only the
fields used by the next node need to be set in any given return dict, and
LangGraph merges by key.
"""

from __future__ import annotations

from typing import TypedDict

from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation


class RAGState(TypedDict, total=False):
    """State threaded through the QA graph.

    ``total=False`` so each node can return a partial dict — LangGraph merges
    by key into the running state.
    """

    # -- input --
    question: str
    doc_id: str | None  # optional restriction to one source document

    # -- working state --
    candidates: list[RetrievedChunk]
    reranked: list[RetrievedChunk]

    # -- CRAG: grade --
    grade: str  # "correct" | "ambiguous" | "incorrect"
    grade_confidence: float  # normalized top-1 reranker score, 0..1
    grade_reason: str  # one-line, surfaced to the UI

    # -- CRAG: correction loop --
    correction_attempts: int  # loop guard; incremented in crawl_index
    search_query: str  # rewritten web query
    candidate_urls: list[dict[str, str]]  # [{title, url, snippet}]
    approved_urls: list[str]  # resume value; [] == decline
    web_ingested: int  # chunks indexed this correction
    fallback_used: bool  # web contributed to the answer
    declined: bool  # human declined the web search

    # -- output --
    answer: str
    citations: list[Citation]
    retrieved: int  # candidates before rerank (post-dedup)
    used: int  # citations actually surfaced


__all__ = ["RAGState"]
