"""Unit tests for the pure IR metrics in ``eval.retrieval_metrics``.

These are service-free: known retrieved-chunk rankings -> known
precision / recall / MRR / nDCG values, hand-computed in the docstrings.
Run with ``pytest -m "not integration"`` — none of these need Milvus/Ollama.
"""

from __future__ import annotations

import math
import sys
from pathlib import Path

import pytest

# Put repo root on the path so `eval.*` imports work regardless of cwd.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

from eval.retrieval_metrics import (  # noqa: E402
    is_relevant,
    mrr,
    ndcg_at_k,
    precision_at_k,
    recall_at_k,
    relevance_flags,
)
from sovereign_rag.documents import Chunk, RetrievedChunk  # noqa: E402

pytestmark = pytest.mark.unit


# --------------------------------------------------------------------------- #
# Helpers                                                                      #
# --------------------------------------------------------------------------- #
def _rc(raw_text: str, score: float = 1.0, source: str = "test") -> RetrievedChunk:
    """Build a RetrievedChunk whose raw_text is what relevance matches against."""
    chunk = Chunk(doc_id="d", text=raw_text, raw_text=raw_text, position=0)
    return RetrievedChunk(chunk=chunk, score=score, source=source)


def _ranking(*raw_texts: str) -> list[RetrievedChunk]:
    """Build a ranked list (best first) from raw texts."""
    return [_rc(t) for t in raw_texts]


# --------------------------------------------------------------------------- #
# is_relevant / relevance_flags                                                #
# --------------------------------------------------------------------------- #
def test_is_relevant_substring_match() -> None:
    assert is_relevant(_rc("the event loop is single-threaded"), ["event loop"])


def test_is_relevant_is_case_insensitive() -> None:
    assert is_relevant(_rc("The EVENT Loop"), ["event loop"])


def test_is_relevant_no_match() -> None:
    assert not is_relevant(_rc("unrelated text"), ["event loop"])


def test_is_relevant_ignores_blank_substrings() -> None:
    # A blank/whitespace golden substring must not match everything.
    assert not is_relevant(_rc("anything at all"), ["", "   "])


def test_is_relevant_matches_against_raw_text_only() -> None:
    # `text` may carry a contextual prefix; relevance must use `raw_text`.
    chunk = Chunk(
        doc_id="d",
        text="CONTEXT PREFIX: about asyncio. asyncio.run is the entry point",
        raw_text="asyncio.run is the entry point",
        position=0,
    )
    rc = RetrievedChunk(chunk=chunk, score=1.0, source="test")
    assert is_relevant(rc, ["asyncio.run"])
    # A substring that lives only in the prefix must NOT count as relevant.
    assert not is_relevant(rc, ["CONTEXT PREFIX"])


def test_relevance_flags_preserves_order() -> None:
    ranking = _ranking("has event loop", "nope", "event loop again")
    assert relevance_flags(ranking, ["event loop"]) == [True, False, True]


# --------------------------------------------------------------------------- #
# precision_at_k                                                               #
# --------------------------------------------------------------------------- #
def test_precision_at_k_all_relevant() -> None:
    ranking = _ranking("event loop", "event loop", "event loop")
    assert precision_at_k(ranking, ["event loop"], 3) == 1.0


def test_precision_at_k_half_relevant() -> None:
    # 2 relevant out of top-4 -> 0.5
    ranking = _ranking("event loop", "no", "event loop", "no")
    assert precision_at_k(ranking, ["event loop"], 4) == 0.5


def test_precision_at_k_divides_by_k_even_with_short_list() -> None:
    # Only 2 chunks retrieved, both relevant, but k=5 -> 2/5 = 0.4.
    ranking = _ranking("event loop", "event loop")
    assert precision_at_k(ranking, ["event loop"], 5) == pytest.approx(0.4)


def test_precision_at_k_respects_cutoff() -> None:
    # The 4th (relevant) chunk is beyond k=3, so it does not count.
    ranking = _ranking("no", "no", "no", "event loop")
    assert precision_at_k(ranking, ["event loop"], 3) == 0.0


def test_precision_at_k_zero_k() -> None:
    assert precision_at_k(_ranking("event loop"), ["event loop"], 0) == 0.0


# --------------------------------------------------------------------------- #
# recall_at_k                                                                  #
# --------------------------------------------------------------------------- #
def test_recall_at_k_all_targets_found() -> None:
    # Two distinct relevant targets, both present in top-k -> 1.0.
    ranking = _ranking("alpha here", "beta here")
    assert recall_at_k(ranking, ["alpha", "beta"], 5) == 1.0


def test_recall_at_k_partial() -> None:
    # Two targets, only one present -> 0.5.
    ranking = _ranking("alpha here", "nothing")
    assert recall_at_k(ranking, ["alpha", "beta"], 5) == 0.5


def test_recall_at_k_target_beyond_cutoff_not_counted() -> None:
    # "beta" only appears at rank 3, which is beyond k=2 -> only alpha -> 0.5.
    ranking = _ranking("alpha", "filler", "beta")
    assert recall_at_k(ranking, ["alpha", "beta"], 2) == 0.5


