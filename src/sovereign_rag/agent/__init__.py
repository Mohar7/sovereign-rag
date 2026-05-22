"""LangGraph orchestration for the QA path.

The control plane (retrieve → maybe web-fallback (HITL) → rerank → generate)
is expressed as a ``StateGraph`` with conditional edges and a Postgres
checkpointer, so a run can be paused at the human-approval step and
resumed in a separate request.

The data plane (Milvus/Neo4j async clients, the cross-encoder reranker,
Docling/Crawl4AI/SearXNG ingestion) stays direct — those subsystems use
features LangChain's wrappers don't expose (RRF hybrid, GraphRAG local
search, contextual prefixing, etc.).
"""

from sovereign_rag.agent._deps import get_pipeline, set_pipeline
from sovereign_rag.agent.graph import build_graph, graph
from sovereign_rag.agent.state import INTERRUPT_REASON_APPROVE_URLS, RAGState

__all__ = [
    "INTERRUPT_REASON_APPROVE_URLS",
    "RAGState",
    "build_graph",
    "get_pipeline",
    "graph",
    "set_pipeline",
]
