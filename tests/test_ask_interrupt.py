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


import uuid
from typing import Any
from unittest.mock import AsyncMock

import pytest

from sovereign_rag.api.ask import router as ask_router


def _interrupt_obj(value: dict[str, Any]) -> Any:
    # Mimic langgraph.types.Interrupt: an object with a .value attribute.
    class _I:
        def __init__(self, v: dict[str, Any]) -> None:
            self.value = v

    return _I(value)


class TestExtractInterrupt:
    def test_pulls_reason_candidates_grade(self) -> None:
        state = {
            "__interrupt__": (
                _interrupt_obj(
                    {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [
                            {"title": "A", "url": "https://a", "snippet": "s"},
                        ],
                    }
                ),
            )
        }
        out = ask_router._extract_interrupt(state)
        assert out is not None
        interrupt, grade = out
        assert interrupt.reason == "approve_urls"
        assert interrupt.candidate_urls[0].url == "https://a"
        assert grade is not None and grade.label == "ambiguous"

    def test_no_interrupt_returns_none(self) -> None:
        assert ask_router._extract_interrupt({"answer": "done"}) is None


class TestAskEndpointInterrupt:
    async def test_ask_returns_interrupted_status(self, monkeypatch: pytest.MonkeyPatch) -> None:
        graph = AsyncMock()
        graph.ainvoke.return_value = {
            "__interrupt__": (
                _interrupt_obj(
                    {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [{"title": "A", "url": "https://a", "snippet": "s"}],
                    }
                ),
            )
        }
        # record_run must NOT be called for a pause.
        rec = AsyncMock(side_effect=AssertionError("a pause is not a completed run"))
        monkeypatch.setattr(ask_router, "record_run", rec)

        from sovereign_rag.api.ask.schemas import AskRequest

        resp = await ask_router.ask(AskRequest(question="q?"), graph)
        assert resp.status == "interrupted"
        assert resp.answer is None
        assert resp.interrupt is not None
        assert resp.interrupt.candidate_urls[0].url == "https://a"
        assert resp.grade is not None and resp.grade.label == "ambiguous"
