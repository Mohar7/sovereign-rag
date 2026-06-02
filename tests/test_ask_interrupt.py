"""CRAG API: schema shapes + interrupt/resume behavior."""

from __future__ import annotations

from sovereign_rag.api.ask.schemas import (
    AskResponse,
    CandidateUrl,
    GradeModel,
    InterruptModel,
    ResumeRequest,
)


def test_ask_response_supports_interrupted_status() -> None:
    r = AskResponse(
        thread_id="t1",
        status="interrupted",
        interrupt=InterruptModel(
            reason="approve_urls",
            candidate_urls=[
                CandidateUrl(url="https://a", title="A", snippet="s"),
                CandidateUrl(url="https://b", title="B", snippet="s2", verified=False),
            ],
        ),
        grade=GradeModel(label="ambiguous", confidence=0.46, reason="thin"),
    )
    assert r.status == "interrupted"
    assert r.answer is None
    assert r.interrupt is not None
    assert r.interrupt.candidate_urls[0].url == "https://a"
    assert r.interrupt.candidate_urls[1].verified is False
    assert r.grade is not None and r.grade.label == "ambiguous"
    assert r.fallback_used is False


def test_ask_response_ok_still_valid() -> None:
    r = AskResponse(thread_id="t", status="ok", answer="hi", fallback_used=True)
    assert r.status == "ok"
    assert r.interrupt is None
    assert r.fallback_used is True


def test_resume_request_defaults_and_decline() -> None:
    approve = ResumeRequest(thread_id="t", approved_urls=["https://a"])
    decline = ResumeRequest(thread_id="t", approved_urls=[])
    assert approve.approved_urls == ["https://a"]
    assert decline.approved_urls == []


def test_candidate_url_verified_optional() -> None:
    c = CandidateUrl(url="https://a", title="A", snippet="s")
    assert c.verified is None
