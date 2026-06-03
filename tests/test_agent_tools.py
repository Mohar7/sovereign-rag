"""Agent tool layer — compact observations, full-chunk stash, grounding select."""

from __future__ import annotations

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import tools
from sovereign_rag.retrieval.grading import _sigmoid


def _rc(chunk_id: str, score: float, title: str = "T", body: str = "body") -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d",
        text="t",
        raw_text=body,
        position=0,
        chunk_id=chunk_id,
        metadata={"title": title, "source_uri": "u"},
    )
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


def test_compact_chunks_shape() -> None:
    out = tools._compact_chunks([_rc("c1", 0.9, title="Doc", body="X" * 500)])
    assert out == [{"id": "c1", "title": "Doc", "score": 0.9, "snippet": "X" * 200}]


async def test_run_search_corpus_compact_and_stash(monkeypatch: pytest.MonkeyPatch) -> None:
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "rerank_top_k", 5)

    async def fake_dedup(pipe, q, d):  # type: ignore[no-untyped-def]
        return [_rc("c1", 0.8), _rc("c2", 0.4)]

    monkeypatch.setattr(tools, "_retrieve_deduped", fake_dedup)
    monkeypatch.setattr(tools, "rerank", lambda q, c, top_k=None: c)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())

    import json

    obs, update = await tools.run_search_corpus("hello?", None)
    parsed = json.loads(obs)
    assert parsed["top_score"] == _sigmoid(0.8)
    assert [r["id"] for r in parsed["results"]] == ["c1", "c2"]
    assert set(update["retrieved_pool"]) == {"c1", "c2"}
    assert update["retrieved"] == 2


async def test_run_search_corpus_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_dedup(pipe, q, d):  # type: ignore[no-untyped-def]
        return []

    monkeypatch.setattr(tools, "_retrieve_deduped", fake_dedup)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())
    import json

    obs, update = await tools.run_search_corpus("zzz", None)
    assert json.loads(obs) == {"results": [], "top_score": None}
    assert update["retrieved_pool"] == {} and update["retrieved"] == 0


async def test_run_web_search_compact(monkeypatch: pytest.MonkeyPatch) -> None:
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "web_fallback_max_urls", 3)

    async def fake_search(query, max_results=5):  # type: ignore[no-untyped-def]
        return [
            {"title": "A", "url": "https://a", "content": "snip a"},
            {"title": "B", "url": "", "content": "no url -> dropped"},
        ]

    monkeypatch.setattr(tools, "search", fake_search)
    import json

    obs, update = await tools.run_web_search("query")
    cands = json.loads(obs)["candidates"]
    assert cands == [{"title": "A", "url": "https://a", "snippet": "snip a"}]
    assert update["candidate_urls"] == cands


def test_select_grounding_ranks_and_caps() -> None:
    pool = {"c1": _rc("c1", 0.3), "c2": _rc("c2", 0.9), "c3": _rc("c3", 0.6)}
    top = tools.select_grounding(pool, top_k=2)
    assert [rc.chunk.chunk_id for rc in top] == ["c2", "c3"]


def test_select_grounding_empty() -> None:
    assert tools.select_grounding({}, top_k=5) == []


def test_select_grounding_tiebreak_is_deterministic() -> None:
    # equal scores → ordered by chunk_id asc, regardless of dict insertion order
    pool = {"c2": _rc("c2", 0.5), "c1": _rc("c1", 0.5)}
    assert [rc.chunk.chunk_id for rc in tools.select_grounding(pool, 2)] == ["c1", "c2"]


async def test_do_crawl_indexes_and_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "crag_fast_web_index", True)
    monkeypatch.setattr(get_settings(), "crawl_concurrency", 3)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())

    async def fake_one(pipe, url, hard, *, enrich):  # type: ignore[no-untyped-def]
        assert enrich is False  # fast web index path
        return 4

    monkeypatch.setattr(tools, "_crawl_and_index_one", fake_one)

    obs, update = await tools._do_crawl(["https://a", "https://b"])
    assert "Indexed 8 chunks from 2" in obs
    assert update == {"fallback_used": True, "approved_urls": ["https://a", "https://b"]}


async def test_dispatch_tool_routes_search(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_search_corpus(query, doc_id):  # type: ignore[no-untyped-def]
        return "OBS", {"retrieved": 1}

    monkeypatch.setattr(tools, "run_search_corpus", fake_search_corpus)
    obs, upd = await tools.dispatch_tool("SearchCorpus", {"query": "q"}, {"doc_id": None})
    assert obs == "OBS" and upd == {"retrieved": 1}


async def test_dispatch_tool_unknown() -> None:
    obs, upd = await tools.dispatch_tool("Nope", {}, {})
    assert "Unknown tool" in obs and upd == {}
