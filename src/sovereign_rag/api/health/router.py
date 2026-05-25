"""Health & corpus-stats routes.

Two routers:

- ``root_router`` mounts ``GET /health`` at the app root for liveness probes.
- ``router`` mounts ``GET /api/health`` (detailed per-service status) and
  ``GET /api/corpus/stats`` (counts derived from Milvus + Neo4j).
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from sovereign_rag.api.dependencies import PipelineDep
from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["health"])
root_router = APIRouter(tags=["health"])


# ---------- schemas ----------


class CorpusStats(BaseModel):
    documents: int
    chunks: int
    entities: int
    relations: int
    last_indexed: str | None = None


class ServiceStatus(BaseModel):
    name: str
    state: Literal["ok", "warn", "err"]
    latency_ms: float | None = None
    endpoint: str | None = None
    note: str | None = None


class HealthResponse(BaseModel):
    services: list[ServiceStatus]


# ---------- helpers ----------


async def _milvus_count(pipe: Any) -> int:
    """Count chunks in the collection. Returns 0 if no collection yet."""
    try:
        milvus = pipe._milvus
        client = milvus._client
        s = get_settings()
        collections = await client.list_collections()
        if s.milvus_collection not in collections:
            return 0
        rows = await client.query(s.milvus_collection, filter="", output_fields=["count(*)"])
        return int(rows[0]["count(*)"]) if rows else 0
    except Exception as exc:
        logger.warning("milvus count failed: %s", exc)
        return 0


async def _neo4j_counts(pipe: Any) -> tuple[int, int, int, str | None]:
    """Return (docs, entities, relations, last_indexed_iso)."""
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        return 0, 0, 0, None
    try:
        driver = graph._driver
        db = graph._database
        records, _, _ = await driver.execute_query(
            "MATCH (c:Chunk) RETURN count(DISTINCT c.doc_id) AS docs", database_=db
        )
        docs = int(records[0]["docs"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH (e:Entity) RETURN count(e) AS entities", database_=db
        )
        entities = int(records[0]["entities"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH ()-[r:RELATED]->() RETURN count(r) AS relations", database_=db
        )
        relations = int(records[0]["relations"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH (c:Chunk) RETURN max(c.indexed_at) AS last", database_=db
        )
        last = records[0]["last"] if records and records[0]["last"] is not None else None
        return docs, entities, relations, last
    except Exception as exc:
        logger.warning("neo4j counts failed: %s", exc)
        return 0, 0, 0, None


async def _probe(name: str, fn: Any, endpoint: str | None = None) -> ServiceStatus:
    """Time an async health probe; pin the result with ok/warn/err + latency."""
    start = time.perf_counter()
    try:
        await fn()
        ms = (time.perf_counter() - start) * 1000
        state: Literal["ok", "warn", "err"] = "ok" if ms < 2000 else "warn"
        return ServiceStatus(name=name, state=state, latency_ms=round(ms, 1), endpoint=endpoint)
    except Exception as exc:
        ms = (time.perf_counter() - start) * 1000
        return ServiceStatus(
            name=name,
            state="err",
            latency_ms=round(ms, 1),
            endpoint=endpoint,
            note=type(exc).__name__,
        )


# ---------- routes ----------


@root_router.get("/health")
async def health_root() -> dict[str, str]:
    """Simple liveness probe — for container healthchecks and CI."""
    return {"status": "healthy"}


@router.get("/corpus/stats", response_model=CorpusStats)
async def corpus_stats(pipe: PipelineDep) -> CorpusStats:
    """Counts derived from Milvus (chunks) + Neo4j (docs/entities/relations)."""
    milvus_count_task = asyncio.create_task(_milvus_count(pipe))
    neo_task = asyncio.create_task(_neo4j_counts(pipe))
    chunks = await milvus_count_task
    docs, entities, relations, last = await neo_task
    return CorpusStats(
        documents=docs,
        chunks=chunks,
        entities=entities,
        relations=relations,
        last_indexed=last,
    )


@router.get("/health", response_model=HealthResponse)
async def health_detailed() -> HealthResponse:
    """Per-service health + p50 latency for the topbar status pill."""
    s = get_settings()
    timeout = httpx.Timeout(3.0)

    async def probe_milvus() -> None:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(s.milvus_uri.replace(":19530", ":9091") + "/healthz")
            r.raise_for_status()

    async def probe_neo4j() -> None:
        async with httpx.AsyncClient(timeout=timeout) as c:
            host = s.neo4j_uri.replace("neo4j://", "").replace("bolt://", "").split(":")[0]
            r = await c.get(f"http://{host}:7474")
            r.raise_for_status()

    async def probe_postgres() -> None:
        import psycopg

        async with await psycopg.AsyncConnection.connect(s.langgraph_pg_uri) as conn:
            await conn.execute("SELECT 1")

    async def probe_searxng() -> None:
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(f"{s.searxng_url}/healthz")
            r.raise_for_status()

    async def probe_ollama() -> None:
        async with httpx.AsyncClient(timeout=timeout) as c:
            headers = {"Authorization": f"Bearer {s.ollama_api_key}"} if s.ollama_api_key else {}
            r = await c.get(f"{s.ollama_base_url}/api/tags", headers=headers)
            r.raise_for_status()

    async def probe_openai() -> None:
        if s.embed_provider != "openai" or not s.openai_api_key:
            return
        async with httpx.AsyncClient(timeout=timeout) as c:
            r = await c.get(
                "https://api.openai.com/v1/models",
                headers={"Authorization": f"Bearer {s.openai_api_key}"},
            )
            r.raise_for_status()

    statuses = await asyncio.gather(
        _probe("milvus", probe_milvus, s.milvus_uri),
        _probe("neo4j", probe_neo4j, s.neo4j_uri),
        _probe("postgres", probe_postgres, s.langgraph_pg_uri),
        _probe("searxng", probe_searxng, s.searxng_url),
        _probe("ollama", probe_ollama, s.ollama_base_url),
        _probe("openai", probe_openai, "https://api.openai.com"),
    )
    return HealthResponse(services=list(statuses))


__all__ = ["root_router", "router"]
