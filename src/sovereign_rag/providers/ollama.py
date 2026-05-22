"""Ollama-backed LLM and embeddings.

Everything routes through a local Ollama daemon — no OpenAI/Anthropic keys.
`get_llm` / `get_embeddings` are cached so we reuse one client across the
process. Both honor `config.Settings` so the model is swappable via env.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama, OllamaEmbeddings

from sovereign_rag.config import get_settings


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    """Chat model (qwen2.5:7b by default), served by local Ollama."""
    s = get_settings()
    return ChatOllama(
        model=s.llm_model,
        base_url=s.ollama_base_url,
        temperature=s.llm_temperature,
        num_ctx=s.llm_num_ctx,
    )


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    """Embedding model (bge-m3 by default, 1024-dim), served by local Ollama."""
    s = get_settings()
    return OllamaEmbeddings(model=s.embed_model, base_url=s.ollama_base_url)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Thin async wrapper used by the indexer."""
    return await get_embeddings().aembed_documents(texts)


async def embed_query(text: str) -> list[float]:
    """Embed a single query."""
    return await get_embeddings().aembed_query(text)


__all__ = ["embed_query", "embed_texts", "get_embeddings", "get_llm"]
