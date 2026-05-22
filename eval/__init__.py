"""Evaluation harness for sovereign-rag.

Two layers:

- `retrieval_metrics` — pure, service-free IR metrics (precision/recall/MRR/nDCG)
  over `RetrievedChunk` lists. Unit-testable without Milvus or Ollama.
- `ragas_eval` — RAGAS 0.2 answer-quality metrics, wired to Ollama. Requires a
  running Ollama daemon, so it is import-guarded and skippable.

`evaluate` is the CLI entrypoint that ties them together and degrades
gracefully when live services or the parallel-built pipeline are unavailable.
"""

from __future__ import annotations

__all__ = ["ragas_eval", "retrieval_metrics"]
