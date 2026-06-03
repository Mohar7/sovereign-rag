"""AgentState history-window reducer — trims to react_history_turns."""

from __future__ import annotations

import pytest

from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa.agent_state import HistoryTurn, window_history


def _t(q: str, a: str) -> HistoryTurn:
    return {"question": q, "answer": a}


def test_window_history_appends_from_empty() -> None:
    out = window_history(None, [_t("q1", "a1")])
    assert out == [{"question": "q1", "answer": "a1"}]


def test_window_history_trims_to_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "react_history_turns", 2)
    h = window_history(None, [_t("q1", "a1")])
    h = window_history(h, [_t("q2", "a2")])
    h = window_history(h, [_t("q3", "a3")])
    assert [t["question"] for t in h] == ["q2", "q3"]


def test_window_history_zero_means_unlimited(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_settings(), "react_history_turns", 0)
    existing = [_t(f"q{i}", f"a{i}") for i in range(10)]
    result = window_history(existing, [_t("q10", "a10")])
    assert len(result) == 11
