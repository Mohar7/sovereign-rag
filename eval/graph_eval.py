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


def _row(question: str, reranked: list[RetrievedChunk], subs: list[str], k: int,
         state: dict[str, Any]) -> dict[str, Any]:
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
    enable_crag: bool,
) -> list[dict[str, Any]]:
    """Index the corpus, compile the graph, and evaluate each question through it.

    ``enable_crag`` is set on Settings before the graph is built (it is a
    build-time structural flag). Returns one row per question with IR metrics +
    grade + fallback flags.
    """
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    from sovereign_rag.config import get_settings
    from sovereign_rag.graphs.rag_qa.graph import build_graph
    from sovereign_rag.shared.pipeline_deps import set_pipeline

    settings = get_settings()
    orig_crag = settings.enable_corrective_rag
    settings.enable_corrective_rag = enable_crag

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
                approved = [c["url"] for c in candidates[: settings.web_fallback_crawl_top_k] if c.get("url")]
                state = await graph.ainvoke(Command(resume={"approved_urls": approved}), config=cfg)
                guard += 1

            reranked = state.get("reranked") or []
            row = _row(item["question"], reranked, item.get("relevant_substrings", []), k, state)
            row["requires_web"] = bool(item.get("requires_web", False))
            rows.append(row)
    finally:
        close = getattr(pipeline, "aclose", None)
        if close is not None:
            await close()
        settings.enable_corrective_rag = orig_crag

    return rows


def _mean(rows: list[dict[str, Any]], key: str) -> float:
    vals = [float(r[key]) for r in rows if key in r and isinstance(r[key], int | float)]
    return sum(vals) / len(vals) if vals else 0.0


def summarize_ab(off_rows: list[dict[str, Any]], on_rows: list[dict[str, Any]], k: int) -> dict[str, Any]:
    """Compare CRAG-off vs CRAG-on rows (same question order).

    Reports the overall mean per IR metric for each arm, the lift on the
    ``requires_web`` slice (where correction should help), the grade
    distribution (CRAG-on), and how many questions fired the fallback.
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

    return {
        "k": k,
        "aggregate_off": aggregate_off,
        "aggregate_on": aggregate_on,
        "lift_on_corrected": lift,
        "grade_distribution": dist,
        "fallback_fired": sum(1 for r in on_rows if r.get("fallback_used")),
        "n_questions": len(on_rows),
        "n_requires_web": len(web_on),
    }


async def run_ab(qa_pairs: list[dict[str, Any]], corpus: dict[str, str], k: int) -> dict[str, Any]:
    """Run the graph eval CRAG-off then CRAG-on and summarize the A/B."""
    off_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=False)
    on_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=True)
    return {
        "summary": summarize_ab(off_rows, on_rows, k),
        "per_question_off": off_rows,
        "per_question_on": on_rows,
    }


__all__ = ["run_ab", "run_graph_eval", "summarize_ab"]
