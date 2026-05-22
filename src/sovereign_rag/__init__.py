"""sovereign-rag — fully self-hosted GraphRAG powered by Ollama.

Public surface is intentionally small; see `documents` for the data
contracts shared across ingestion, vector store, graph, and retrieval.
"""

from sovereign_rag.documents import Chunk, RetrievedChunk, SourceDocument

__all__ = ["Chunk", "RetrievedChunk", "SourceDocument"]
