"""Hybrid grader unit tests — threshold short-circuits + injectable LLM band."""

from __future__ import annotations

from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.grading import Grade, _parse_verdict, grade_candidates


def _settings() -> Settings:
    # Code defaults: correct=0.70, incorrect=0.30, rerank_top_k=5.
    return Settings(_env_file=None)


def _rc(score: float) -> RetrievedChunk:
    chunk = Chunk(doc_id="d", text="t", raw_text="passage text", position=0)
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


async def test_no_candidates_is_incorrect() -> None:
    g = await grade_candidates("q", [], _settings())
    assert g.label == "incorrect"
    assert g.confidence == 0.0


async def test_high_score_is_correct_without_llm() -> None:
    async def boom(_q: str, _s: list[str]) -> tuple[str, str]:
        raise AssertionError("LLM must not be called on a decisive score")

    g = await grade_candidates("q", [_rc(5.0)], _settings(), llm_judge=boom)
    assert g.label == "correct"
    assert g.confidence > 0.70


async def test_low_score_is_incorrect_without_llm() -> None:
    async def boom(_q: str, _s: list[str]) -> tuple[str, str]:
        raise AssertionError("LLM must not be called on a decisive score")

    g = await grade_candidates("q", [_rc(-5.0)], _settings(), llm_judge=boom)
    assert g.label == "incorrect"
    assert g.confidence < 0.30


async def test_mid_score_consults_llm_judge() -> None:
    seen: dict[str, object] = {}

    async def judge(q: str, snippets: list[str]) -> tuple[str, str]:
        seen.update(q=q, snippets=snippets)
        return "ambiguous", "covers the topic generally, not the specific case"

    g = await grade_candidates("the q", [_rc(0.0)], _settings(), llm_judge=judge)
    assert g.label == "ambiguous"
    assert 0.30 < g.confidence < 0.70  # sigmoid(0) == 0.5, inside the band
    assert g.reason.startswith("covers the topic")
    assert seen["q"] == "the q"
    assert seen["snippets"] == ["passage text"]


async def test_llm_judge_may_upgrade_to_correct() -> None:
    async def judge(_q: str, _s: list[str]) -> tuple[str, str]:
        return "correct", "passages fully answer it"

    g = await grade_candidates("q", [_rc(0.0)], _settings(), llm_judge=judge)
    assert g.label == "correct"


async def test_returns_grade_dataclass() -> None:
    g = await grade_candidates("q", [], _settings())
    assert isinstance(g, Grade)


# ---------------------------------------------------------------------------
# Robustness: lenient verdict parsing + graceful degradation (prod hardening).
# Small light-tier models emit prose, not JSON — the old with_structured_output
# path 500'd /ask in prod. The grader must parse prose and never propagate.
# ---------------------------------------------------------------------------
def test_parse_verdict_handles_prose_not_sufficient() -> None:
    # The exact shape that 500'd in prod: a prose verdict, not JSON.
    text = (
        "The retrieved passage is **not sufficient** to answer the question. "
        "Reason: the passage is in Russian about opening a bank account and "
        "contains no information about multithreading."
    )
    label, reason = _parse_verdict(text)
    assert label == "incorrect"
    assert "not sufficient" in reason.lower()


def test_parse_verdict_negatives_win_over_substring_positives() -> None:
    # 'incorrect' contains 'correct'; 'insufficient'/'not sufficient' contain
    # 'sufficient' — the negative cues must be checked first.
    assert _parse_verdict("incorrect")[0] == "incorrect"
    assert _parse_verdict("The passages are insufficient.")[0] == "incorrect"
    assert _parse_verdict("irrelevant to the question")[0] == "incorrect"


def test_parse_verdict_positive_and_ambiguous() -> None:
    assert _parse_verdict("correct — the passages fully answer it")[0] == "correct"
    assert _parse_verdict("The context is sufficient.")[0] == "correct"
    assert _parse_verdict("ambiguous / only partially relevant")[0] == "ambiguous"
    assert _parse_verdict("partial coverage")[0] == "ambiguous"


def test_parse_verdict_unrecognized_defaults_ambiguous() -> None:
    label, reason = _parse_verdict("")
    assert label == "ambiguous"
    assert reason == "no grader output"
    assert _parse_verdict("hmm, maybe?")[0] == "ambiguous"


async def test_grade_candidates_degrades_when_judge_raises() -> None:
    async def boom(_q: str, _s: list[str]) -> tuple[str, str]:
        raise ValueError("OutputParserException: Invalid json output")

    g = await grade_candidates("q", [_rc(0.0)], _settings(), llm_judge=boom)
    # A grader infra failure must NOT propagate (no 500); degrade to 'correct'.
    assert g.label == "correct"
    assert 0.30 < g.confidence < 0.70
    assert "grader unavailable" in g.reason
