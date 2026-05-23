"""LLM and embeddings providers.

The LLM is served by Ollama — either a local daemon or Ollama Cloud
(`ollama_api_key` set → sent as a Bearer header). Embeddings come from either
local Ollama (bge-m3) or OpenAI, selected by `embed_provider`, because Ollama
Cloud does not expose an embeddings endpoint.

`get_llm` / `get_embeddings` are cached so we reuse one client across the
process. Both honor `config.Settings` so models are swappable via env.
"""

from __future__ import annotations

import logging
from functools import lru_cache
from typing import Any

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama, OllamaEmbeddings
from pydantic import SecretStr

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)


@lru_cache(maxsize=1)
def _langfuse_callback() -> Any | None:
    """Build the Langfuse Langchain CallbackHandler if env says so.

    Returns None when ``enable_langfuse`` is off or the package / creds are
    missing — callers can then add `[handler]` only when truthy. We cache
    the handler so every LLM call shares the same Langfuse session
    instead of opening a new HTTP client per invocation.
    """
    s = get_settings()
    if not s.enable_langfuse:
        return None
    if not (s.langfuse_public_key and s.langfuse_secret_key):
        logger.info("langfuse disabled: missing public/secret key")
        return None
    try:
        from langfuse import Langfuse
        from langfuse.langchain import CallbackHandler
    except Exception as exc:  # pragma: no cover
        logger.warning("langfuse import failed: %s — tracing disabled", exc)
        return None
    try:
        # Initialise the global Langfuse client so any direct trace
        # writes (eval, custom spans) hit the same project.
        Langfuse(
            public_key=s.langfuse_public_key,
            secret_key=s.langfuse_secret_key,
            host=s.langfuse_base_url,
        )
        return CallbackHandler()
    except Exception as exc:  # pragma: no cover
        logger.warning("langfuse init failed: %s — tracing disabled", exc)
        return None


@lru_cache(maxsize=1)
def get_llm() -> BaseChatModel:
    """Chat model served by Ollama (local daemon or Ollama Cloud).

    Attaches the Langfuse Langchain callback at construction so every
    chat call is automatically traced when ``enable_langfuse`` is on.
    LangSmith traces are independent — picked up from LANGSMITH_*
    env vars by langchain-core globally.
    """
    s = get_settings()
    client_kwargs = (
        {"headers": {"Authorization": f"Bearer {s.ollama_api_key}"}} if s.ollama_api_key else {}
    )
    callbacks: list[Any] = []
    lf = _langfuse_callback()
    if lf is not None:
        callbacks.append(lf)
    kwargs: dict[str, Any] = {
        "model": s.llm_model,
        "base_url": s.ollama_base_url,
        "temperature": s.llm_temperature,
        "num_ctx": s.llm_num_ctx,
        "client_kwargs": client_kwargs,
    }
    if callbacks:
        kwargs["callbacks"] = callbacks
    return ChatOllama(**kwargs)


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
