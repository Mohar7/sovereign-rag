"""Tests for settings persistence (``api/settings/service.py``).

Two tiers:

- **Unit** (default): the pure merge/validate/apply logic — ``coerce_overrides``
  and ``apply_to_settings`` — which need neither Postgres nor langchain.
- **Integration** (``RUN_PG_IT=1`` + a reachable Postgres): the real
  ``ensure_settings_table`` → ``persist_overrides`` → ``load_overrides``
  round-trip on the shared pool.
"""

from __future__ import annotations

import os

import pytest

from sovereign_rag.api.settings.schemas import LLM_FIELDS
from sovereign_rag.api.settings.service import apply_to_settings, coerce_overrides
from sovereign_rag.config import Settings

# ---------- unit: coerce_overrides ----------


def test_coerce_overrides_keeps_valid_fields() -> None:
    raw = {"llm_model": "minimax-m3", "rerank_top_k": 8, "adaptive_rerank": True}
    assert coerce_overrides(raw) == {
        "llm_model": "minimax-m3",
        "rerank_top_k": 8,
        "adaptive_rerank": True,
    }


def test_coerce_overrides_drops_unknown_keys() -> None:
    """A key that isn't a patchable field is silently ignored (extra='ignore')."""
    raw = {"graph_depth": 3, "totally_unknown_knob": 42}
    assert coerce_overrides(raw) == {"graph_depth": 3}


def test_coerce_overrides_drops_only_the_out_of_range_field() -> None:
    """One stale/invalid row must not wipe out the other valid overrides.

    ``rerank_top_k`` is capped at 50; a persisted 999 (e.g. from before a range
    was tightened) is dropped while ``llm_model`` still applies.
    """
    raw = {"rerank_top_k": 999, "llm_model": "minimax-m3"}
    assert coerce_overrides(raw) == {"llm_model": "minimax-m3"}


def test_coerce_overrides_empty() -> None:
    assert coerce_overrides({}) == {}


# ---------- unit: apply_to_settings ----------


def test_apply_to_settings_mutates_and_reports_applied() -> None:
    s = Settings()
    applied = apply_to_settings(s, {"llm_model": "minimax-m3", "rerank_top_k": 9})
    assert set(applied) == {"llm_model", "rerank_top_k"}
    assert s.llm_model == "minimax-m3"
    assert s.rerank_top_k == 9


def test_apply_to_settings_skips_nonexistent_fields() -> None:
    s = Settings()
    applied = apply_to_settings(s, {"nope": 1, "graph_depth": 4})
    assert applied == ["graph_depth"]
    assert s.graph_depth == 4


def test_llm_change_is_detected_via_llm_fields() -> None:
    """The PATCH route busts the LLM cache iff an applied field is LLM-related."""
    s = Settings()
    applied = apply_to_settings(s, {"llm_model": "minimax-m3", "graph_depth": 2})
    assert any(f in LLM_FIELDS for f in applied)

    applied_retrieval_only = apply_to_settings(s, {"graph_depth": 3})
    assert not any(f in LLM_FIELDS for f in applied_retrieval_only)


# ---------- integration: DB round-trip ----------


def _pg_reachable() -> bool:
    import psycopg

    from sovereign_rag.config import get_settings

    try:
        with psycopg.connect(get_settings().langgraph_pg_uri, connect_timeout=3) as conn:
            conn.execute("SELECT 1")
        return True
    except Exception:
        return False


_LIVE = os.getenv("RUN_PG_IT") == "1" and _pg_reachable()
_skip_live = pytest.mark.skipif(not _LIVE, reason="Postgres not reachable (set RUN_PG_IT=1)")


@pytest.mark.integration
@_skip_live
async def test_persist_then_load_round_trip() -> None:
    from psycopg import AsyncConnection
    from psycopg.rows import DictRow, dict_row
    from psycopg_pool import AsyncConnectionPool

    from sovereign_rag.api.settings.service import (
        ensure_settings_table,
        load_overrides,
        persist_overrides,
    )
    from sovereign_rag.config import get_settings
    from sovereign_rag.shared.pg_pool import set_pg_pool

    s = get_settings()
    async with AsyncConnectionPool[AsyncConnection[DictRow]](
        conninfo=s.langgraph_pg_uri,
        min_size=1,
        max_size=2,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
    ) as pool:
        await pool.open(wait=True)
        set_pg_pool(pool)
        try:
            await ensure_settings_table()
            await persist_overrides({"llm_model": "minimax-m3", "rerank_top_k": 7})
            loaded = await load_overrides()
            assert loaded["llm_model"] == "minimax-m3"
            assert loaded["rerank_top_k"] == 7
            # Upsert overwrites, not duplicates.
            await persist_overrides({"llm_model": "qwen2.5:7b"})
            loaded2 = await load_overrides()
            assert loaded2["llm_model"] == "qwen2.5:7b"
            assert loaded2["rerank_top_k"] == 7
        finally:
            async with pool.connection() as conn, conn.cursor() as cur:
                await cur.execute(
                    "DELETE FROM settings_overrides WHERE key = ANY(%s)",
                    (["llm_model", "rerank_top_k"],),
                )
            set_pg_pool(None)
