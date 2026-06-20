from __future__ import annotations

import sovereign_rag.providers.reranker as reranker_mod
from sovereign_rag.api.ask.router import assemble_retrieval_payload
from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.pipeline import citation_kind
from sovereign_rag.retrieval.trace import LegHit, build_trace, trace_to_dict


def test_retrieval_trace_defaults_on() -> None:
    assert Settings().enable_retrieval_trace is True


def test_settings_patch_accepts_retrieval_trace() -> None:
    patch = SettingsPatch(enable_retrieval_trace=False)
    assert patch.model_dump(exclude_none=True) == {"enable_retrieval_trace": False}


def test_retrieved_chunk_origin_source_defaults_empty() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")
    assert RetrievedChunk(chunk=chunk, score=1.0, source="graph").origin_source == ""


class _StubRanker:
    """Scores each (query, text) pair by the text's trailing integer."""

    def predict(self, pairs, show_progress_bar=False):
        return [float(text.rsplit("#", 1)[1]) for _q, text in pairs]


def _stub_candidates() -> list[RetrievedChunk]:
    out: list[RetrievedChunk] = []
    for i, src in [(3, "graph"), (9, "milvus_dense"), (1, "milvus_bm25")]:
        c = Chunk(doc_id="d", text=f"t#{i}", raw_text=f"t#{i}", position=0, chunk_id=f"c{i}")
        out.append(RetrievedChunk(chunk=c, score=0.0, source=src, origin_source=src))
    return out


def test_rerank_scores_returns_full_sorted(monkeypatch) -> None:
    monkeypatch.setattr(reranker_mod, "_ranker", lambda: _StubRanker())
    scored = reranker_mod.rerank_scores("q", _stub_candidates())
    assert [c.chunk.chunk_id for c, _ in scored] == ["c9", "c3", "c1"]
    assert [round(s) for _, s in scored] == [9, 3, 1]


def test_select_top_k_preserves_origin(monkeypatch) -> None:
    monkeypatch.setattr(reranker_mod, "_ranker", lambda: _StubRanker())
    s = Settings(rerank_score_floor=0.0, adaptive_rerank=False)
    scored = reranker_mod.rerank_scores("q", _stub_candidates())
    top = reranker_mod.select_top_k(scored, settings=s, top_k=2)
    assert [c.chunk.chunk_id for c in top] == ["c9", "c3"]
    assert [c.origin_source for c in top] == ["milvus_dense", "graph"]
    assert all(c.source == "reranked" for c in top)


def test_build_trace_joins_legs_rerank_and_cited() -> None:
    legs = {
        "dense": [LegHit("c9", 1, 0.9), LegHit("c3", 2, 0.4)],
        "bm25": [LegHit("c1", 1, 5.0), LegHit("c9", 2, 3.0)],
        "graph": [LegHit("c3", 1, 0.7)],
    }
    rerank_ranking = [("c9", 8.0), ("c3", 2.0), ("c1", 1.0)]
    pool_meta = {
        "c9": {"title": "Nine", "snippet": "nine", "origin": "local"},
        "c3": {"title": "Three", "snippet": "three", "origin": "web"},
        "c1": {"title": "One", "snippet": "one", "origin": "local"},
    }
    trace = build_trace(
        legs=legs,
        rerank_ranking=rerank_ranking,
        top_k=2,
        pool_meta=pool_meta,
        cited_chunk_ids={"c9"},
    )
    by_id = {c.chunk_id: c for c in trace.chunks}
    assert by_id["c9"].dense_rank == 1 and by_id["c9"].bm25_rank == 2
    assert by_id["c9"].graph_rank is None
    assert (
        by_id["c9"].rerank_rank == 1 and by_id["c9"].in_top_k is True and by_id["c9"].cited is True
    )
    assert (
        by_id["c3"].graph_rank == 1
        and by_id["c3"].rerank_rank == 2
        and by_id["c3"].in_top_k is True
    )
    assert by_id["c1"].in_top_k is False and by_id["c1"].cited is False
    assert trace.pool_size == 3 and trace.top_k == 2


def test_trace_to_dict_is_camel_case() -> None:
    trace = build_trace(
        legs={"dense": [LegHit("c1", 1, 0.5)], "bm25": [], "graph": []},
        rerank_ranking=[("c1", 2.0)],
        top_k=1,
        pool_meta={"c1": {"title": "T", "snippet": "s", "origin": "local"}},
        cited_chunk_ids=set(),
    )
    d = trace_to_dict(trace)
    assert d["poolSize"] == 1 and d["topK"] == 1
    assert d["legs"]["dense"][0] == {"chunkId": "c1", "rank": 1, "score": 0.5}
    assert d["chunks"][0]["denseRank"] == 1 and d["chunks"][0]["rerankRank"] == 1
    assert d["chunks"][0]["inTopK"] is True


def test_citation_kind_mapping() -> None:
    assert citation_kind("milvus_hybrid", "https://x.com/a") == "web"
    assert citation_kind("graph", "file:///x.pdf") == "graph"
    assert citation_kind("milvus_dense", "doc_1") == "vector"
    assert citation_kind("milvus_hybrid", "doc_1") == "hybrid"
    assert citation_kind("milvus_bm25", "") == "hybrid"
    assert citation_kind("", "") == "hybrid"


def test_assemble_retrieval_payload_from_state() -> None:
    final_state = {
        "trace_legs": {
            "dense": [{"chunkId": "c1", "rank": 1, "score": 0.9}],
            "bm25": [{"chunkId": "c1", "rank": 2, "score": 3.0}],
            "graph": [],
        },
        "trace_pool_meta": {"c1": {"title": "T", "snippet": "s", "origin": "local"}},
        "trace_rerank": [{"chunkId": "c1", "score": 5.0}],
        "rerank_top_k": 5,
    }
    payload = assemble_retrieval_payload(final_state, [{"chunk_id": "c1"}])
    assert payload is not None
    assert payload["poolSize"] == 1
    assert payload["chunks"][0]["cited"] is True
    assert payload["legs"]["dense"][0]["chunkId"] == "c1"


def test_assemble_retrieval_payload_absent_returns_none() -> None:
    assert assemble_retrieval_payload({}, []) is None
