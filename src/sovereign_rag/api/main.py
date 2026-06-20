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
from psycopg import AsyncConnection
from psycopg.rows import DictRow, dict_row
from psycopg_pool import AsyncConnectionPool

from sovereign_rag.api.admin.router import router as admin_router
from sovereign_rag.api.ask.router import router as ask_router
from sovereign_rag.api.evals.router import router as evals_router
from sovereign_rag.api.graph.router import router as graph_router
from sovereign_rag.api.health.router import root_router as health_root_router
from sovereign_rag.api.health.router import router as health_router
from sovereign_rag.api.ingest.router import root_router as ingest_root_router
from sovereign_rag.api.ingest.router import router as ingest_router
from sovereign_rag.api.library.router import router as library_router
from sovereign_rag.api.reindex.router import router as reindex_router
from sovereign_rag.api.runs import ensure_runs_table
from sovereign_rag.api.runs.router import router as runs_router
from sovereign_rag.api.settings import ensure_settings_table, load_and_apply_overrides
from sovereign_rag.api.settings.router import router as settings_router
from sovereign_rag.api.sources.router import router as sources_router
from sovereign_rag.api.threads.router import router as threads_router
from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa import build_graph
from sovereign_rag.retrieval.pipeline import RAGPipeline
from sovereign_rag.shared.pg_pool import set_pg_pool
from sovereign_rag.shared.pipeline_deps import set_pipeline

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Open the Postgres checkpointer, build the pipeline + compiled graph."""
    logging.basicConfig(level=logging.INFO)
    s = get_settings()

    pipeline = RAGPipeline()
    set_pipeline(pipeline)

    # Back AsyncPostgresSaver with a connection POOL rather than a single
    # long-lived connection (the default `from_conn_string` path). A single
    # connection dies when Postgres drops the idle session — psycopg reports
    # "server closed the connection unexpectedly" and then "the connection is
    # closed" on every subsequent /ask, permanently, until the process
    # restarts. The pool validates each connection on checkout
    # (`check_connection`) and reconnects transparently, and is also safe under
    # concurrent requests. `prepare_threshold=0` keeps prepared statements off
    # so they don't leak across pooled connections / a pgbouncer.
    # AsyncPostgresSaver requires dict-row, autocommit connections; the pool's
    # `kwargs` configure every connection it hands out accordingly.
    async with AsyncConnectionPool[AsyncConnection[DictRow]](
        conninfo=s.langgraph_pg_uri,
        max_size=20,
        open=False,
        kwargs={"autocommit": True, "prepare_threshold": 0, "row_factory": dict_row},
        check=AsyncConnectionPool.check_connection,
    ) as pool:
        set_pg_pool(pool)  # share the pool with the runs/threads services
        checkpointer = AsyncPostgresSaver(pool)
        await checkpointer.setup()  # idempotent
        await ensure_runs_table()  # creates runs table + indexes
        await ensure_settings_table()  # creates settings_overrides table
        # Layer persisted settings on top of the env defaults so UI changes
        # survive restarts / auto-deploys (env defaults < persisted overrides).
        await load_and_apply_overrides()
        app.state.graph = build_graph(checkpointer=checkpointer)
        app.state.checkpointer = checkpointer  # exposed so /api/threads can list/read
        logger.info("sovereign-rag pipeline + LangGraph ready")
        try:
            yield
        finally:
            await pipeline.aclose()
            set_pipeline(None)
            set_pg_pool(None)


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
app.include_router(reindex_router)
app.include_router(library_router)
app.include_router(sources_router)
app.include_router(threads_router)
app.include_router(ingest_router)
app.include_router(graph_router)
app.include_router(runs_router)
app.include_router(evals_router)


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "sovereign-rag", "docs": "/docs", "version": "0.1.0"}
