"""Cross-encoder reranking via sentence-transformers (on-prem, GPU/MPS-aware).

Sits after hybrid retrieval: we fetch top-`retrieve_top_k` candidates from
Milvus (and the graph), then rerank with a cross-encoder that scores each
(query, chunk) pair jointly — far more accurate than the bi-encoder
similarity used for first-stage retrieval — and keep the top
`rerank_top_k`.

The default model is **Alibaba-NLP/gte-reranker-modernbert-base**: ~149M
parameters (~3.8x smaller than bge-reranker-v2-m3), Apache 2.0, multilingual
via ModernBERT — override to ``BAAI/bge-reranker-v2-m3`` for the older
battle-tested baseline. It runs on Apple Silicon (MPS), CUDA, or CPU —
device is auto-selected unless `RERANKER_DEVICE` is set explicitly. No
network calls at inference time; the weights are downloaded once from
HuggingFace and cached locally.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from sovereign_rag.config import Settings, get_settings
from sovereign_rag.documents import RetrievedChunk

if TYPE_CHECKING:
    from sentence_transformers import CrossEncoder


def _pick_device(setting: str) -> str:
    """Resolve ``"auto"`` to the best available accelerator.

    Order: MPS (Apple Silicon) → CUDA → CPU. Anything other than ``"auto"``
    is passed through verbatim so callers can pin a device explicitly.
    """
    if setting != "auto":
        return setting
    import torch

    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


@lru_cache(maxsize=1)
def _ranker() -> CrossEncoder:
    # Imported lazily so importing this module doesn't pull torch + the
    # tokenizer until reranking is actually used (keeps test import time low).
    from sentence_transformers import CrossEncoder

    s = get_settings()
    # The sentence-transformers stub types `CrossEncoder.__init__` as returning
    # Any in some versions; the runtime type is unambiguous, hence the ignore.
    return CrossEncoder(  # type: ignore[no-any-return]
        s.reranker_model,
        device=_pick_device(s.reranker_device),
        max_length=512,
    )


def rerank_scores(
    query: str, candidates: list[RetrievedChunk]
) -> list[tuple[RetrievedChunk, float]]:
    """Cross-encode every candidate; return ``(chunk, score)`` sorted desc.

    The FULL ranking — no score-floor, no truncation. The inspector trace uses
    this to show how the reranker reordered the whole candidate pool.
    """
    if not candidates:
        return []
    pairs: list[tuple[str, str]] = [(query, c.chunk.text) for c in candidates]
    # CrossEncoder.predict accepts a list of (str, str) pairs at runtime; its
    # stubbed signature describes the multimodal superset, hence the ignore.
    scores = _ranker().predict(pairs, show_progress_bar=False)  # type: ignore[arg-type]
    return sorted(
        zip(candidates, scores, strict=True), key=lambda p: float(p[1]), reverse=True
    )


def select_top_k(
    scored: list[tuple[RetrievedChunk, float]], *, settings: Settings, top_k: int
) -> list[RetrievedChunk]:
    """Apply score-floor + adaptive truncation + ``top_k`` to a scored ranking.

    Output chunks carry the reranker score, ``source="reranked"`` and the
    input's ``origin_source`` (so downstream still knows which retriever leg
    first found each chunk).
    """
    paired = scored
    # Floor before adaptive truncation so a chunk that doesn't clear the bar
    # never contributes mass.
    if settings.rerank_score_floor > 0:
        paired = [(c, sc) for c, sc in paired if float(sc) >= settings.rerank_score_floor]
    # Adaptive truncation: once cumulative score-mass crosses 0.85, stop
    # collecting (top_k stays the upper bound).
    if settings.adaptive_rerank and paired:
        total = sum(max(0.0, float(sc)) for _, sc in paired[:top_k]) or 1.0
        running = 0.0
        kept: list[tuple[RetrievedChunk, float]] = []
        for c, sc in paired[:top_k]:
            kept.append((c, sc))
            running += max(0.0, float(sc))
            if running / total >= 0.85:
                break
        paired = kept
    else:
        paired = paired[:top_k]
    return [
        RetrievedChunk(
            chunk=original.chunk,
            score=float(score),
            source="reranked",
            origin_source=original.origin_source,
        )
        for original, score in paired
    ]


def rerank(
    query: str, candidates: list[RetrievedChunk], top_k: int | None = None
) -> list[RetrievedChunk]:
    """Rerank ``candidates`` against ``query``; return the top_k by score.

    Honours ``rerank_top_k`` (cap), ``rerank_score_floor`` (drop weak chunks),
    and ``adaptive_rerank`` (stop once cumulative score-mass crosses 0.85). The
    returned chunks carry the reranker score and ``source="reranked"``.
    """
    if not candidates:
        return []
    s = get_settings()
    top_k = top_k or s.rerank_top_k
    return select_top_k(rerank_scores(query, candidates), settings=s, top_k=top_k)


__all__ = ["rerank", "rerank_scores", "select_top_k"]
