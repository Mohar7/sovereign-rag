"""LLM and embeddings providers.

The LLM is served by Ollama — either a local daemon or Ollama Cloud
(`ollama_api_key` set → sent as a Bearer header). Embeddings come from either
local Ollama (bge-m3) or OpenAI, selected by `embed_provider`, because Ollama
Cloud does not expose an embeddings endpoint.

`get_llm` / `get_embeddings` are cached so we reuse one client across the
process. Both honor `config.Settings` so models are swappable via env.
"""

from __future__ import annotations

from functools import lru_cache

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama, OllamaEmbeddings
from pydantic import SecretStr

from sovereign_rag.config import get_settings


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    """Chat model served by Ollama (local daemon or Ollama Cloud)."""
    s = get_settings()
    client_kwargs = (
        {"headers": {"Authorization": f"Bearer {s.ollama_api_key}"}} if s.ollama_api_key else {}
    )
    return ChatOllama(
        model=s.llm_model,
        base_url=s.ollama_base_url,
        temperature=s.llm_temperature,
        num_ctx=s.llm_num_ctx,
        client_kwargs=client_kwargs,
    )


@lru_cache(maxsize=1)
def get_embeddings() -> Embeddings:
    """Dense embedder: OpenAI or local Ollama, per `embed_provider`."""
    s = get_settings()
    if s.embed_provider == "openai":
        from langchain_openai import OpenAIEmbeddings

        return OpenAIEmbeddings(
            model=s.openai_embed_model,
            dimensions=s.embed_dim,
            api_key=SecretStr(s.openai_api_key),
        )
    return OllamaEmbeddings(model=s.embed_model, base_url=s.ollama_base_url)


async def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Thin async wrapper used by the indexer."""
    return await get_embeddings().aembed_documents(texts)


async def embed_query(text: str) -> list[float]:
    """Embed a single query."""
    return await get_embeddings().aembed_query(text)


__all__ = ["embed_query", "embed_texts", "get_embeddings", "get_llm"]
