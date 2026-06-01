"""``/api/settings`` — read + patch the running retrieval knobs.

The Settings singleton is ``lru_cache``d; the PATCH route mutates the cached
instance in-place so the next pipeline call sees new values without a
process restart, **and** upserts the change into Postgres so it survives a
restart / re-deploy (see ``service.py`` — env defaults < persisted overrides;
applied at startup by the FastAPI lifespan). The LLM factory's
per-(provider, tier) ``lru_cache`` is busted when any LLM field changes so the
next graph run picks up the new model immediately.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query

from sovereign_rag.api.settings.schemas import (
    LLM_FIELDS,
    ModelChoice,
    SettingsPatch,
    SettingsResponse,
)
from sovereign_rag.api.settings.service import (
    apply_to_settings,
    bust_llm_cache,
    persist_overrides,
)
from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


# OpenAI catalog — hand-maintained because OpenAI doesn't expose a
# tiered/cleaned model list publicly. Reasoning-class models (gpt-5 / o-series)
# are flagged ``reasoning=True`` so the frontend can show a hint that the
# temperature slider is ignored for them.
_OPENAI_CATALOG: list[ModelChoice] = [
    ModelChoice(id="gpt-5", label="GPT-5", family="reasoning", size="full", note="reasoning"),
    ModelChoice(
        id="gpt-5-mini",
        label="GPT-5 mini",
        family="reasoning",
        size="mini",
        note="reasoning",
    ),
    ModelChoice(
        id="gpt-5-nano",
        label="GPT-5 nano",
        family="reasoning",
        size="nano",
        note="reasoning",
    ),
    ModelChoice(id="gpt-4.1", label="GPT-4.1", family="chat", size="full"),
    ModelChoice(id="gpt-4.1-mini", label="GPT-4.1 mini", family="chat", size="mini"),
    ModelChoice(id="gpt-4.1-nano", label="GPT-4.1 nano", family="chat", size="nano"),
    ModelChoice(id="gpt-4o", label="GPT-4o", family="chat", size="full"),
    ModelChoice(id="gpt-4o-mini", label="GPT-4o mini", family="chat", size="mini"),
    ModelChoice(id="o4-mini", label="o4-mini", family="reasoning", size="mini", note="reasoning"),
    ModelChoice(id="o3-mini", label="o3-mini", family="reasoning", size="mini", note="reasoning"),
]


def _snapshot() -> SettingsResponse:
    s = get_settings()
    return SettingsResponse(
        llm_provider=s.llm_provider,
        llm_model=s.llm_model,
        llm_model_light=s.llm_model_light,
        llm_model_nano=s.llm_model_nano,
        openai_chat_model=s.openai_chat_model,
        openai_chat_model_light=s.openai_chat_model_light,
        openai_chat_model_nano=s.openai_chat_model_nano,
        llm_temperature=s.llm_temperature,
        embed_provider=s.embed_provider,
        # Report the embedder actually in use: OpenAI setups embed with
        # ``openai_embed_model`` (text-embedding-3-large), not the local
        # ``embed_model`` (bge-m3) which is only the Ollama fallback.
        embed_model=(s.openai_embed_model if s.embed_provider == "openai" else s.embed_model),
        embed_dim=s.embed_dim,
        retrieve_top_k=s.retrieve_top_k,
        rerank_top_k=s.rerank_top_k,
        rrf_k=s.rrf_k,
        enable_graph_retrieval=s.enable_graph_retrieval,
        enable_contextual_retrieval=s.enable_contextual_retrieval,
        dense_enabled=s.dense_enabled,
        sparse_enabled=s.sparse_enabled,
        fusion_strategy=s.fusion_strategy,
        fusion_graph_weight=s.fusion_graph_weight,
        fusion_vector_weight=s.fusion_vector_weight,
        graph_depth=s.graph_depth,
        graph_max_nodes=s.graph_max_nodes,
        rerank_score_floor=s.rerank_score_floor,
        adaptive_rerank=s.adaptive_rerank,
        reranker_model=s.reranker_model,
        reranker_device=s.reranker_device,
    )


# ---------- routes ----------


@router.get("/settings", response_model=SettingsResponse)
async def settings_get() -> SettingsResponse:
    return _snapshot()


@router.patch("/settings", response_model=SettingsResponse)
async def settings_patch(patch: SettingsPatch) -> SettingsResponse:
    changed = patch.model_dump(exclude_none=True)
    # Persist first so a change that can't be saved fails loudly instead of
    # silently taking effect for this process only and vanishing on restart.
    if changed:
        try:
            await persist_overrides(changed)
        except Exception as exc:
            logger.error("failed to persist settings change: %s", exc)
            raise HTTPException(503, f"settings change not persisted: {exc}") from exc
    # Apply to the live cached Settings so the next pipeline call sees it now.
    applied = apply_to_settings(get_settings(), changed)
    # If anything LLM-related changed, blow away the per-(provider, tier) cache
    # so the next ``get_chat_model()`` call builds with the new wire config.
    if any(f in LLM_FIELDS for f in applied):
        bust_llm_cache()
    return _snapshot()


@router.get("/models", response_model=list[ModelChoice])
async def list_models(
    provider: str = Query("ollama", pattern="^(ollama|openai)$"),
) -> list[ModelChoice]:
    """List candidate chat models for the given provider.

    - ``ollama``: queries the daemon's ``/api/tags`` for installed local models.
      Falls back to an empty list (with a 503) if the daemon is unreachable.
    - ``openai``: returns the curated catalog above (``_OPENAI_CATALOG``).
    """
    if provider == "openai":
        return _OPENAI_CATALOG

    s = get_settings()
    url = f"{s.ollama_base_url.rstrip('/')}/api/tags"
    headers = {"Authorization": f"Bearer {s.ollama_api_key}"} if s.ollama_api_key else {}
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            r = await client.get(url, headers=headers)
            r.raise_for_status()
            data: dict[str, Any] = r.json()
    except httpx.HTTPError as exc:
        raise HTTPException(503, f"ollama unreachable at {url}: {exc}") from exc

    out: list[ModelChoice] = []
    for m in data.get("models", []):
        name = m.get("name") or m.get("model")
        if not isinstance(name, str):
            continue
        details = m.get("details") or {}
        family = details.get("family") if isinstance(details, dict) else None
        param_size = details.get("parameter_size") if isinstance(details, dict) else None
        out.append(
            ModelChoice(
                id=name,
                label=name,
                family=family if isinstance(family, str) else None,
                size=param_size if isinstance(param_size, str) else None,
            ),
        )
    return sorted(out, key=lambda c: c.id)


__all__ = ["router"]
