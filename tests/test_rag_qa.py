"""RAG QA graph unit tests.

Each node is exercised with the heavy collaborators (pipeline, retrievers,
LLM, reranker) stubbed out via monkeypatch — so the suite stays offline
and fast while still pinning the node contracts.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import nodes as agent_nodes
from sovereign_rag.retrieval.pipeline import Citation


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _rc(chunk_id: str, score: float = 0.5, source: str = "milvus_hybrid") -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d",
        text="chunk text",
        raw_text="chunk text",
        position=0,
        chunk_id=chunk_id,
    )
    return RetrievedChunk(chunk=chunk, score=score, source=source)


# ---------------------------------------------------------------------------
# do_rerank
# ---------------------------------------------------------------------------
class TestDoRerank:
    async def test_calls_rerank_with_candidates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict[str, Any] = {}

        def fake_rerank(
            query: str, candidates: list[RetrievedChunk], top_k: int | None = None
        ) -> list[RetrievedChunk]:
            captured.update(query=query, candidates=candidates, top_k=top_k)
            return [_rc("top", score=0.99, source="reranked")]

        monkeypatch.setattr(agent_nodes, "rerank", fake_rerank)

        out = await agent_nodes.do_rerank({"question": "q?", "candidates": [_rc("a")]})

        assert captured["query"] == "q?"
        assert captured["candidates"] == [_rc("a")]
        assert isinstance(out["reranked"], list)
        assert out["retrieved"] == 1

    async def test_empty_candidates_no_rerank_call(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sentinel = MagicMock(side_effect=AssertionError("rerank shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "rerank", sentinel)
        out = await agent_nodes.do_rerank({"question": "q", "candidates": []})
        assert out == {"reranked": [], "retrieved": 0}


# ---------------------------------------------------------------------------
# generate
# ---------------------------------------------------------------------------
class TestGenerate:
    async def test_calls_llm_and_returns_citations(self, monkeypatch: pytest.MonkeyPatch) -> None:
        chunk = Chunk(
            doc_id="d",
            text="enriched",
            raw_text="The codeword is FERRET.",
            position=0,
            chunk_id="c1",
            metadata={"title": "Manual", "source_uri": "smoke://manual"},
        )
        reranked = [RetrievedChunk(chunk=chunk, score=0.91, source="reranked")]

        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="The codeword is FERRET [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate({"question": "What's the codeword?", "reranked": reranked})

        assert out["answer"] == "The codeword is FERRET [1]."
        assert out["used"] == 1
        assert isinstance(out["citations"][0], Citation)
        assert out["citations"][0].title == "Manual"
        # LLM was called with a SystemMessage + a HumanMessage carrying [1].
        args = fake_llm.ainvoke.call_args.args[0]
        assert len(args) == 2
        assert "[1]" in args[1].content

    async def test_no_reranked_returns_default_no_op(self, monkeypatch: pytest.MonkeyPatch) -> None:
        sentinel = MagicMock(side_effect=AssertionError("LLM shouldn't be called"))
        monkeypatch.setattr(agent_nodes, "get_chat_model", sentinel)

        out = await agent_nodes.generate({"question": "?", "reranked": []})

        assert "couldn't find" in out["answer"].lower()
        assert out["citations"] == []
        assert out["used"] == 0


# ---------------------------------------------------------------------------
# retrieve_local
# ---------------------------------------------------------------------------
class TestRetrieveLocal:
    async def test_milvus_only(self, monkeypatch: pytest.MonkeyPatch) -> None:
        milvus = MagicMock()
        milvus.hybrid_search = AsyncMock(return_value=[_rc("m1", 0.7)])
        pipe = MagicMock()
        pipe._milvus = milvus
        pipe._graph = None  # graph disabled
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.retrieve_local({"question": "q"})

        assert [rc.chunk.chunk_id for rc in out["candidates"]] == ["m1"]
        milvus.hybrid_search.assert_awaited_once_with("q", doc_id=None)

    async def test_milvus_plus_graph_dedupes_keeping_highest_score(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        milvus = MagicMock()
        milvus.hybrid_search = AsyncMock(return_value=[_rc("c1", 0.30)])
        graph = MagicMock()
        graph.local_search = AsyncMock(
            return_value=[_rc("c1", 0.95, source="graph"), _rc("c2", 0.80, source="graph")]
        )
        pipe = MagicMock()
        pipe._milvus = milvus
        pipe._graph = graph
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.retrieve_local({"question": "q", "doc_id": "d1"})

        cands = {rc.chunk.chunk_id: rc for rc in out["candidates"]}
        assert set(cands) == {"c1", "c2"}
        # c1 was returned by both; the higher-scoring graph version must win dedup.
        assert cands["c1"].source == "graph"
        assert cands["c1"].score == 0.95
        # doc_id propagated to milvus call:
        milvus.hybrid_search.assert_awaited_once_with("q", doc_id="d1")


# ---------------------------------------------------------------------------
# grade + route_after_grade
# ---------------------------------------------------------------------------
class TestGrade:
    async def test_writes_grade_fields(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from sovereign_rag.retrieval.grading import Grade

        async def fake_grade(
            question: str, reranked: list[Any], settings: Any
        ) -> Grade:
            return Grade("ambiguous", 0.46, "thin coverage")

        monkeypatch.setattr(agent_nodes, "grade_candidates", fake_grade)
        out = await agent_nodes.grade({"question": "q", "reranked": [_rc("a", 0.4)]})
        assert out["grade"] == "ambiguous"
        assert out["grade_confidence"] == 0.46
        assert out["grade_reason"] == "thin coverage"


class TestRouteAfterGrade:
    def test_correct_goes_to_generate(self) -> None:
        assert (
            agent_nodes.route_after_grade({"grade": "correct", "correction_attempts": 0})
            == "generate"
        )

    def test_weak_under_budget_goes_to_transform(self) -> None:
        assert (
            agent_nodes.route_after_grade({"grade": "ambiguous", "correction_attempts": 0})
            == "transform_query"
        )

    def test_weak_at_budget_goes_to_generate(self) -> None:
        # default crag_max_corrections == 1, so attempts==1 is exhausted
        assert (
            agent_nodes.route_after_grade({"grade": "incorrect", "correction_attempts": 1})
            == "generate"
        )

    def test_disabled_always_generates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        from sovereign_rag.config import get_settings

        monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
        assert (
            agent_nodes.route_after_grade({"grade": "incorrect", "correction_attempts": 0})
            == "generate"
        )


# ---------------------------------------------------------------------------
# transform_query
# ---------------------------------------------------------------------------
class TestTransformQuery:
    async def test_rewrites_via_light_llm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="FERRET activation codeword provisioning")
        captured: dict[str, Any] = {}

        def fake_get(**kwargs: Any) -> Any:
            captured.update(kwargs)
            return fake_llm

        monkeypatch.setattr(agent_nodes, "get_chat_model", fake_get)
        out = await agent_nodes.transform_query(
            {"question": "how is FERRET's activation codeword provisioned?"}
        )
        assert out["search_query"] == "FERRET activation codeword provisioning"
        assert captured["model_tier"] == "light"


# ---------------------------------------------------------------------------
# web_search
# ---------------------------------------------------------------------------
class TestWebSearch:
    async def test_searches_and_maps_candidates(self, monkeypatch: pytest.MonkeyPatch) -> None:
        captured: dict[str, Any] = {}

        async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
            captured.update(query=query, max_results=max_results)
            return [
                {"title": "Secret Key", "url": "https://1password.com/sk", "content": "snippet a"},
                {"title": "Activation", "url": "https://anthropic.com/x", "content": "snippet b"},
            ]

        monkeypatch.setattr(agent_nodes, "search", fake_search)
        out = await agent_nodes.web_search({"question": "q", "search_query": "ferret codeword"})
        assert captured["query"] == "ferret codeword"
        assert out["candidate_urls"][0] == {
            "title": "Secret Key",
            "url": "https://1password.com/sk",
            "snippet": "snippet a",
        }
        assert len(out["candidate_urls"]) == 2

        from sovereign_rag.config import get_settings

        assert captured["max_results"] == get_settings().web_fallback_max_urls

    async def test_falls_back_to_question_when_no_query(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
            return []

        monkeypatch.setattr(agent_nodes, "search", fake_search)
        out = await agent_nodes.web_search({"question": "the question"})
        assert out["candidate_urls"] == []


# ---------------------------------------------------------------------------
# request_approval — resume parsing helper
# ---------------------------------------------------------------------------
class TestParseResume:
    def test_dict_with_urls_is_approve(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": ["https://a", "https://b"]}) == [
            "https://a",
            "https://b",
        ]

    def test_empty_list_is_decline(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": []}) == []

    def test_none_is_decline(self) -> None:
        assert agent_nodes._parse_resume(None) == []

    def test_non_dict_is_decline(self) -> None:
        assert agent_nodes._parse_resume("nonsense") == []

    def test_non_string_urls_filtered(self) -> None:
        assert agent_nodes._parse_resume({"approved_urls": ["https://a", 5, None]}) == [
            "https://a"
        ]


# ---------------------------------------------------------------------------
# crawl_index
# ---------------------------------------------------------------------------
class TestCrawlIndex:
    async def test_crawls_indexes_and_increments_attempts(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        crawled: list[str] = []

        async def fake_crawl(url: str) -> Any:
            crawled.append(url)
            return MagicMock(name=f"doc::{url}")

        pipe = MagicMock()
        pipe.index_document = AsyncMock(side_effect=[18, 23])
        monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.crawl_index(
            {"approved_urls": ["https://a", "https://b"], "correction_attempts": 0}
        )
        assert crawled == ["https://a", "https://b"]
        assert out["web_ingested"] == 41
        assert out["fallback_used"] is True
        assert out["correction_attempts"] == 1

    async def test_skips_failed_crawls(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_crawl(url: str) -> Any:
            if "bad" in url:
                raise RuntimeError("403")
            return MagicMock()

        pipe = MagicMock()
        pipe.index_document = AsyncMock(return_value=10)
        monkeypatch.setattr(agent_nodes, "crawl_url", fake_crawl)
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)

        out = await agent_nodes.crawl_index(
            {"approved_urls": ["https://bad", "https://ok"], "correction_attempts": 0}
        )
        assert out["web_ingested"] == 10  # only the one that succeeded
        assert out["fallback_used"] is True

    async def test_no_urls_indexes_nothing(self, monkeypatch: pytest.MonkeyPatch) -> None:
        pipe = MagicMock()
        pipe.index_document = AsyncMock(side_effect=AssertionError("should not index"))
        monkeypatch.setattr(agent_nodes, "get_pipeline", lambda: pipe)
        out = await agent_nodes.crawl_index({"approved_urls": [], "correction_attempts": 0})
        assert out["web_ingested"] == 0
        assert out["fallback_used"] is False
        assert out["correction_attempts"] == 1


# ---------------------------------------------------------------------------
# generate — low-confidence caveat
# ---------------------------------------------------------------------------
class TestGenerateCaveat:
    async def test_declined_weak_grade_appends_caveat(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id="c1")
        reranked = [RetrievedChunk(chunk=chunk, score=0.4, source="reranked")]
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="Partial answer [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate(
            {"question": "q", "reranked": reranked, "grade": "ambiguous", "declined": True}
        )
        assert "Partial answer [1]." in out["answer"]
        assert "confidence" in out["answer"].lower()

    async def test_correct_grade_no_caveat(self, monkeypatch: pytest.MonkeyPatch) -> None:
        chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id="c1")
        reranked = [RetrievedChunk(chunk=chunk, score=0.9, source="reranked")]
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="Full answer [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate({"question": "q", "reranked": reranked, "grade": "correct"})
        assert out["answer"] == "Full answer [1]."

    async def test_weak_grade_after_failed_fallback_appends_caveat(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id="c1")
        reranked = [RetrievedChunk(chunk=chunk, score=0.4, source="reranked")]
        fake_llm = AsyncMock()
        fake_llm.ainvoke.return_value = MagicMock(content="Best-effort answer [1].")
        monkeypatch.setattr(agent_nodes, "get_chat_model", lambda **_: fake_llm)

        out = await agent_nodes.generate(
            {
                "question": "q",
                "reranked": reranked,
                "grade": "incorrect",
                "declined": False,
                "fallback_used": True,
            }
        )
        assert "Best-effort answer [1]." in out["answer"]
        assert "did not improve coverage" in out["answer"]


# ---------------------------------------------------------------------------
# web_search — URL-less-hit filter
# ---------------------------------------------------------------------------
class TestWebSearchUrlFilter:
    async def test_drops_hits_without_url(self, monkeypatch: pytest.MonkeyPatch) -> None:
        async def fake_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
            return [{"title": "no url", "content": "snip"}, {"url": "https://ok", "title": "ok"}]

        monkeypatch.setattr(agent_nodes, "search", fake_search)
        out = await agent_nodes.web_search({"question": "q", "search_query": "x"})
        assert [c["url"] for c in out["candidate_urls"]] == ["https://ok"]