def test_recall_at_k_dedupes_targets() -> None:
    # Same target appearing in many chunks still counts once; one target -> 1.0.
    ranking = _ranking("alpha", "alpha", "alpha")
    assert recall_at_k(ranking, ["alpha"], 5) == 1.0


def test_recall_at_k_no_targets() -> None:
    assert recall_at_k(_ranking("anything"), [], 5) == 0.0


def test_recall_at_k_zero_k() -> None:
    assert recall_at_k(_ranking("alpha"), ["alpha"], 0) == 0.0


# --------------------------------------------------------------------------- #
# mrr                                                                          #
# --------------------------------------------------------------------------- #
def test_mrr_first_position() -> None:
    assert mrr(_ranking("event loop", "no"), ["event loop"]) == 1.0


def test_mrr_third_position() -> None:
    # First relevant hit at rank 3 -> 1/3.
    assert mrr(_ranking("no", "no", "event loop"), ["event loop"]) == pytest.approx(1 / 3)


def test_mrr_no_hit() -> None:
    assert mrr(_ranking("no", "no"), ["event loop"]) == 0.0


def test_mrr_uses_first_hit_only() -> None:
    # Hits at ranks 2 and 4 -> MRR uses the first -> 1/2.
    assert mrr(_ranking("no", "hit", "no", "hit"), ["hit"]) == 0.5


# --------------------------------------------------------------------------- #
# ndcg_at_k                                                                    #
# --------------------------------------------------------------------------- #
def test_ndcg_perfect_ranking_is_one() -> None:
    # Single relevant target at rank 1 -> DCG == IDCG -> 1.0.
    assert ndcg_at_k(_ranking("alpha", "no", "no"), ["alpha"], 3) == 1.0


def test_ndcg_relevant_at_rank_two() -> None:
    # One relevant target, but it is at rank 2.
    #   DCG  = 1/log2(3)
    #   IDCG = 1/log2(2) = 1   (ideal puts the single relevant at rank 1)
    #   nDCG = (1/log2(3)) / 1
    expected = (1.0 / math.log2(3)) / 1.0
    assert ndcg_at_k(_ranking("no", "alpha"), ["alpha"], 5) == pytest.approx(expected)


def test_ndcg_two_targets_one_misplaced() -> None:
    # Two distinct targets; ranking = [alpha(rel), filler, beta(rel)].
    #   DCG  = 1/log2(2) + 1/log2(4) = 1 + 0.5 = 1.5
    #   IDCG = 1/log2(2) + 1/log2(3) (two relevant ideally at ranks 1,2)
    #   nDCG = 1.5 / (1 + 1/log2(3))
    dcg = 1.0 / math.log2(2) + 1.0 / math.log2(4)
    idcg = 1.0 / math.log2(2) + 1.0 / math.log2(3)
    assert ndcg_at_k(_ranking("alpha", "filler", "beta"), ["alpha", "beta"], 5) == pytest.approx(
        dcg / idcg
    )


def test_ndcg_no_relevant_is_zero() -> None:
    assert ndcg_at_k(_ranking("no", "no"), ["alpha"], 5) == 0.0


def test_ndcg_zero_k() -> None:
    assert ndcg_at_k(_ranking("alpha"), ["alpha"], 0) == 0.0


def test_ndcg_respects_cutoff() -> None:
    # Relevant chunk sits at rank 3 but k=2 -> nothing relevant within cutoff.
    assert ndcg_at_k(_ranking("no", "no", "alpha"), ["alpha"], 2) == 0.0


def test_ndcg_is_between_zero_and_one() -> None:
    ranking = _ranking("no", "alpha", "no", "beta", "gamma")
    value = ndcg_at_k(ranking, ["alpha", "beta", "gamma"], 5)
    assert 0.0 <= value <= 1.0


def test_ndcg_multiple_chunks_match_same_substring_stays_bounded() -> None:
    # Single golden substring; three retrieved chunks all contain it.
    # Previous implementation normalized by distinct substrings (=1) and
    # produced nDCG > 1. New behaviour: IDCG is built from the number of
    # relevant retrieved positions, so a perfect ranking yields exactly 1.0
    # and the result is always within [0, 1].
    ranking = _ranking("alpha here", "alpha said hello", "more about alpha")
    assert ndcg_at_k(ranking, ["alpha"], 3) == pytest.approx(1.0)
    # Same scenario but the second hit is misplaced behind a non-relevant.
    ranking2 = _ranking("alpha here", "completely irrelevant", "alpha said hello")
    value = ndcg_at_k(ranking2, ["alpha"], 3)
    assert 0.0 < value < 1.0


# --------------------------------------------------------------------------- #
# End-to-end sanity over a tiny realistic fixture                              #
# --------------------------------------------------------------------------- #
def test_metrics_on_mixed_ranking() -> None:
    ranking = _ranking(
        "the event loop is single-threaded",  # relevant
        "completely unrelated paragraph",  # not
        "tasks yield control at await points",  # relevant (second target)
    )
    substrings = ["single-threaded", "yield control"]

    assert precision_at_k(ranking, substrings, 3) == pytest.approx(2 / 3)
    assert recall_at_k(ranking, substrings, 3) == 1.0
    assert mrr(ranking, substrings) == 1.0  # first chunk is relevant
    assert 0.0 < ndcg_at_k(ranking, substrings, 3) <= 1.0
