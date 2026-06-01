"""``/api/settings`` — read + patch the running retrieval knobs.

The Settings singleton is ``lru_cache``d; the PATCH route mutates the cached
instance in-place so the next pipeline call sees new values without a
process restart. The LLM factory's per-(provider, tier) ``lru_cache`` is
also busted when any LLM field changes so the next graph run picks up the
new model immediately.

Persistence across restarts is a follow-up — for now restart resets the
process to whatever ``Settings()`` reads off the environment.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["settings"])


# ---------- schemas ----------


class SettingsResponse(BaseModel):
    # LLM
    llm_provider: str
    llm_model: str
    llm_model_light: str
    llm_model_nano: str
    openai_chat_model: str
    openai_chat_model_light: str
    openai_chat_model_nano: str
    llm_temperature: float
    # Embeddings
    embed_provider: str
    embed_model: str
    embed_dim: int
    # Retrieval
    retrieve_top_k: int
    rerank_top_k: int
    rrf_k: int
    enable_graph_retrieval: bool
    enable_contextual_retrieval: bool
    dense_enabled: bool
    sparse_enabled: bool
    fusion_strategy: str
    fusion_graph_weight: float
    fusion_vector_weight: float
    graph_depth: int
    graph_max_nodes: int
    # Rerank
    rerank_score_floor: float
    adaptive_rerank: bool
    reranker_model: str
    reranker_device: str


class SettingsPatch(BaseModel):
    # LLM
    llm_provider: str | None = Field(default=None, pattern="^(ollama|openai)$")
    llm_model: str | None = Field(default=None, min_length=1, max_length=200)
    llm_model_light: str | None = Field(default=None, min_length=1, max_length=200)
    llm_model_nano: str | None = Field(default=None, min_length=1, max_length=200)
    openai_chat_model: str | None = Field(default=None, max_length=200)
    openai_chat_model_light: str | None = Field(default=None, max_length=200)
    openai_chat_model_nano: str | None = Field(default=None, max_length=200)
    llm_temperature: float | None = Field(default=None, ge=0.0, le=2.0)
    # Retrieval
    retrieve_top_k: int | None = Field(default=None, ge=1, le=500)
    rerank_top_k: int | None = Field(default=None, ge=1, le=50)
    rrf_k: int | None = Field(default=None, ge=1, le=500)
    enable_graph_retrieval: bool | None = None
    enable_contextual_retrieval: bool | None = None
    dense_enabled: bool | None = None
    sparse_enabled: bool | None = None
    fusion_strategy: str | None = Field(default=None, pattern="^(rrf|weighted|borda)$")
    fusion_graph_weight: float | None = Field(default=None, ge=0.0, le=1.0)
    fusion_vector_weight: float | None = Field(default=None, ge=0.0, le=1.0)
    graph_depth: int | None = Field(default=None, ge=1, le=5)
    graph_max_nodes: int | None = Field(default=None, ge=10, le=500)
    # Rerank
    rerank_score_floor: float | None = Field(default=None, ge=0.0, le=1.0)
    adaptive_rerank: bool | None = None
    reranker_device: str | None = Field(default=None, pattern="^(auto|mps|cuda|cpu)$")


class ModelChoice(BaseModel):
    """One model option in the LLM dropdowns."""

    id: str
    label: str
    family: str | None = None
    size: str | None = None
    note: str | None = None


# Fields that, when patched, require the LLM factory cache to be busted so
# the next graph run rebuilds the chat model with the new provider/model.
_LLM_FIELDS: frozenset[str] = frozenset(
    {
        "llm_provider",
        "llm_model",
        "llm_model_light",
        "llm_model_nano",
        "openai_chat_model",
        "openai_chat_model_light",
        "openai_chat_model_nano",
        "llm_temperature",
    },
)


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


def _bust_llm_cache() -> None:
    """Clear the ``shared.llm_factory._cached`` lru so the next call rebuilds.

    Imported lazily so test collection doesn't pull langchain modules eagerly.
    """
    try:
        from sovereign_rag.shared import llm_factory

        llm_factory._cached.cache_clear()
        logger.info("llm_factory cache cleared")
    except Exception as exc:  # pragma: no cover — defensive
        logger.warning("could not clear llm_factory cache: %s", exc)


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
    s = get_settings()
    changed = patch.model_dump(exclude_none=True)
    for field, value in changed.items():
        if hasattr(s, field):
            setattr(s, field, value)
    # If anything LLM-related changed, blow away the per-(provider, tier) cache
    # so the next ``get_chat_model()`` call builds with the new wire config.
    if any(f in _LLM_FIELDS for f in changed):
        _bust_llm_cache()
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
