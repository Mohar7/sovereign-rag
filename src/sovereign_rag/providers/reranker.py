"""Cross-encoder reranking via sentence-transformers (on-prem, GPU/MPS-aware).

Sits after hybrid retrieval: we fetch top-`retrieve_top_k` candidates from
Milvus (and the graph), then rerank with a cross-encoder that scores each
(query, chunk) pair jointly — far more accurate than the bi-encoder
similarity used for first-stage retrieval — and keep the top
`rerank_top_k`.

The default model is **BAAI/bge-reranker-v2-m3**: ~568M parameters,
multilingual (RU/UZ/EN/CN/…), one of the strongest open-source
cross-encoders on BEIR. It runs on Apple Silicon (MPS), CUDA, or CPU —
device is auto-selected unless `RERANKER_DEVICE` is set explicitly. No
network calls at inference time; the weights are downloaded once from
HuggingFace and cached locally.
"""

from __future__ import annotations

from functools import lru_cache
from typing import TYPE_CHECKING

from sovereign_rag.config import get_settings
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
        max_seq_length=512,  # renamed from max_length in sentence-transformers 5.x
    )


def rerank(
    query: str, candidates: list[RetrievedChunk], top_k: int | None = None
) -> list[RetrievedChunk]:
    """Rerank ``candidates`` against ``query``; return the top_k by score.

    The returned chunks carry the reranker score (not the original retrieval
    score) and ``source="reranked"``, so downstream code can tell first-stage
    scores from rerank scores.
    """
    if not candidates:
        return []
    top_k = top_k or get_settings().rerank_top_k

    pairs: list[tuple[str, str]] = [(query, c.chunk.text) for c in candidates]
    # CrossEncoder.predict accepts a list of (str, str) pairs at runtime; its
    # stubbed signature describes the multimodal superset, hence the ignore.
    scores = _ranker().predict(pairs, show_progress_bar=False)  # type: ignore[arg-type]

    paired = sorted(
        zip(candidates, scores, strict=True),
        key=lambda p: float(p[1]),
        reverse=True,
    )
    return [
        RetrievedChunk(
            chunk=original.chunk,
            score=float(score),
            source="reranked",
        )
        for original, score in paired[:top_k]
    ]


__all__ = ["rerank"]
