"""Graph-driven eval: auto-approver resumes interrupts; rows carry grade+fallback.

Offline: the web fixture supplies canned hits/pages, and a tiny in-memory
'pipeline' stands in for Milvus/Neo4j so no services are needed. The grader is
stubbed to grade the local corpus weak on requires_web questions.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from eval import graph_eval
from sovereign_rag.documents import Chunk, RetrievedChunk


def _rc(text: str, score: float) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(doc_id="d", text=text, raw_text=text, position=0),
        score=score,
        source="reranked",
    )


@pytest.fixture
def stub_eval_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the data plane + grader so the graph runs offline, and make the
    requires_web question grade weak first then strong after the fixture crawl."""
    from sovereign_rag.graphs.rag_qa import nodes
    from sovereign_rag.retrieval.grading import Grade

    # pipeline singleton: a mock whose retrieve/index are no-ops; the reranked
    # set comes from the rerank stub below.
    pipe = MagicMock()
    pipe._milvus = MagicMock()
    pipe._milvus.hybrid_search = AsyncMock(return_value=[_rc("local async note", 0.4)])
    pipe._graph = None
    pipe.aclose = AsyncMock()
    monkeypatch.setattr(nodes, "get_pipeline", lambda: pipe)
    monkeypatch.setattr(graph_eval, "_make_pipeline", lambda: pipe)

    # After a web crawl, retrieval includes the fixture chunk; model that by
    # flipping the rerank output once a crawl has run. IMPORTANT: do NOT patch
    # the `crawl_index` node function — graph.py imported it by value at module
    # load, so the compiled graph holds the original reference and a
    # monkeypatch on `nodes.crawl_index` would NOT be used by the graph. Instead
    # track the crawl via the pipeline's index_document, which the *real*
    # crawl_index calls at runtime (module-global lookup → the patch is seen).
    state_box = {"crawled": False}

    async def _index_doc(doc: Any, **_kw: Any) -> int:
        # **_kw absorbs the fast-path flags (with_context / with_graph) the real
        # crawl_index now passes for the Milvus-only web-fallback index.
        state_box["crawled"] = True
        return 3

    pipe.index_document = _index_doc

    def fake_rerank(
        q: str, c: list[RetrievedChunk], top_k: int | None = None
    ) -> list[RetrievedChunk]:
        if state_box["crawled"]:
            return [_rc("short-lived activation pass; combined with the account secret", 0.9)]
        return [_rc("local async note", 0.4)]

    monkeypatch.setattr(nodes, "rerank", fake_rerank)

    async def fake_grade(question, reranked, settings, **kw):  # type: ignore[no-untyped-def]
        top = reranked[0].score if reranked else 0.0
        return Grade("correct" if top >= 0.7 else "incorrect", top, "stub")

    monkeypatch.setattr(nodes, "grade_candidates", fake_grade)

    fake_llm_default = AsyncMock()
    fake_llm_default.ainvoke.return_value = MagicMock(content="answer [1]")
    fake_llm_light = AsyncMock()
    # transform_query (tier=light) must return a query that matches the fixture key
    # "ferret activation codeword" so web_search yields a candidate URL.
    fake_llm_light.ainvoke.return_value = MagicMock(content="ferret activation codeword")

    def _get_chat_model(model_tier: str = "default", **_kw: object) -> AsyncMock:
        return fake_llm_light if model_tier == "light" else fake_llm_default

    monkeypatch.setattr(nodes, "get_chat_model", _get_chat_model)


async def test_auto_approver_resumes_and_answers(stub_eval_graph: None) -> None:
    from eval.web_fixture import install, uninstall

    orig = install()
    try:
        qa = [
            {
                "question": "How is FERRET's activation codeword provisioned?",
                "ground_truth": "...",
                "relevant_substrings": ["short-lived activation pass"],
                "requires_web": True,
            }
        ]
        rows = await graph_eval.run_graph_eval(qa, corpus={}, k=5, enable_crag=True)
    finally:
        uninstall(*orig)

    assert len(rows) == 1
    row = rows[0]
    assert row["fallback_used"] is True  # auto-approver crawled the fixture
    assert row["grade"] == "correct"  # post-crawl grade
    assert row["precision@5"] > 0  # the fixture chunk matches the substring


async def test_crag_off_no_fallback(stub_eval_graph: None) -> None:
    qa = [
        {
            "question": "How is FERRET's activation codeword provisioned?",
            "ground_truth": "...",
            "relevant_substrings": ["short-lived activation pass"],
            "requires_web": True,
        }
    ]
    rows = await graph_eval.run_graph_eval(qa, corpus={}, k=5, enable_crag=False)
    assert rows[0]["fallback_used"] is False  # linear graph never interrupts
    assert rows[0]["precision@5"] == 0  # local corpus can't answer it


class TestAB:
    def test_grade_distribution_and_lift(self) -> None:
        off = [
            {
                "question": "q1",
                "precision@5": 0.0,
                "recall@5": 0.0,
                "mrr": 0.0,
                "ndcg@5": 0.0,
                "grade": None,
                "fallback_used": False,
                "requires_web": True,
            },
        ]
        on = [
            {
                "question": "q1",
                "precision@5": 1.0,
                "recall@5": 1.0,
                "mrr": 1.0,
                "ndcg@5": 1.0,
                "grade": "correct",
                "fallback_used": True,
                "requires_web": True,
            },
        ]
        ab = graph_eval.summarize_ab(off, on, k=5)
        assert ab["fallback_fired"] == 1
        assert ab["grade_distribution"] == {"correct": 1, "ambiguous": 0, "incorrect": 0}
        # lift on the requires_web slice
        assert ab["lift_on_corrected"]["precision@5"] == pytest.approx(1.0)
        assert ab["aggregate_off"]["precision@5"] == pytest.approx(0.0)
        assert ab["aggregate_on"]["precision@5"] == pytest.approx(1.0)


class TestGraphModeSmoke:
    async def test_run_graph_mode_offline_produces_crag_block(
        self, stub_eval_graph: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from eval.evaluate import _run_graph_mode

        qa = [
            {
                "question": "How is FERRET's activation codeword provisioned?",
                "ground_truth": "...",
                "relevant_substrings": ["short-lived activation pass"],
                "requires_web": True,
            },
        ]
        report = await _run_graph_mode(qa, corpus={}, k=5)
        assert report["mode"] == "graph"
        crag = report["crag"]
        assert crag["fallback_fired"] == 1
        # off can't answer it (0), on can (>0) → positive lift on the web slice
        assert crag["lift_on_corrected"]["precision@5"] > 0


class TestReport:
    def test_print_table_renders_crag_block(self, capsys: pytest.CaptureFixture[str]) -> None:
        from eval.evaluate import _print_table

        report = {
            "mode": "graph",
            "k": 5,
            "retrieval": {"per_question": [], "aggregate": {"precision@5": 0.86}},
            "ragas": {"available": False, "scores": {}, "reason": "graph mode"},
            "crag": {
                "k": 5,
                "aggregate_off": {"precision@5": 0.71},
                "aggregate_on": {"precision@5": 0.86},
                "lift_on_corrected": {"precision@5": 0.15},
                "grade_distribution": {"correct": 9, "ambiguous": 3, "incorrect": 2},
                "fallback_fired": 3,
                "n_questions": 14,
                "n_requires_web": 2,
            },
        }
        _print_table(report)
        out = capsys.readouterr().out
        assert "CORRECTIVE RAG" in out.upper()
        assert "fallback" in out.lower()
        assert "0.15" in out  # the lift
