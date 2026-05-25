"""Indexer graph — ingest a parsed document into Milvus + Neo4j.

Entry point: ``make_graph`` (async factory, registered in ``langgraph.json``).
"""

from sovereign_rag.graphs.indexer.graph import make_graph
from sovereign_rag.graphs.indexer.state import IndexerState

__all__ = ["IndexerState", "make_graph"]
