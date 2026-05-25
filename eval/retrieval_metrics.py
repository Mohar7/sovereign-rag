"""Pure information-retrieval metrics over `RetrievedChunk` lists.

These functions deliberately depend on nothing but the data contract in
`sovereign_rag.documents`. No Milvus, no Ollama, no network — which makes them
fast to unit-test and trivially reproducible in CI.

Relevance model
---------------
A retrieved chunk is judged *relevant* if any of the `relevant_substrings`
appears verbatim in its `chunk.raw_text`. `raw_text` (not `text`) is used on
purpose: `text` may carry a contextual-retrieval prefix, whereas `raw_text` is
the original chunk body, which is what the golden substrings are written
against. Matching is case-insensitive so the golden set need not reproduce the
exact casing of the corpus.

All ranking metrics assume `retrieved` is already in rank order (best first),
which is the order retrievers in this project emit.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from sovereign_rag.documents import RetrievedChunk

__all__ = [
    "is_relevant",
    "mrr",
    "ndcg_at_k",
    "precision_at_k",
    "recall_at_k",
    "relevance_flags",
]


def is_relevant(chunk: RetrievedChunk, relevant_substrings: Sequence[str]) -> bool:
    """Return True if any relevant substring occurs in the chunk's raw text.

    Empty / whitespace-only golden substrings are ignored so they cannot
    accidentally match every chunk. Matching is case-insensitive.
    """
    haystack = chunk.chunk.raw_text.casefold()
    return any(needle.casefold() in haystack for needle in relevant_substrings if needle.strip())


def relevance_flags(
    retrieved: Sequence[RetrievedChunk], relevant_substrings: Sequence[str]
) -> list[bool]:
    """Per-position relevance judgements for the ranked list (best first)."""
    return [is_relevant(chunk, relevant_substrings) for chunk in retrieved]


def _total_relevant(relevant_substrings: Sequence[str]) -> int:
    """Number of distinct ground-truth relevance targets.

    Each non-empty golden substring is treated as one expected relevant item;
    this is the denominator for recall. Blank entries are not counted.
    """
    return len({needle.strip().casefold() for needle in relevant_substrings if needle.strip()})


def precision_at_k(
    retrieved: Sequence[RetrievedChunk],
    relevant_substrings: Sequence[str],
    k: int,
) -> float:
    """Fraction of the top-k retrieved chunks that are relevant.

    Always divides by ``k`` (the conventional precision@k denominator), so a
    short result list is penalised for not filling the top-k slots. Returns 0.0
    when ``k <= 0``.
    """
    if k <= 0:
        return 0.0
    top = retrieved[:k]
    hits = sum(1 for chunk in top if is_relevant(chunk, relevant_substrings))
    return hits / k


def recall_at_k(
    retrieved: Sequence[RetrievedChunk],
    relevant_substrings: Sequence[str],
    k: int,
) -> float:
    """Fraction of distinct relevant targets that are matched within the top-k.

    A relevant target counts as recalled if its substring appears in any of the
    top-k chunks. Returns 0.0 when there are no relevant targets or ``k <= 0``.
    """
    if k <= 0:
        return 0.0
    total = _total_relevant(relevant_substrings)
    if total == 0:
        return 0.0
    top = retrieved[:k]
    matched: set[str] = set()
    for chunk in top:
        haystack = chunk.chunk.raw_text.casefold()
        for needle in relevant_substrings:
            cleaned = needle.strip()
            if cleaned and cleaned.casefold() in haystack:
                matched.add(cleaned.casefold())
    return len(matched) / total


def mrr(
    retrieved: Sequence[RetrievedChunk],
    relevant_substrings: Sequence[str],
) -> float:
    """Reciprocal rank of the first relevant chunk (1-indexed).

    Returns ``1 / rank`` of the first relevant hit, or 0.0 if no retrieved
    chunk is relevant. For a single query this is the reciprocal rank; averaged
    over a query set it is the mean reciprocal rank.
    """
    for index, chunk in enumerate(retrieved, start=1):
        if is_relevant(chunk, relevant_substrings):
            return 1.0 / index
    return 0.0


def ndcg_at_k(
    retrieved: Sequence[RetrievedChunk],
    relevant_substrings: Sequence[str],
    k: int,
) -> float:
    """Normalised discounted cumulative gain at k with binary relevance.

    Uses binary gains (1 for relevant, 0 otherwise) and the standard log2
    discount ``1 / log2(rank + 1)``. Returns 0.0 when ``k <= 0`` or no relevant
    item is in the top-k.

    Normalization (IDCG) uses the count of relevant chunks present in the
    top-k retrieved set — not the count of distinct ground-truth substrings.
    The relevance model is "any substring matches", so multiple retrieved
    chunks can each match the same substring; counting distinct substrings
    in the denominator under-estimates the ideal DCG and would make nDCG
    exceed 1.0 whenever more than one retrieved chunk satisfies the same
    target. Using ``sum(flags)`` as the ideal-hit count keeps the result in
    [0, 1] and measures ranking quality of the relevant items the retriever
    actually surfaced.
    """
    if k <= 0:
        return 0.0
    flags = relevance_flags(retrieved[:k], relevant_substrings)
    dcg = sum(1.0 / math.log2(rank + 1) for rank, hit in enumerate(flags, start=1) if hit)

    ideal_hits = sum(flags)
    if ideal_hits == 0:
        return 0.0
    idcg = sum(1.0 / math.log2(rank + 1) for rank in range(1, ideal_hits + 1))
    return dcg / idcg
