"""Graph state contract.

``RAGState`` is a ``TypedDict`` (LangGraph's preferred state shape) — only
the fields used by the next node need to be set in any given return dict,
LangGraph merges by key.

`INTERRUPT_REASON_APPROVE_URLS` is the tag the ``web_fallback`` node uses
when it pauses for human approval, so clients can dispatch on the
interrupt type rather than parsing free-form payloads.
"""

from __future__ import annotations

from typing import TypedDict

from sovereign_rag.documents import RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation

# Stable tag for the human-approval interrupt payload. Clients should
# branch on this value to render the URL-approval UI.
INTERRUPT_REASON_APPROVE_URLS = "approve_urls"


class CandidateURL(TypedDict):
    """One search hit the user can approve or reject before crawling."""

    url: str
    title: str
    snippet: str


class RAGState(TypedDict, total=False):
    """State threaded through the QA graph.

    ``total=False`` so each node can return a partial dict — LangGraph
    merges by key into the running state.
    """

    # -- input --
    question: str
    doc_id: str | None  # optional restriction to one source document

    # -- working state --
    candidates: list[RetrievedChunk]
    web_fallback_attempted: bool
    candidate_urls: list[CandidateURL]  # surfaced to HITL
    approved_urls: list[str]  # resumed by HITL
    reranked: list[RetrievedChunk]

    # -- output --
    answer: str
    citations: list[Citation]
    retrieved: int  # candidates before rerank (post-dedup, post-fallback)
    used: int  # citations actually surfaced
    fallback_used: bool  # true if we went through web fallback


__all__ = ["INTERRUPT_REASON_APPROVE_URLS", "CandidateURL", "RAGState"]
