"""Retrieval provenance trace — the data the inspector overlay renders.

Pure (no I/O): assembled from per-leg ranked lists, the full rerank ranking,
and the set of cited chunk ids. Streamed once on the /ask `done` SSE event.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

_LEG_KEYS = ("dense", "bm25", "graph")


@dataclass(slots=True)
class LegHit:
    chunk_id: str
    rank: int  # 1-based within the leg
    score: float


@dataclass(slots=True)
class TraceChunk:
    chunk_id: str
    title: str
    snippet: str
    origin: str  # "local" | "web"
    dense_rank: int | None
    bm25_rank: int | None
    graph_rank: int | None
    rerank_rank: int | None
    rerank_score: float | None
    in_top_k: bool
    cited: bool


@dataclass(slots=True)
class RetrievalTrace:
    legs: dict[str, list[LegHit]]
    chunks: list[TraceChunk]
    pool_size: int
    top_k: int


def build_trace(
    *,
    legs: dict[str, list[LegHit]],
    rerank_ranking: list[tuple[str, float]],
    top_k: int,
    pool_meta: dict[str, dict[str, str]],
    cited_chunk_ids: set[str],
) -> RetrievalTrace:
    """Join per-leg ranks + the rerank ranking + cited set into one trace.

    The chunk universe is every id seen in any leg OR in the rerank ranking,
    so the table can show pool members that no single leg surfaced alone.
    """
    rank_in: dict[str, dict[str, int]] = {key: {} for key in _LEG_KEYS}
    for key in _LEG_KEYS:
        for hit in legs.get(key, []):
            rank_in[key][hit.chunk_id] = hit.rank

    rerank_rank: dict[str, int] = {}
    rerank_score: dict[str, float] = {}
    for i, (cid, score) in enumerate(rerank_ranking, start=1):
        rerank_rank[cid] = i
        rerank_score[cid] = float(score)

    ids: list[str] = []
    seen: set[str] = set()
    for cid, _ in rerank_ranking:
        if cid not in seen:
            seen.add(cid)
            ids.append(cid)
    for key in _LEG_KEYS:
        for hit in legs.get(key, []):
            if hit.chunk_id not in seen:
                seen.add(hit.chunk_id)
                ids.append(hit.chunk_id)

    chunks: list[TraceChunk] = []
    for cid in ids:
        meta = pool_meta.get(cid, {})
        rr = rerank_rank.get(cid)
        chunks.append(
            TraceChunk(
                chunk_id=cid,
                title=meta.get("title", ""),
                snippet=meta.get("snippet", ""),
                origin=meta.get("origin", "local"),
                dense_rank=rank_in["dense"].get(cid),
                bm25_rank=rank_in["bm25"].get(cid),
                graph_rank=rank_in["graph"].get(cid),
                rerank_rank=rr,
                rerank_score=rerank_score.get(cid),
                in_top_k=rr is not None and rr <= top_k,
                cited=cid in cited_chunk_ids,
            )
        )
    chunks.sort(key=lambda c: (c.rerank_rank is None, c.rerank_rank or 0))
    return RetrievalTrace(legs=legs, chunks=chunks, pool_size=len(ids), top_k=top_k)


def trace_to_dict(trace: RetrievalTrace) -> dict[str, Any]:
    """Serialize to the camelCase wire shape the frontend expects."""
    return {
        "legs": {
            key: [{"chunkId": h.chunk_id, "rank": h.rank, "score": h.score} for h in hits]
            for key, hits in trace.legs.items()
        },
        "chunks": [
            {
                "chunkId": c.chunk_id,
                "title": c.title,
                "snippet": c.snippet,
                "origin": c.origin,
                "denseRank": c.dense_rank,
                "bm25Rank": c.bm25_rank,
                "graphRank": c.graph_rank,
                "rerankRank": c.rerank_rank,
                "rerankScore": c.rerank_score,
                "inTopK": c.in_top_k,
                "cited": c.cited,
            }
            for c in trace.chunks
        ],
        "poolSize": trace.pool_size,
        "topK": trace.top_k,
    }


__all__ = ["LegHit", "RetrievalTrace", "TraceChunk", "build_trace", "trace_to_dict"]
