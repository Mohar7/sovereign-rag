"""API-layer regression tests.

The pipeline/stores/ingestion modules are exercised heavily elsewhere; this
file targets thin glue in ``api.py`` that the rest of the suite would miss —
specifically the dataclass-to-pydantic conversion that powers /ask responses.
"""

from __future__ import annotations

from sovereign_rag.api.ask import AskResponse, _build_response
from sovereign_rag.retrieval.pipeline import Citation


def test_build_response_handles_slotted_citation_dataclasses() -> None:
    """Regression: ``Citation`` uses @dataclass(slots=True), so ``vars(c)`` raises.

    A live /ask call previously crashed with ``TypeError: vars() argument must
    have __dict__ attribute``. The fix routes the conversion through
    ``dataclasses.asdict``; this test pins that contract.
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
    }

    resp = _build_response("thread-xyz", final_state)

    assert isinstance(resp, AskResponse)
    assert resp.thread_id == "thread-xyz"
    assert resp.status == "ok"
    assert resp.answer == "The answer is [1]."
    assert resp.retrieved == 10
    assert resp.used == 5
    assert len(resp.citations) == 1
    c = resp.citations[0]
    assert c.chunk_id == "c1"
    assert c.title == "Sovereign Test"
    assert c.source_uri == "smoke://test"
    assert c.score == 0.87


def test_build_response_empty_citations() -> None:
    """An answer with no citations should still serialize cleanly."""
    resp = _build_response(
        "t1",
        {"answer": "no idea", "citations": [], "retrieved": 0, "used": 0},
    )
    assert resp.status == "ok"
    assert resp.answer == "no idea"
    assert resp.citations == []
