"""Model providers — all local via Ollama, plus a CPU reranker."""

from sovereign_rag.providers.ollama import get_embeddings, get_llm
from sovereign_rag.providers.reranker import rerank

__all__ = ["get_embeddings", "get_llm", "rerank"]
