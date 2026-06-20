"""Pydantic schemas for the ``/api/settings`` surface.

Split out of ``router.py`` so the persistence layer (``service.py``) can
validate stored overrides against the very same ``SettingsPatch`` shape the
HTTP route accepts — without importing the router (which would be circular).
"""

from __future__ import annotations

from pydantic import BaseModel, Field


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
    # Corrective RAG
    enable_corrective_rag: bool
    crag_correct_threshold: float
    crag_incorrect_threshold: float
    crag_max_corrections: int
    web_fallback_max_urls: int
    # Retrieval trace (inspector overlay)
    enable_retrieval_trace: bool


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
    # Embeddings — changing these triggers a re-embed migration. ``embed_dim`` is
    # DERIVED from the model server-side (never sent by the client) but is accepted
    # here so the server can persist/apply it through the same schema.
    embed_provider: str | None = Field(default=None, pattern="^(openai|ollama)$")
    openai_embed_model: str | None = Field(default=None, max_length=200)
    embed_model: str | None = Field(default=None, max_length=200)
    embed_dim: int | None = Field(default=None, ge=1, le=8192)
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
    # Corrective RAG
    enable_corrective_rag: bool | None = None
    crag_correct_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    crag_incorrect_threshold: float | None = Field(default=None, ge=0.0, le=1.0)
    crag_max_corrections: int | None = Field(default=None, ge=0, le=10)
    web_fallback_max_urls: int | None = Field(default=None, ge=1, le=20)
    # Retrieval trace (inspector overlay)
    enable_retrieval_trace: bool | None = None


class ModelChoice(BaseModel):
    """One model option in the LLM dropdowns."""

    id: str
    label: str
    family: str | None = None
    size: str | None = None
    note: str | None = None


# Fields that, when patched, require the LLM factory cache to be busted so
# the next graph run rebuilds the chat model with the new provider/model.
LLM_FIELDS: frozenset[str] = frozenset(
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


# Fields that, when patched, require a corpus re-embed (the embedding model/dim
# changed). ``embed_dim`` is intentionally NOT here — it is derived + persisted
# alongside the model, and must not itself re-trigger the migration.
EMBED_FIELDS: frozenset[str] = frozenset(
    {
        "embed_provider",
        "openai_embed_model",
        "embed_model",
    },
)


__all__ = ["EMBED_FIELDS", "LLM_FIELDS", "ModelChoice", "SettingsPatch", "SettingsResponse"]
