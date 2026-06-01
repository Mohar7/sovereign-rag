"""Settings persistence — survive restarts and re-deploys.

The ``Settings`` singleton is loaded from env once and cached. The PATCH route
mutates that cached instance in place, which makes a change take effect
immediately *for the running process* — but a restart (or an auto-deploy)
reconstructs ``Settings()`` from the environment and the change is gone. That's
the "settings reset after deployment" complaint.

This module adds a thin durable layer on the **same Postgres** the LangGraph
checkpointer already uses (one shared pool):

- a single ``settings_overrides`` key→value table (one row per changed knob);
- :func:`persist_overrides` upserts the fields a PATCH changed;
- :func:`load_and_apply_overrides` runs at startup, reads the table, validates
  the values through :class:`SettingsPatch` (the same schema the HTTP route
  enforces), and applies them on top of the env defaults.

Precedence is therefore **env defaults < persisted overrides**. Only the
user-tunable fields in ``SettingsPatch`` are ever stored — secrets
(``openai_api_key``, ``ollama_api_key``, ``neo4j_password``) and wiring
(``*_uri``) stay env-only and are never written to the database.
"""

from __future__ import annotations

import json
import logging
from typing import TYPE_CHECKING, Any

import psycopg
from psycopg.rows import tuple_row
from pydantic import ValidationError

from sovereign_rag.api.settings.schemas import LLM_FIELDS, SettingsPatch
from sovereign_rag.config import get_settings
from sovereign_rag.shared.pg_pool import get_pg_pool

if TYPE_CHECKING:
    from sovereign_rag.config import Settings

logger = logging.getLogger(__name__)


_CREATE_SQL = """
CREATE TABLE IF NOT EXISTS settings_overrides (
    key        TEXT PRIMARY KEY,
    value      JSONB NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_UPSERT_SQL = """
INSERT INTO settings_overrides (key, value, updated_at)
VALUES (%s, %s::jsonb, NOW())
ON CONFLICT (key) DO UPDATE
    SET value = EXCLUDED.value, updated_at = NOW()
"""


async def ensure_settings_table() -> None:
    """Idempotent: create the ``settings_overrides`` table if it's missing.

    Runs against the shared pool, whose connections are autocommit — so the
    ``CREATE ... IF NOT EXISTS`` commits on its own. Non-fatal: if it fails the
    app still serves settings from the env, just without persistence.
    """
    try:
        async with get_pg_pool().connection() as conn, conn.cursor() as cur:
            await cur.execute(_CREATE_SQL)
        logger.info("settings_overrides table ready")
    except Exception as exc:
        logger.warning("ensure_settings_table failed: %s", exc)


async def load_overrides() -> dict[str, Any]:
    """Return the persisted ``{field: value}`` map (empty if none / on error).

    ``value`` is a JSONB column, so psycopg hands back already-parsed Python
    scalars (str / int / float / bool) — no manual ``json.loads`` needed.
    """
    try:
        async with (
            get_pg_pool().connection() as conn,
            conn.cursor(row_factory=tuple_row) as cur,
        ):
            await cur.execute("SELECT key, value FROM settings_overrides")
            rows = await cur.fetchall()
    except psycopg.errors.UndefinedTable:
        return {}
    except Exception as exc:
        logger.warning("load_overrides failed: %s", exc)
        return {}
    return dict(rows)


async def persist_overrides(changed: dict[str, Any]) -> None:
    """Upsert each changed field into ``settings_overrides``.

    Raises on failure so the PATCH route can surface a clear error rather than
    silently accepting a change that won't survive the next restart.
    """
    if not changed:
        return
    async with get_pg_pool().connection() as conn, conn.cursor() as cur:
        for key, value in changed.items():
            await cur.execute(_UPSERT_SQL, (key, json.dumps(value)))
    logger.info("persisted %d setting override(s): %s", len(changed), ", ".join(sorted(changed)))


def coerce_overrides(raw: dict[str, Any]) -> dict[str, Any]:
    """Validate a raw override map through :class:`SettingsPatch`.

    Returns the clean, typed subset to apply. Keys that aren't valid patch
    fields, or whose stored value no longer satisfies the field's constraints
    (e.g. a range tightened in a later release), are dropped — best-effort,
    field by field, so one stale row can't wipe out every other override.
    """
    if not raw:
        return {}
    try:
        return SettingsPatch(**raw).model_dump(exclude_none=True)
    except ValidationError as exc:
        logger.warning("persisted settings failed validation; applying valid fields only: %s", exc)
        clean: dict[str, Any] = {}
        for key, value in raw.items():
            try:
                clean.update(SettingsPatch(**{key: value}).model_dump(exclude_none=True))
            except ValidationError:
                logger.warning("dropping invalid persisted setting %s=%r", key, value)
        return clean


def apply_to_settings(s: Settings, clean: dict[str, Any]) -> list[str]:
    """Set each ``clean`` field on the cached ``Settings`` instance in place.

    Returns the names of the fields actually applied (those that exist on
    ``Settings``), so the caller can decide whether to bust the LLM cache.
    """
    applied: list[str] = []
    for field, value in clean.items():
        if hasattr(s, field):
            setattr(s, field, value)
            applied.append(field)
    return applied


def bust_llm_cache() -> None:
    """Clear ``shared.llm_factory._cached`` so the next call rebuilds the model.

    Imported lazily so importing this module (and test collection) doesn't pull
    langchain eagerly.
    """
    try:
        from sovereign_rag.shared import llm_factory

        llm_factory._cached.cache_clear()
        logger.info("llm_factory cache cleared")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("could not clear llm_factory cache: %s", exc)


async def load_and_apply_overrides() -> list[str]:
    """Startup hook: read persisted overrides and layer them onto env defaults.

    Validates through :class:`SettingsPatch`, applies onto the cached
    ``Settings``, and busts the LLM factory cache if any LLM-affecting field
    changed. Returns the applied field names (empty if none). Safe to call
    before any request — it only touches the shared pool + the singleton.
    """
    clean = coerce_overrides(await load_overrides())
    applied = apply_to_settings(get_settings(), clean)
    if any(field in LLM_FIELDS for field in applied):
        bust_llm_cache()
    if applied:
        logger.info(
            "applied %d persisted setting override(s): %s",
            len(applied),
            ", ".join(sorted(applied)),
        )
    return applied


__all__ = [
    "apply_to_settings",
    "bust_llm_cache",
    "coerce_overrides",
    "ensure_settings_table",
    "load_and_apply_overrides",
    "load_overrides",
    "persist_overrides",
]
