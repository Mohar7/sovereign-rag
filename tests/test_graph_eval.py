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
    # do_rerank's trace path calls rerank_scores/select_top_k directly, bypassing
    # the `rerank` stub above. Disable the trace so the stub drives the grade.
    monkeypatch.setattr(nodes.get_settings(), "enable_retrieval_trace", False, raising=False)

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

    # The graph-eval A/B (run_ab) also runs the ReAct agent arm, which calls
    # agent.get_chat_model. Stub it too so the agent arm stays fully offline:
    # the controller answers directly (no tool call) → finalize uses the reply,
    # so no retrieval and no real LLM/httpx client is created (which otherwise
    # errors with "Event loop is closed" during teardown in CI).
    from langchain_core.messages import AIMessage

    from sovereign_rag.graphs.rag_qa import agent as agent_mod

    class _AgentFakeChat:
        def bind_tools(self, _tools: object) -> _AgentFakeChat:
            return self

        async def ainvoke(self, _messages: object) -> AIMessage:
            return AIMessage(content="agent arm answer")

    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_kw: _AgentFakeChat())


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

    def test_print_table_renders_agent_block(self, capsys: pytest.CaptureFixture[str]) -> None:
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
                "aggregate_agent": {"precision@5": 0.92},
                "agent_mean_steps": 1.5,
                "agent_fallback_fired": 1,
            },
        }
        _print_table(report)
        out = capsys.readouterr().out
        assert "agent" in out.lower()
        assert "1.5" in out  # agent_mean_steps
        assert "0.92" in out  # agent precision


# ── Task 1: agent arm of run_graph_eval ────────────────────────────────────


class _FakeChat:
    """Scripted fake chat model — same pattern as tests/test_agent_loop.py."""

    def __init__(self, scripted: list[Any]) -> None:
        self._scripted = scripted
        self.calls = 0

    def bind_tools(self, tools: Any) -> _FakeChat:
        return self

    async def ainvoke(self, messages: Any) -> Any:

        msg = self._scripted[min(self.calls, len(self._scripted) - 1)]
        self.calls += 1
        return msg


@pytest.fixture
def stub_agent_eval(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the agent controller + corpus retrieval so the agent arm runs
    offline with deterministic IR metrics.

    Script: one SearchCorpus tool call → one final answer message.
    The stubbed corpus returns a chunk whose text contains the question's
    relevant_substrings so precision@k is non-trivial.
    """
    from langchain_core.messages import AIMessage

    import sovereign_rag.graphs.rag_qa.agent as agent_mod
    import sovereign_rag.graphs.rag_qa.tools as tools_mod

    # --- pipeline stub (same shape as stub_eval_graph) ---
    pipe = MagicMock()
    pipe._milvus = MagicMock()
    pipe._milvus.hybrid_search = AsyncMock(
        return_value=[_rc("short-lived activation pass; combined with the account secret", 0.9)]
    )
    pipe._graph = None
    pipe.aclose = AsyncMock()

    async def _index_doc(doc: Any, **_kw: Any) -> int:
        return 3

    pipe.index_document = _index_doc
    monkeypatch.setattr("sovereign_rag.graphs.rag_qa.nodes.get_pipeline", lambda: pipe)
    monkeypatch.setattr(graph_eval, "_make_pipeline", lambda: pipe)

    # --- stub run_search_corpus so retrieval returns the matching chunk ---
    matching_chunk = _rc("short-lived activation pass; combined with the account secret", 0.9)
    matching_chunk = RetrievedChunk(
        chunk=Chunk(
            doc_id="d",
            text="short-lived activation pass; combined with the account secret",
            raw_text="short-lived activation pass; combined with the account secret",
            position=0,
            chunk_id="c1",
        ),
        score=0.9,
        source="reranked",
    )

    async def fake_run_search_corpus(query: str, doc_id: str | None) -> tuple[str, dict[str, Any]]:
        import json

        pool = {"c1": matching_chunk}
        obs = json.dumps(
            {"results": [{"id": "c1", "score": 0.9, "snippet": "..."}], "top_score": 0.9}
        )
        return obs, {"retrieved_pool": pool, "retrieved": 1}

    monkeypatch.setattr(tools_mod, "run_search_corpus", fake_run_search_corpus)

    # --- scripted controller: one SearchCorpus call then a final answer ---
    scripted = [
        AIMessage(
            content="",
            tool_calls=[
                {"name": "SearchCorpus", "args": {"query": "ferret activation"}, "id": "tc1"}
            ],
        ),
        AIMessage(content="The activation pass is short-lived."),
        # finalize may call ainvoke again for grounding — supply an extra answer
        AIMessage(content="Grounded answer about activation pass [1]."),
    ]
    fake_chat = _FakeChat(scripted)
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_kw: fake_chat)


async def test_agent_arm_returns_rows_with_ir_metrics(stub_agent_eval: None) -> None:
    """run_graph_eval(enable_agent=True) returns rows with IR metrics + steps."""
    qa = [
        {
            "question": "How is FERRET's activation codeword provisioned?",
            "ground_truth": "...",
            "relevant_substrings": ["short-lived activation pass"],
            "requires_web": False,
        }
    ]
    rows = await graph_eval.run_graph_eval(qa, corpus={}, k=5, enable_agent=True)
    assert len(rows) == 1
    row = rows[0]
    assert "precision@5" in row
    assert "mrr" in row
    assert "steps" in row
    # the matching chunk contains the relevant substring → precision > 0
    assert row["precision@5"] > 0
    assert row["steps"] >= 1  # at least one agent step was taken


# ── Task 2: three-way A/B ──────────────────────────────────────────────────


class TestThreeWayAB:
    def test_summarize_ab_with_agent_rows(self) -> None:
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
                "steps": 0,
            },
        ]
        on = [
            {
                "question": "q1",
                "precision@5": 0.8,
                "recall@5": 0.8,
                "mrr": 0.8,
                "ndcg@5": 0.8,
                "grade": "correct",
                "fallback_used": True,
                "requires_web": True,
                "steps": 0,
            },
        ]
        agent_rows = [
            {
                "question": "q1",
                "precision@5": 1.0,
                "recall@5": 1.0,
                "mrr": 1.0,
                "ndcg@5": 1.0,
                "grade": None,
                "fallback_used": False,
                "requires_web": True,
                "steps": 2,
            },
        ]
        summary = graph_eval.summarize_ab(off, on, k=5, agent_rows=agent_rows)
        assert "aggregate_agent" in summary
        assert summary["aggregate_agent"]["precision@5"] == pytest.approx(1.0)
        assert summary["agent_mean_steps"] == pytest.approx(2.0)
        assert summary["agent_fallback_fired"] == 0

    async def test_run_ab_returns_per_question_agent(
        self, stub_eval_graph: None, stub_agent_eval: None
    ) -> None:
        qa = [
            {
                "question": "How is FERRET's activation codeword provisioned?",
                "ground_truth": "...",
                "relevant_substrings": ["short-lived activation pass"],
                "requires_web": False,
            }
        ]
        result = await graph_eval.run_ab(qa, corpus={}, k=5)
        assert "per_question_agent" in result
        assert len(result["per_question_agent"]) == 1
        assert "aggregate_agent" in result["summary"]
        assert "agent_mean_steps" in result["summary"]
