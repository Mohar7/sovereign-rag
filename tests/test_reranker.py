"""Reranker unit tests — mock the heavyweight CrossEncoder.

These tests don't load `BAAI/bge-reranker-v2-m3` (>1 GB) or even import
sentence-transformers. They pin the contract: device picking is sane,
the ranker is built lazily and cached, and `rerank()` returns chunks
sorted by descending score with `source="reranked"`.
"""

from __future__ import annotations

from unittest.mock import MagicMock

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.providers import reranker


def test_pick_device_passthrough() -> None:
    assert reranker._pick_device("cpu") == "cpu"
    assert reranker._pick_device("mps") == "mps"
    assert reranker._pick_device("cuda") == "cuda"


def test_pick_device_auto_prefers_mps_then_cuda_then_cpu(monkeypatch: pytest.MonkeyPatch) -> None:
    import torch

    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)  # mps wins anyway
    assert reranker._pick_device("auto") == "mps"

    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)
    assert reranker._pick_device("auto") == "cuda"

    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: False)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    assert reranker._pick_device("auto") == "cpu"


def _make_candidate(chunk_id: str, text: str, score: float = 0.5) -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d",
        text=text,
        raw_text=text,
        position=0,
        chunk_id=chunk_id,
    )
    return RetrievedChunk(chunk=chunk, score=score, source="milvus_hybrid")


def test_rerank_empty_returns_empty(monkeypatch: pytest.MonkeyPatch) -> None:
    # `_ranker` must NOT be called when there are no candidates.
    sentinel = MagicMock(side_effect=AssertionError("ranker should not be called"))
    monkeypatch.setattr(reranker, "_ranker", sentinel)
    assert reranker.rerank("q", [], top_k=5) == []


def test_rerank_sorts_descending_by_score_and_tags_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    candidates = [
        _make_candidate("a", "Alice works at Acme."),
        _make_candidate("b", "Unrelated weather report."),
        _make_candidate("c", "Bob met Alice last week."),
    ]

    # Mock CrossEncoder.predict so we don't load a 1 GB model in unit tests.
    fake_ce = MagicMock()
    fake_ce.predict.return_value = [0.10, 0.90, 0.55]  # b > c > a
    monkeypatch.setattr(reranker, "_ranker", lambda: fake_ce)

    out = reranker.rerank("Who is Alice?", candidates, top_k=2)

    assert [rc.chunk.chunk_id for rc in out] == ["b", "c"]
    assert [round(rc.score, 2) for rc in out] == [0.90, 0.55]
    assert all(rc.source == "reranked" for rc in out)
    # pairs passed to predict are (query, chunk.text) tuples, in input order.
    pairs = fake_ce.predict.call_args.args[0]
    assert pairs == [
        ("Who is Alice?", "Alice works at Acme."),
        ("Who is Alice?", "Unrelated weather report."),
        ("Who is Alice?", "Bob met Alice last week."),
    ]


def test_rerank_defaults_top_k_from_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """When top_k is None, rerank should fall back to settings.rerank_top_k."""
    candidates = [_make_candidate(str(i), f"chunk {i}") for i in range(10)]
    fake_ce = MagicMock()
    fake_ce.predict.return_value = list(range(10))  # ascending, so 9..0 after sort
    monkeypatch.setattr(reranker, "_ranker", lambda: fake_ce)

    # Pin settings.rerank_top_k via monkeypatch on the cached settings object.
    from sovereign_rag.config import get_settings

    s = get_settings()
    monkeypatch.setattr(s, "rerank_top_k", 3)

    out = reranker.rerank("q", candidates)
    assert len(out) == 3
    assert [rc.chunk.chunk_id for rc in out] == ["9", "8", "7"]
