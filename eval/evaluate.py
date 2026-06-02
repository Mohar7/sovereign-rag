"""CLI entrypoint for the sovereign-rag evaluation harness.

Run it with::

    uv run python eval/evaluate.py
    # or, as a module:
    uv run python -m eval.evaluate

Behaviour
---------
The harness has a *live* path and an *offline* path and chooses automatically:

- **Live** — if the parallel-built retrieval pipeline imports AND Milvus/Ollama
  answer, it ingests ``eval/corpus/``, runs retrieval for every question,
  computes the pure IR metrics over the real retrieved chunks, runs RAGAS over
  the generated answers, prints a table, and writes ``eval/results.json``.
- **Offline** — if the pipeline module is missing (it is built by another agent
  in parallel) or the services are down, it falls back to a self-contained
  demo: it chunks the bundled corpus in memory, fakes a retrieval ranking per
  question, computes the pure IR metrics on that fixture, prints them, and
  clearly states that live RAG + RAGAS evaluation was skipped.

The offline path needs no network and no external services, so this command
always exits 0 with a meaningful report — which is exactly what CI and a fresh
checkout need.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import os
import sys
from pathlib import Path
from typing import Any

# Make `sovereign_rag` importable when run as a bare script (uv run eval/evaluate.py),
# and `eval.*` importable too, by putting both repo-root and src/ on the path.
_REPO_ROOT = Path(__file__).resolve().parent.parent
_SRC = _REPO_ROOT / "src"
for _p in (str(_REPO_ROOT), str(_SRC)):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from sovereign_rag.documents import Chunk, RetrievedChunk, SourceDocument, SourceType  # noqa: E402

try:  # works both as a module (`python -m eval.evaluate`) and as a script
    from eval.ragas_eval import RAGAS_METRIC_NAMES, run_ragas
    from eval.retrieval_metrics import mrr, ndcg_at_k, precision_at_k, recall_at_k
except ImportError:  # pragma: no cover - script-mode fallback
    from ragas_eval import RAGAS_METRIC_NAMES, run_ragas  # type: ignore[no-redef]
    from retrieval_metrics import (  # type: ignore[no-redef]
        mrr,
        ndcg_at_k,
        precision_at_k,
        recall_at_k,
    )

_EVAL_DIR = Path(__file__).resolve().parent
_QA_PATH = _EVAL_DIR / "qa_pairs.json"
_CORPUS_DIR = _EVAL_DIR / "corpus"
_RESULTS_PATH = _EVAL_DIR / "results.json"

# Default top-k cutoff for the IR metrics.
_K = 5


# --------------------------------------------------------------------------- #
# Loading                                                                      #
# --------------------------------------------------------------------------- #
def load_qa_pairs(path: Path = _QA_PATH) -> list[dict[str, Any]]:
    """Load the golden Q&A set from disk."""
    return json.loads(path.read_text(encoding="utf-8"))


def load_corpus(corpus_dir: Path = _CORPUS_DIR) -> dict[str, str]:
    """Map each corpus doc id (the filename stem) to its raw markdown text."""
    return {
        md_path.stem: md_path.read_text(encoding="utf-8")
        for md_path in sorted(corpus_dir.glob("*.md"))
    }


def _chunk_corpus(corpus: dict[str, str]) -> list[Chunk]:
    """Chunk the corpus into paragraph-ish units, service-free.

    The real pipeline uses a LangChain splitter; for the offline demo we split
    on blank lines, which is enough to produce realistic, substring-matchable
    chunks without importing the chunking stack.
    """
    chunks: list[Chunk] = []
    for doc_id, text in corpus.items():
        position = 0
        for block in text.split("\n\n"):
            body = block.strip()
            if not body:
                continue
            chunks.append(Chunk(doc_id=doc_id, text=body, raw_text=body, position=position))
            position += 1
    return chunks


# --------------------------------------------------------------------------- #
# Offline fixture retrieval                                                    #
# --------------------------------------------------------------------------- #
def _fixture_retrieve(
    question_substrings: list[str],
    corpus_chunks: list[Chunk],
    k: int,
) -> list[RetrievedChunk]:
    """Rank corpus chunks for a question without any live retriever.

    A lexical-overlap heuristic stands in for dense retrieval: chunks that
    contain more of the question's relevant substrings (and more of their
    words) score higher. This is intentionally simple — the point of the
    offline path is to exercise the IR metrics on realistic data, not to be a
    good retriever.
    """
    needles = [s.casefold() for s in question_substrings if s.strip()]
    needle_words = {w for s in needles for w in s.split() if len(w) > 3}

    scored: list[tuple[float, Chunk]] = []
    for chunk in corpus_chunks:
        hay = chunk.raw_text.casefold()
        substr_hits = sum(1 for n in needles if n in hay)
        word_hits = sum(1 for w in needle_words if w in hay)
        score = substr_hits * 100.0 + word_hits
        scored.append((score, chunk))

    scored.sort(key=lambda pair: pair[0], reverse=True)
    return [
        RetrievedChunk(chunk=chunk, score=score, source="fixture")
        for score, chunk in scored[:k]
        if score > 0
    ]


# --------------------------------------------------------------------------- #
# Metric computation                                                           #
# --------------------------------------------------------------------------- #
def _retrieval_row(
    question: str,
    retrieved: list[RetrievedChunk],
    relevant_substrings: list[str],
    k: int,
) -> dict[str, Any]:
    """Compute all IR metrics for one question."""
    return {
        "question": question,
        "n_retrieved": len(retrieved),
        f"precision@{k}": precision_at_k(retrieved, relevant_substrings, k),
        f"recall@{k}": recall_at_k(retrieved, relevant_substrings, k),
        "mrr": mrr(retrieved, relevant_substrings),
        f"ndcg@{k}": ndcg_at_k(retrieved, relevant_substrings, k),
    }


def _aggregate(rows: list[dict[str, Any]]) -> dict[str, float]:
    """Mean of each numeric metric column across all question rows."""
    if not rows:
        return {}
    metric_keys = [key for key, value in rows[0].items() if isinstance(value, int | float)]
    return {key: sum(float(row[key]) for row in rows) / len(rows) for key in metric_keys}


# --------------------------------------------------------------------------- #
# Live pipeline (lazy, optional)                                               #
# --------------------------------------------------------------------------- #
async def _run_live(
    qa_pairs: list[dict[str, Any]],
    corpus: dict[str, str],
    k: int,
) -> dict[str, Any] | None:
    """Attempt a full live evaluation; return None if it cannot run.

    The retrieval pipeline is imported lazily because it is built by another
    agent in parallel and may not exist yet. Any import or runtime failure
    (module missing, Milvus/Ollama down) makes this return None so the caller
    falls back to the offline demo.
    """
    try:
        # Built in parallel; expected to expose an async ingest + retrieve/answer
        # surface. Imported defensively — we tolerate it being absent or partial.
        from sovereign_rag.retrieval.pipeline import (  # type: ignore[import-not-found]
            RAGPipeline,
        )
    except Exception:
        return None

    try:
        pipeline = RAGPipeline()
        # Index every corpus doc as a SourceDocument. We use a stable
        # `corpus://<doc_id>` URI so re-runs over the same corpus don't
        # produce duplicate Milvus rows on a wiped collection.
        for doc_id, text in corpus.items():
            doc = SourceDocument(
                title=doc_id,
                source_uri=f"corpus://{doc_id}",
                source_type=SourceType.TEXT,
                markdown=text,
            )
            await pipeline.index_document(doc)

        skip_ragas = os.environ.get("EVAL_SKIP_RAGAS", "").lower() in ("1", "true", "yes")
        retrieval_rows: list[dict[str, Any]] = []
        ragas_samples: list[dict[str, Any]] = []
        for item in qa_pairs:
            # Run retrieve + answer as separate calls so we can measure IR
            # metrics on the actual rerank output, and so the RAGAS sample
            # carries both the answer and the contexts that backed it.
            retrieved: list[RetrievedChunk] = await pipeline.retrieve(item["question"])
            retrieval_rows.append(
                _retrieval_row(item["question"], retrieved, item["relevant_substrings"], k)
            )
            if not skip_ragas:
                # Generating an answer requires an LLM call. When RAGAS is
                # disabled (IR-only mode), skip the LLM entirely — the metrics
                # we still compute only need the rerank output.
                result = await pipeline.answer(item["question"])
                ragas_samples.append(
                    {
                        "question": item["question"],
                        "answer": result.answer,
                        "contexts": [rc.chunk.raw_text for rc in retrieved],
                        "ground_truth": item["ground_truth"],
                    }
                )
    except Exception as exc:
        print(f"  live pipeline present but not usable ({exc}); falling back.")
        return None
    finally:
        with contextlib.suppress(Exception):
            await pipeline.aclose()

    if os.environ.get("EVAL_SKIP_RAGAS", "").lower() in ("1", "true", "yes"):
        ragas_result: dict[str, Any] = {
            "available": False,
            "scores": {},
            "reason": "skipped via EVAL_SKIP_RAGAS env",
        }
    else:
        ragas_result = dict(await run_ragas(ragas_samples))
    return {
        "mode": "live",
        "k": k,
        "retrieval": {
            "per_question": retrieval_rows,
            "aggregate": _aggregate(retrieval_rows),
        },
        "ragas": ragas_result,
    }


# --------------------------------------------------------------------------- #
# Offline demo                                                                 #
# --------------------------------------------------------------------------- #
def _run_offline(
    qa_pairs: list[dict[str, Any]],
    corpus: dict[str, str],
    k: int,
) -> dict[str, Any]:
    """Self-contained IR-metric demo over the bundled corpus (no services)."""
    corpus_chunks = _chunk_corpus(corpus)
    rows: list[dict[str, Any]] = []
    for item in qa_pairs:
        retrieved = _fixture_retrieve(item["relevant_substrings"], corpus_chunks, k)
        rows.append(_retrieval_row(item["question"], retrieved, item["relevant_substrings"], k))
    return {
        "mode": "offline",
        "k": k,
        "n_corpus_chunks": len(corpus_chunks),
        "retrieval": {"per_question": rows, "aggregate": _aggregate(rows)},
        "ragas": {
            "available": False,
            "scores": {},
            "reason": "live RAG + RAGAS skipped (offline demo)",
        },
    }


# --------------------------------------------------------------------------- #
# Graph-driven mode (EVAL_USE_GRAPH=1)                                        #
# --------------------------------------------------------------------------- #
async def _run_graph_mode(
    qa_pairs: list[dict[str, Any]], corpus: dict[str, str], k: int
) -> dict[str, Any]:
    """Graph-driven CRAG A/B mode (EVAL_USE_GRAPH=1).

    Installs the recorded web fixture (deterministic, offline) unless
    EVAL_WEB_LIVE=1, runs the CRAG-off vs CRAG-on A/B through the real graph,
    and shapes the result into the standard report plus a ``crag`` block the
    Evals dashboard reads.
    """
    from eval.graph_eval import run_ab

    use_live_web = os.environ.get("EVAL_WEB_LIVE", "").lower() in ("1", "true", "yes")
    orig = None
    if not use_live_web:
        from eval import web_fixture

        orig = web_fixture.install()
    try:
        ab = await run_ab(qa_pairs, corpus, k)
    finally:
        if orig is not None:
            from eval import web_fixture

            web_fixture.uninstall(*orig)

    on_rows = ab["per_question_on"]
    return {
        "mode": "graph",
        "k": k,
        "retrieval": {
            "per_question": on_rows,  # the CRAG-on arm is the headline
            "aggregate": ab["summary"]["aggregate_on"],
        },
        "ragas": {"available": False, "scores": {}, "reason": "graph mode: IR + CRAG A/B only"},
        "crag": ab["summary"],
    }


# --------------------------------------------------------------------------- #
# Reporting                                                                    #
# --------------------------------------------------------------------------- #
def _print_table(report: dict[str, Any]) -> None:
    """Pretty-print the report. (Printing is fine — this is a CLI.)"""
    mode = report["mode"]
    k = report["k"]
    print()
    print("=" * 72)
    print(f"  sovereign-rag evaluation  —  mode: {mode.upper()}  (k={k})")
    print("=" * 72)
    if mode == "offline":
        print(
            "  NOTE: live retrieval pipeline / Milvus / Ollama were not "
            "available.\n        Ran the self-contained IR-metric demo on the "
            "bundled corpus.\n        Live RAG answer-quality (RAGAS) evaluation "
            "was SKIPPED."
        )
        print(f"        ({report['n_corpus_chunks']} corpus chunks in memory)")
    print("-" * 72)

    rows = report["retrieval"]["per_question"]
    if rows:
        metric_cols = [key for key in rows[0] if key not in {"question", "n_retrieved"}]
        header = f"  {'question':42.42}  " + "  ".join(f"{c:>10.10}" for c in metric_cols)
        print(header)
        print("-" * 72)
        for row in rows:
            cells = "  ".join(f"{float(row[c]):>10.3f}" for c in metric_cols)
            print(f"  {row['question']:42.42}  {cells}")
        print("-" * 72)

    agg = report["retrieval"]["aggregate"]
    print("  RETRIEVAL (mean over questions):")
    for key, value in agg.items():
        print(f"    {key:<16} {value:.4f}")

    ragas = report["ragas"]
    print("  RAGAS (answer quality):")
    if ragas.get("available"):
        for name in RAGAS_METRIC_NAMES:
            if name in ragas["scores"]:
                print(f"    {name:<18} {ragas['scores'][name]:.4f}")
    else:
        print(f"    skipped — {ragas.get('reason')}")

    crag = report.get("crag")
    if crag:
        print("  CORRECTIVE RAG (A/B — CRAG off → on):")
        for metric, on_val in crag["aggregate_on"].items():
            off_val = crag["aggregate_off"].get(metric, 0.0)
            lift = crag["lift_on_corrected"].get(metric, 0.0)
            print(f"    {metric:<14} {off_val:.3f} -> {on_val:.3f}   (lift@web {lift:+.3f})")
        dist = crag["grade_distribution"]
        print(
            f"    grades         {dist['correct']}✓ / {dist['ambiguous']}~ / {dist['incorrect']}✗"
        )
        print(f"    fallback fired {crag['fallback_fired']} / {crag['n_questions']} questions")
    print("=" * 72)


def _write_results(report: dict[str, Any], path: Path = _RESULTS_PATH) -> None:
    """Persist the full report as JSON for CI artifacts / diffing."""
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"  wrote {path}")


# --------------------------------------------------------------------------- #
# Entrypoint                                                                   #
# --------------------------------------------------------------------------- #
async def _amain(k: int = _K) -> dict[str, Any]:
    qa_pairs = load_qa_pairs()
    corpus = load_corpus()

    if os.environ.get("EVAL_USE_GRAPH", "").lower() in ("1", "true", "yes"):
        report = await _run_graph_mode(qa_pairs, corpus, k)
    else:
        report = await _run_live(qa_pairs, corpus, k)
        if report is None:
            report = _run_offline(qa_pairs, corpus, k)

    _print_table(report)
    _write_results(report)
    return report


def main() -> None:
    """Synchronous wrapper used by the CLI and the console entrypoint."""
    asyncio.run(_amain())


if __name__ == "__main__":
    main()
