"""record_run carries CRAG fields; the ALTER/INSERT SQL includes the columns."""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock

import pytest

from sovereign_rag.api.runs import service


class _Cur:
    def __init__(self) -> None:
        self.executed: list[tuple[str, Any]] = []

    async def execute(self, sql: str, params: Any = None) -> None:
        self.executed.append((sql, params))

    async def __aenter__(self) -> _Cur:
        return self

    async def __aexit__(self, *a: Any) -> None:
        return None


class _Conn:
    def __init__(self, cur: _Cur) -> None:
        self._cur = cur

    def cursor(self, **_: Any) -> _Cur:
        return self._cur

    async def __aenter__(self) -> _Conn:
        return self

    async def __aexit__(self, *a: Any) -> None:
        return None


def _pool_with(cur: _Cur, monkeypatch: pytest.MonkeyPatch) -> None:
    pool = MagicMock()
    pool.connection = lambda: _Conn(cur)
    monkeypatch.setattr(service, "get_pg_pool", lambda: pool)


async def test_record_run_includes_crag_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    await service.record_run(
        thread_id="t",
        question="q",
        answer="a",
        retrieved=4,
        used=1,
        citations=[],
        timings={"total": 10},
        overrides=None,
        model="m",
        status="ok",
        grade="ambiguous",
        grade_confidence=0.46,
        fallback_used=True,
        decision="approved",
        correction_attempts=1,
    )
    sql, params = cur.executed[-1]
    assert "grade" in sql and "fallback_used" in sql and "decision" in sql
    assert "correction_attempts" in sql and "grade_confidence" in sql
    # the new values are bound (order-independent membership check)
    assert "ambiguous" in params and 0.46 in params and "approved" in params


async def test_ensure_table_adds_columns(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    await service.ensure_runs_table()
    all_sql = " ".join(s for s, _ in cur.executed)
    for col in ("grade", "grade_confidence", "fallback_used", "decision", "correction_attempts"):
        assert f"ADD COLUMN IF NOT EXISTS {col}" in all_sql


async def test_record_run_defaults_crag_fields_optional(monkeypatch: pytest.MonkeyPatch) -> None:
    cur = _Cur()
    _pool_with(cur, monkeypatch)
    # Called the old way (no CRAG kwargs) — must not raise.
    await service.record_run(
        thread_id="t",
        question="q",
        answer="a",
        retrieved=0,
        used=0,
        citations=[],
        timings={},
        overrides=None,
        model="m",
    )
    assert cur.executed  # an INSERT ran
