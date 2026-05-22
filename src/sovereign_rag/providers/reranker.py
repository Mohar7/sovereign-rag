"""Cross-encoder reranking via FlashRank (CPU-friendly, no GPU, no API).

Sits after hybrid retrieval: we fetch top-`retrieve_top_k` candidates from
Milvus (and graph), then rerank with a cross-encoder that scores each
(query, chunk) pair jointly — far more accurate than the bi-encoder
similarity used for first-stage retrieval — and keep the top
`rerank_top_k`.

FlashRank loads a small ONNX cross-encoder (~few hundred MB) and runs on
CPU in tens of ms per query, so it adds quality without a GPU dependency.
"""

from __future__ import annotations

from functools import lru_cache

from sovereign_rag.config import get_settings
from sovereign_rag.documents import RetrievedChunk


@lru_cache(maxsize=1)
def _ranker():
    # Imported lazily so importing this module doesn't pull in onnxruntime
    # until reranking is actually used (keeps test import time low).
    from flashrank import Ranker

    return Ranker(model_name=get_settings().reranker_model)


def rerank(
    query: str, candidates: list[RetrievedChunk], top_k: int | None = None
) -> list[RetrievedChunk]:
    """Rerank `candidates` against `query`; return the top_k by cross-encoder score.

    The returned chunks carry the reranker score (not the original retrieval
    score) and `source="reranked"`, so downstream code can tell first-stage
    scores from rerank scores.
    """
    if not candidates:
        return []
    top_k = top_k or get_settings().rerank_top_k

    from flashrank import RerankRequest

    passages = [{"id": i, "text": c.chunk.text, "meta": {}} for i, c in enumerate(candidates)]
    ranked = _ranker().rerank(RerankRequest(query=query, passages=passages))

    out: list[RetrievedChunk] = []
    for item in ranked[:top_k]:
        original = candidates[item["id"]]
        out.append(
            RetrievedChunk(
                chunk=original.chunk,
                score=float(item["score"]),
                source="reranked",
            )
        )
    return out


__all__ = ["rerank"]
