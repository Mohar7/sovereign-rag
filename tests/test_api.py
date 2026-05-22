"""API-layer regression tests.

The pipeline/stores/ingestion modules are exercised heavily elsewhere; this
file targets thin glue in `api.py` that the rest of the suite would miss —
specifically the dataclass-to-pydantic conversion that powers /ask responses
and the interrupt-vs-final-state branch in `_build_response`.
"""

from __future__ import annotations

from sovereign_rag.agent.state import INTERRUPT_REASON_APPROVE_URLS
from sovereign_rag.api import AskResponse, _build_response
from sovereign_rag.retrieval.pipeline import Citation


def test_build_response_handles_slotted_citation_dataclasses() -> None:
    """Regression: `Citation` uses @dataclass(slots=True), so `vars(c)` raises.

    A live /ask call previously crashed with `TypeError: vars() argument must
    have __dict__ attribute`. The fix routes the conversion through
    `dataclasses.asdict`; this test pins that contract.
    """
    cite = Citation(
        chunk_id="c1",
        doc_id="d1",
        title="Sovereign Test",
        source_uri="smoke://test",
        page=None,
        score=0.87,
        snippet="hello world",
    )
    final_state = {
        "answer": "The answer is [1].",
        "citations": [cite],
        "retrieved": 10,
        "used": 5,
        "fallback_used": False,
    }

    resp = _build_response("thread-xyz", final_state)

    assert isinstance(resp, AskResponse)
    assert resp.thread_id == "thread-xyz"
    assert resp.status == "ok"
    assert resp.answer == "The answer is [1]."
    assert resp.retrieved == 10
    assert resp.used == 5
    assert resp.fallback_used is False
    assert resp.interrupt is None
    assert len(resp.citations) == 1
    c = resp.citations[0]
    assert c.chunk_id == "c1"
    assert c.title == "Sovereign Test"
    assert c.source_uri == "smoke://test"
    assert c.score == 0.87


def test_build_response_empty_citations() -> None:
    """An answer with no citations should still serialize cleanly."""
    resp = _build_response("t1", {"answer": "no idea", "citations": [], "retrieved": 0, "used": 0})
    assert resp.status == "ok"
    assert resp.answer == "no idea"
    assert resp.citations == []


def test_build_response_surfaces_interrupt_payload() -> None:
    """When the graph paused inside web_fallback, the response should carry
    the candidate URLs and a stable reason tag — clients dispatch on it."""

    class _Interrupt:
        def __init__(self, value: dict[str, object]) -> None:
            self.value = value

    payload = {
        "reason": INTERRUPT_REASON_APPROVE_URLS,
        "candidate_urls": [
            {"url": "https://example.com/a", "title": "A", "snippet": "..."},
            {"url": "https://example.com/b", "title": "B", "snippet": "..."},
        ],
    }
    state = {"__interrupt__": [_Interrupt(payload)]}

    resp = _build_response("t-2", state)

    assert resp.status == "interrupted"
    assert resp.answer is None
    assert resp.citations == []
    assert resp.interrupt is not None
    assert resp.interrupt.reason == INTERRUPT_REASON_APPROVE_URLS
    assert [c.url for c in resp.interrupt.candidate_urls] == [
        "https://example.com/a",
        "https://example.com/b",
    ]


def test_build_response_interrupt_without_payload_value() -> None:
    """Bare interrupt (no .value) shouldn't crash — fall back to defaults."""
    state = {"__interrupt__": ["raw-string-interrupt"]}
    resp = _build_response("t-3", state)
    assert resp.status == "interrupted"
    assert resp.interrupt is not None
    assert resp.interrupt.candidate_urls == []
