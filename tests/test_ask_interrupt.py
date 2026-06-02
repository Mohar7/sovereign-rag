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


class TestStreamGenerator:
    async def _drain(self, gen: Any) -> list[dict[str, Any]]:
        import json

        out: list[dict[str, Any]] = []
        async for raw in gen:
            line = raw.decode() if isinstance(raw, bytes) else raw
            for part in line.strip().split("\n"):
                if part.startswith("data: "):
                    out.append(json.loads(part[len("data: ") :]))
        return out

    async def _events_from(self, evlist: list[dict[str, Any]]) -> Any:
        for e in evlist:
            yield e

    async def test_grade_and_interrupt_events(self, monkeypatch: pytest.MonkeyPatch) -> None:
        # astream_events emits: grade node end (with grade fields), then the
        # run pauses. aget_state reports the pending interrupt.
        ev = [
            {"event": "on_chain_start", "name": "grade", "data": {}},
            {
                "event": "on_chain_end",
                "name": "grade",
                "data": {"output": {"grade": "ambiguous", "grade_confidence": 0.46,
                                    "grade_reason": "thin"}},
            },
        ]
        graph = AsyncMock()
        graph.astream_events = lambda *a, **k: self._events_from(ev)

        class _Snap:
            next = ("request_approval",)

            class _Task:
                interrupts = (
                    type("I", (), {"value": {
                        "reason": "approve_urls",
                        "grade": {"label": "ambiguous", "confidence": 0.46, "reason": "thin"},
                        "candidate_urls": [{"title": "A", "url": "https://a", "snippet": "s"}],
                    }})(),
                )

            tasks = (_Task(),)

        graph.aget_state = AsyncMock(return_value=_Snap())
        rec = AsyncMock(side_effect=AssertionError("pause is not a run"))
        monkeypatch.setattr(ask_router, "record_run", rec)

        gen = ask_router._stream_generator(
            graph, {"question": "q"}, {"configurable": {"thread_id": "t"}}, "t", None
        )
        events = await self._drain(gen)
        types = [e["type"] for e in events]
        assert "grade" in types
        grade_ev = next(e for e in events if e["type"] == "grade")
        assert grade_ev["label"] == "ambiguous" and grade_ev["confidence"] == 0.46
        assert "interrupt" in types
        intr = next(e for e in events if e["type"] == "interrupt")
        assert intr["candidate_urls"][0]["url"] == "https://a"
        assert "done" not in types  # a pause does not emit done

    async def test_crawl_progress_passthrough(self, monkeypatch: pytest.MonkeyPatch) -> None:
        ev = [
            {"event": "on_custom_event", "name": "crawl_progress",
             "data": {"url": "https://a", "status": "indexed", "chunks": 7}},
        ]
        graph = AsyncMock()
        graph.astream_events = lambda *a, **k: self._events_from(ev)

        class _Snap:
            next = ()
            tasks = ()
            values = {"answer": "done", "citations": [], "retrieved": 1, "used": 1}

        graph.aget_state = AsyncMock(return_value=_Snap())
        monkeypatch.setattr(ask_router, "record_run", AsyncMock())

        gen = ask_router._stream_generator(
            graph, {"question": "q"}, {"configurable": {"thread_id": "t"}}, "t", None
        )
        events = await self._drain(gen)
        cp = [e for e in events if e["type"] == "crawl_progress"]
        assert cp and cp[0]["url"] == "https://a" and cp[0]["chunks"] == 7
