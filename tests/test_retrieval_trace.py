from __future__ import annotations

import sovereign_rag.providers.reranker as reranker_mod
from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk


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
