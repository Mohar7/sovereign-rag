"""RAGAS 0.2 answer-quality evaluation, wired to local Ollama.

This module computes the four classic RAG metrics — faithfulness,
answer relevancy, context precision, and context recall — using the **current
RAGAS 0.2 API** (verified against ragas 0.2.15):

- ``ragas.evaluate(dataset, metrics=[...], llm=..., embeddings=...)`` is the
  entrypoint (the 0.1 ``from_dict`` / HF-`Dataset`-only flow is gone).
- The dataset is built from ``ragas.dataset_schema.SingleTurnSample`` /
  ``EvaluationDataset`` whose fields are ``user_input``, ``response``,
  ``retrieved_contexts``, ``reference`` (the old ``question`` / ``answer`` /
  ``contexts`` / ``ground_truth`` column names are gone).
- Metric classes ``Faithfulness``, ``ResponseRelevancy`` (the renamed
  ``answer_relevancy``), ``LLMContextPrecisionWithReference``, and
  ``LLMContextRecall`` are instantiated and passed to ``evaluate``.
- The custom (Ollama) models are adapted with ``LangchainLLMWrapper`` and
  ``LangchainEmbeddingsWrapper`` — RAGAS never touches OpenAI.

Everything RAGAS-related is imported lazily inside :func:`run_ragas` so that
merely importing this module (e.g. for unit-testing the pure IR metrics) never
requires RAGAS, its heavy transitive deps, or a running Ollama daemon. If RAGAS
cannot be imported or no LLM/embeddings are reachable, the function returns a
result dict with ``available=False`` instead of raising.
"""

from __future__ import annotations

import logging
from typing import Any, TypedDict

logger = logging.getLogger(__name__)

__all__ = ["RAGAS_METRIC_NAMES", "RagasResult", "run_ragas"]

# The RAGAS column names each metric reports under, in the order we present them.
RAGAS_METRIC_NAMES: tuple[str, ...] = (
    "faithfulness",
    "answer_relevancy",
    "context_precision",
    "context_recall",
)


class RagasResult(TypedDict):
    """Outcome of a RAGAS run.

    ``available`` is False when RAGAS or Ollama could not be used; in that case
    ``scores`` is empty and ``reason`` explains why. When True, ``scores`` maps
    each metric name to its mean score across all samples.
    """

    available: bool
    scores: dict[str, float]
    reason: str | None


def _build_dataset(samples: list[dict[str, Any]]) -> Any:
    """Build a RAGAS ``EvaluationDataset`` from plain sample dicts.

    Each input sample dict is expected to carry ``question``, ``answer``,
    ``contexts`` (a list of strings) and ``ground_truth`` keys — the natural
    shape produced by the QA pipeline — and is mapped onto the current
    ``SingleTurnSample`` field names.
    """
    from ragas.dataset_schema import EvaluationDataset, SingleTurnSample

    single_turn_samples = [
        SingleTurnSample(
            user_input=sample["question"],
            response=sample["answer"],
            retrieved_contexts=list(sample["contexts"]),
            reference=sample["ground_truth"],
        )
        for sample in samples
    ]
    return EvaluationDataset(samples=single_turn_samples)


def _mean_scores(result: Any) -> dict[str, float]:
    """Extract per-metric mean scores from a RAGAS ``EvaluationResult``.

    ``result.to_pandas()`` yields one row per sample with one column per metric;
    we take the column means and drop any that came back entirely NaN.
    """
    import math

    frame = result.to_pandas()
    scores: dict[str, float] = {}
    for name in RAGAS_METRIC_NAMES:
        if name not in frame.columns:
            continue
        value = float(frame[name].mean())
        if not math.isnan(value):
            scores[name] = value
    return scores


async def run_ragas(samples: list[dict[str, Any]]) -> RagasResult:
    """Run RAGAS metrics over QA samples using Ollama as the evaluator.

    Parameters
    ----------
    samples:
        A list of dicts, each with ``question``, ``answer``, ``contexts``
        (list[str]), and ``ground_truth`` keys.

    Returns
    -------
    RagasResult
        ``available=True`` with a metric→mean-score mapping on success, or
        ``available=False`` with a ``reason`` if RAGAS/Ollama is unavailable or
        the run fails. This function never raises for the "services down" case;
        it degrades gracefully so the CLI can keep going.
    """
    if not samples:
        return RagasResult(available=False, scores={}, reason="no samples provided")

    # --- Import RAGAS lazily; the env may lack it or have a broken dep chain. ---
    try:
        from ragas import evaluate
        from ragas.embeddings import LangchainEmbeddingsWrapper
        from ragas.llms import LangchainLLMWrapper
        from ragas.metrics import (
            Faithfulness,
            LLMContextPrecisionWithReference,
            LLMContextRecall,
            ResponseRelevancy,
        )
        from ragas.run_config import RunConfig
    except Exception as exc:
        logger.warning("RAGAS unavailable, skipping answer-quality eval: %s", exc)
        return RagasResult(available=False, scores={}, reason=f"ragas import failed: {exc}")

    # --- Wire the Ollama-backed LLM + embeddings into RAGAS (NOT OpenAI). ---
    try:
        from sovereign_rag.providers.ollama import get_embeddings, get_llm

        evaluator_llm = LangchainLLMWrapper(get_llm())
        evaluator_embeddings = LangchainEmbeddingsWrapper(get_embeddings())
    except Exception as exc:
        logger.warning("Could not build Ollama evaluator models: %s", exc)
        return RagasResult(available=False, scores={}, reason=f"ollama provider unavailable: {exc}")

    metrics = [
        Faithfulness(llm=evaluator_llm),
        ResponseRelevancy(llm=evaluator_llm, embeddings=evaluator_embeddings),
        LLMContextPrecisionWithReference(llm=evaluator_llm),
        LLMContextRecall(llm=evaluator_llm),
    ]

    try:
        dataset = _build_dataset(samples)
        # Ollama on CPU is slow; give it generous timeouts and serialise calls
        # so we do not overwhelm the local daemon.
        run_config = RunConfig(timeout=600, max_retries=3, max_workers=1)
        result = evaluate(
            dataset=dataset,
            metrics=metrics,
            llm=evaluator_llm,
            embeddings=evaluator_embeddings,
            run_config=run_config,
            show_progress=False,
            raise_exceptions=False,
        )
    except Exception as exc:
        logger.warning("RAGAS evaluation failed (is Ollama running?): %s", exc)
        return RagasResult(available=False, scores={}, reason=f"ragas evaluate failed: {exc}")

    return RagasResult(available=True, scores=_mean_scores(result), reason=None)
