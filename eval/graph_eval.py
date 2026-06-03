"""Graph-driven evaluation: run the real CRAG graph with an auto-approver.

Drives the compiled rag_qa graph per question. When the graph pauses at the
HITL interrupt, an auto-approver resumes it with the top
``web_fallback_crawl_top_k`` candidate URLs — the same correction the product
runs, with a programmatic approver instead of a human. IR metrics read the
final ``reranked`` set; the grade + fallback flags come from the final state.
"""

from __future__ import annotations

import uuid
from typing import Any

from eval.retrieval_metrics import mrr, ndcg_at_k, precision_at_k, recall_at_k
from sovereign_rag.documents import RetrievedChunk, SourceDocument, SourceType

_AUTO_APPROVE_GUARD = 5  # never loop forever even if max_corrections is misconfigured


def _make_pipeline() -> Any:
    """Construct the real RAGPipeline (overridden in tests)."""
    from sovereign_rag.retrieval.pipeline import RAGPipeline

    return RAGPipeline()


def _row(
    question: str, reranked: list[RetrievedChunk], subs: list[str], k: int, state: dict[str, Any]
) -> dict[str, Any]:
    return {
        "question": question,
        "n_retrieved": len(reranked),
        f"precision@{k}": precision_at_k(reranked, subs, k),
        f"recall@{k}": recall_at_k(reranked, subs, k),
        "mrr": mrr(reranked, subs),
        f"ndcg@{k}": ndcg_at_k(reranked, subs, k),
        "grade": state.get("grade"),
        "grade_confidence": state.get("grade_confidence"),
        "fallback_used": bool(state.get("fallback_used", False)),
        "requires_web": False,  # filled by the caller from the qa item
    }


async def run_graph_eval(
    qa_pairs: list[dict[str, Any]],
    corpus: dict[str, str],
    k: int,
    *,
    enable_crag: bool = False,
    enable_agent: bool = False,
) -> list[dict[str, Any]]:
    """Index the corpus, compile the graph, and evaluate each question through it.

    ``enable_crag`` and ``enable_agent`` are set on Settings before the graph is
    built (they are build-time structural flags). ``enable_agent`` takes
    precedence: when True, ``enable_corrective_rag`` is forced off so the agent
    graph is built instead.  Returns one row per question with IR metrics +
    grade + fallback flags.
    """
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    from sovereign_rag.config import get_settings
    from sovereign_rag.graphs.rag_qa.graph import build_graph
    from sovereign_rag.shared.pipeline_deps import set_pipeline

    settings = get_settings()
    orig_crag = settings.enable_corrective_rag
    orig_agent = settings.enable_react_agent
    settings.enable_corrective_rag = enable_crag and not enable_agent
    settings.enable_react_agent = enable_agent

    pipeline = _make_pipeline()
    set_pipeline(pipeline)
    try:
        for doc_id, text in corpus.items():
            await pipeline.index_document(
                SourceDocument(
                    title=doc_id,
                    source_uri=f"corpus://{doc_id}",
                    source_type=SourceType.TEXT,
                    markdown=text,
                )
            )

        graph = build_graph(InMemorySaver())
        rows: list[dict[str, Any]] = []
        for item in qa_pairs:
            cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}
            state = await graph.ainvoke({"question": item["question"]}, config=cfg)

            guard = 0
            while "__interrupt__" in state and guard < _AUTO_APPROVE_GUARD:
                payload = getattr(state["__interrupt__"][0], "value", {}) or {}
                candidates = payload.get("candidate_urls", []) if isinstance(payload, dict) else []
                approved = [
                    c["url"]
                    for c in candidates[: settings.web_fallback_crawl_top_k]
                    if c.get("url")
                ]
                state = await graph.ainvoke(Command(resume={"approved_urls": approved}), config=cfg)
                guard += 1

            if enable_agent:
                from sovereign_rag.graphs.rag_qa.tools import select_grounding

                ranked = select_grounding(state.get("retrieved_pool") or {}, k)
            else:
                ranked = state.get("reranked") or []
            row = _row(item["question"], ranked, item.get("relevant_substrings", []), k, state)
            row["requires_web"] = bool(item.get("requires_web", False))
            row["steps"] = int(state.get("steps", 0))
            rows.append(row)
    finally:
        close = getattr(pipeline, "aclose", None)
        if close is not None:
            await close()
        settings.enable_corrective_rag = orig_crag
        settings.enable_react_agent = orig_agent

    return rows


def _mean(rows: list[dict[str, Any]], key: str) -> float:
    vals = [float(r[key]) for r in rows if key in r and isinstance(r[key], int | float)]
    return sum(vals) / len(vals) if vals else 0.0


def summarize_ab(
    off_rows: list[dict[str, Any]],
    on_rows: list[dict[str, Any]],
    k: int,
    agent_rows: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Compare CRAG-off vs CRAG-on rows (same question order).

    Reports the overall mean per IR metric for each arm, the lift on the
    ``requires_web`` slice (where correction should help), the grade
    distribution (CRAG-on), and how many questions fired the fallback.
    When ``agent_rows`` is provided, adds ``aggregate_agent``,
    ``agent_mean_steps``, and ``agent_fallback_fired`` to the summary.
    """
    metric_keys = [f"precision@{k}", f"recall@{k}", "mrr", f"ndcg@{k}"]
    aggregate_off = {m: _mean(off_rows, m) for m in metric_keys}
    aggregate_on = {m: _mean(on_rows, m) for m in metric_keys}

    web_off = [r for r in off_rows if r.get("requires_web")]
    web_on = [r for r in on_rows if r.get("requires_web")]
    lift = {m: round(_mean(web_on, m) - _mean(web_off, m), 4) for m in metric_keys}

    dist = {"correct": 0, "ambiguous": 0, "incorrect": 0}
    for r in on_rows:
        g = r.get("grade")
        if g in dist:
            dist[g] += 1

    result: dict[str, Any] = {
        "k": k,
        "aggregate_off": aggregate_off,
        "aggregate_on": aggregate_on,
        "lift_on_corrected": lift,
        "grade_distribution": dist,
        "fallback_fired": sum(1 for r in on_rows if r.get("fallback_used")),
        "n_questions": len(on_rows),
        "n_requires_web": len(web_on),
    }

    if agent_rows is not None:
        result["aggregate_agent"] = {m: _mean(agent_rows, m) for m in metric_keys}
        result["agent_mean_steps"] = round(_mean(agent_rows, "steps"), 2)
        result["agent_fallback_fired"] = sum(1 for r in agent_rows if r.get("fallback_used"))

    return result


async def run_ab(qa_pairs: list[dict[str, Any]], corpus: dict[str, str], k: int) -> dict[str, Any]:
    """Run the graph eval CRAG-off, CRAG-on, and agent arms; summarize the A/B."""
    off_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=False)
    on_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=True)
    agent_rows = await run_graph_eval(qa_pairs, corpus, k, enable_agent=True)
    return {
        "summary": summarize_ab(off_rows, on_rows, k, agent_rows=agent_rows),
        "per_question_off": off_rows,
        "per_question_on": on_rows,
        "per_question_agent": agent_rows,
    }


__all__ = ["run_ab", "run_graph_eval", "summarize_ab"]
