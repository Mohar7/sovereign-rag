"""Embedding model catalog.

``embed_dim`` is **derived** from the model, never hand-set: the Milvus
collection schema and the Neo4j vector index are built from it, so a mismatched
dimension silently breaks retrieval. The admin UI picks a *model*; the server
looks the dimension up here.
"""

from __future__ import annotations

from dataclasses import dataclass

EMBED_MODEL_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "bge-m3": 1024,
}


@dataclass(frozen=True, slots=True)
class EmbedModelChoice:
    id: str
    provider: str  # "openai" | "ollama"
    dim: int
    label: str


EMBED_MODELS: list[EmbedModelChoice] = [
    EmbedModelChoice("text-embedding-3-small", "openai", 1536, "OpenAI 3-small (1536)"),
    EmbedModelChoice("text-embedding-3-large", "openai", 3072, "OpenAI 3-large (3072)"),
    EmbedModelChoice("bge-m3", "ollama", 1024, "bge-m3 local (1024)"),
]


def dim_for_model(provider: str, model: str) -> int:
    """Return the native dimension for ``model`` (raises ``ValueError`` if unknown)."""
    try:
        return EMBED_MODEL_DIMS[model]
    except KeyError as exc:
        raise ValueError(f"unknown embedding model {model!r} for provider {provider!r}") from exc


__all__ = ["EMBED_MODELS", "EMBED_MODEL_DIMS", "EmbedModelChoice", "dim_for_model"]
