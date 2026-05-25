"""LLM and embeddings providers.

The LLM accessor (``get_llm``) is a legacy entry-point that now delegates to
``shared.llm_factory.get_chat_model`` so it picks up the provider switch
(Ollama vs OpenAI). Embeddings come from either local Ollama (bge-m3) or
OpenAI, selected by ``embed_provider``, because Ollama Cloud does not expose
an embeddings endpoint.
"""

from __future__ import annotations

import logging
from functools import lru_cache

from langchain_core.embeddings import Embeddings
from langchain_core.language_models import BaseChatModel
from langchain_ollama import OllamaEmbeddings
from pydantic import SecretStr

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)


def get_llm() -> BaseChatModel:
    """Legacy chat-model accessor — delegates to ``shared.llm_factory.get_chat_model``.

    The factory branches on ``Settings.llm_provider`` (``ollama`` | ``openai``),
    so flipping the env switch swaps every existing caller in one shot:
    ``chunking.contextualize``, ``graph.neo4j_store`` entity extraction,
    ``retrieval.pipeline.answer``, and ``eval/ragas_eval``.

    Tracing is wired at the graph level via OTEL + the OpenInference
    LangChain instrumentor (see ``shared/tracing.py``), not on the model —
    keeps the cache effective and avoids the async-context bug in
    ``langfuse.langchain.CallbackHandler``.
    """
    from sovereign_rag.shared.llm_factory import get_chat_model

    return get_chat_model(model_tier="default")


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
