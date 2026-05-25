"""FastAPI app construction + LangGraph lifespan.

Architecture: the control plane is a LangGraph ``StateGraph`` with a
Postgres-backed checkpointer (``AsyncPostgresSaver``) so QA threads
persist across restarts. The data plane (Milvus / Neo4j / Ollama /
SearXNG / Docling / Crawl4AI) is direct async calls — LangChain's
wrappers don't expose what we need (RRF hybrid, GraphRAG local-search,
contextual prefixing).

Endpoint surface is organized into domain routers under ``api/<domain>/``;
this module is intentionally thin — it only does app construction, CORS,
lifespan, and router wiring.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver

from sovereign_rag.api.admin.router import router as admin_router
from sovereign_rag.api.ask.router import router as ask_router
from sovereign_rag.api.graph.router import router as graph_router
from sovereign_rag.api.health.router import root_router as health_root_router
from sovereign_rag.api.health.router import router as health_router
from sovereign_rag.api.ingest.router import root_router as ingest_root_router
from sovereign_rag.api.ingest.router import router as ingest_router
from sovereign_rag.api.library.router import router as library_router
from sovereign_rag.api.settings.router import router as settings_router
from sovereign_rag.api.sources.router import router as sources_router
from sovereign_rag.api.threads.router import router as threads_router
from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa import build_graph
from sovereign_rag.retrieval.pipeline import RAGPipeline
from sovereign_rag.shared.pipeline_deps import set_pipeline

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Open the Postgres checkpointer, build the pipeline + compiled graph."""
    logging.basicConfig(level=logging.INFO)
    s = get_settings()

    pipeline = RAGPipeline()
    set_pipeline(pipeline)

    async with AsyncPostgresSaver.from_conn_string(s.langgraph_pg_uri) as checkpointer:
        await checkpointer.setup()  # idempotent
        app.state.graph = build_graph(checkpointer=checkpointer)
        app.state.checkpointer = checkpointer  # exposed so /api/threads can list/read
        logger.info("sovereign-rag pipeline + LangGraph ready")
        try:
            yield
        finally:
            await pipeline.aclose()
            set_pipeline(None)


app = FastAPI(
    title="sovereign-rag",
    description=(
        "Local-first GraphRAG orchestrated with LangGraph (Postgres checkpointer). "
        "Milvus hybrid + Neo4j graph + cross-encoder rerank."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Dev frontend on :5173 (and Tailscale IPs of the same) calls /api/* directly;
# in production the SPA is served from the same nginx that proxies the backend.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+):\d+$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Root-mounted (no /api prefix) — kept for backwards compat with the original
# endpoint surface and the langgraph entry-point smoke tests.
app.include_router(health_root_router)
app.include_router(ask_router)
app.include_router(ingest_root_router)
app.include_router(admin_router)

# /api/* — the frontend's primary contract.
app.include_router(health_router)
app.include_router(settings_router)
app.include_router(library_router)
app.include_router(sources_router)
app.include_router(threads_router)
app.include_router(ingest_router)
app.include_router(graph_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "sovereign-rag", "docs": "/docs", "version": "0.1.0"}
