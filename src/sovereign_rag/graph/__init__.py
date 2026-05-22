"""Neo4j knowledge-graph subsystem.

Implements the GraphRAG "local search" pattern on top of Neo4j Community:
vector-find seed chunks → traverse the entity graph 1-2 hops → assemble a
context block. Entity/relationship extraction uses the local Ollama LLM via
LangChain structured output (no ``langchain-experimental`` dependency).
"""

from __future__ import annotations

from sovereign_rag.graph.neo4j_store import (
    ExtractedEntity,
    ExtractedRelation,
    Extraction,
    Neo4jGraphStore,
)

__all__ = [
    "ExtractedEntity",
    "ExtractedRelation",
    "Extraction",
    "Neo4jGraphStore",
]
