"""Real-data endpoints under /api/*.

The frontend's TopBar, Empty state, ThreadHead, SettingsPanel, Inspector,
SourceDetail and CommandPalette were populated with hardcoded mock values
until these routes existed. Wiring them so every visible number / pill /
list reflects what's actually in the running stack — not a guess made at
build time.

Six GETs + one PATCH:

  GET   /api/corpus/stats         counts derived from Milvus + Neo4j
  GET   /api/health               per-service liveness + p50 latency
  GET   /api/settings             current retrieval knobs (config snapshot)
  PATCH /api/settings             override knobs in the process for this session
  GET   /api/documents/search     title-substring search over the Milvus collection
  GET   /api/chunks/{id}/neighbours  prev/next sibling chunks in the same document
  GET   /api/entities             entities mentioned in a given document

The router is mounted onto the existing FastAPI app from api.py; this file
intentionally avoids importing from api.py to keep the import graph DAG-like.
"""

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any, Literal

import httpx
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sovereign_rag.agent import get_pipeline
from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["api"])


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


class SettingsResponse(BaseModel):
    llm_model: str
    embed_provider: str
    embed_model: str
    embed_dim: int
    retrieve_top_k: int
    rerank_top_k: int
    rrf_k: int
    enable_graph_retrieval: bool
    enable_contextual_retrieval: bool
    dense_enabled: bool
    sparse_enabled: bool
    fusion_strategy: str
    fusion_graph_weight: float
    fusion_vector_weight: float
    graph_depth: int
    graph_max_nodes: int
    rerank_score_floor: float
    adaptive_rerank: bool
    reranker_model: str
    reranker_device: str
    web_fallback_min_chunks: int
    web_fallback_max_urls: int


class SettingsPatch(BaseModel):
    retrieve_top_k: int | None = Field(default=None, ge=1, le=500)
    rerank_top_k: int | None = Field(default=None, ge=1, le=50)
    rrf_k: int | None = Field(default=None, ge=1, le=500)
    enable_graph_retrieval: bool | None = None
    enable_contextual_retrieval: bool | None = None
    dense_enabled: bool | None = None
    sparse_enabled: bool | None = None
    fusion_strategy: str | None = Field(default=None, pattern="^(rrf|weighted|borda)$")
    fusion_graph_weight: float | None = Field(default=None, ge=0.0, le=1.0)
    fusion_vector_weight: float | None = Field(default=None, ge=0.0, le=1.0)
    graph_depth: int | None = Field(default=None, ge=1, le=5)
    graph_max_nodes: int | None = Field(default=None, ge=10, le=500)
    rerank_score_floor: float | None = Field(default=None, ge=0.0, le=1.0)
    adaptive_rerank: bool | None = None
    web_fallback_min_chunks: int | None = Field(default=None, ge=0, le=50)
    web_fallback_max_urls: int | None = Field(default=None, ge=1, le=20)
    reranker_device: str | None = Field(default=None, pattern="^(auto|mps|cuda|cpu)$")


class DocumentSummary(BaseModel):
    doc_id: str
    title: str
    source_uri: str
    chunks: int


class ChunkSummary(BaseModel):
    chunk_id: str
    doc_id: str
    position: int
    page: int | None
    raw_text: str


class NeighbourResponse(BaseModel):
    chunk: ChunkSummary
    prev: ChunkSummary | None = None
    next: ChunkSummary | None = None


class EntityItem(BaseModel):
    name: str
    type: str
    description: str | None = None


class EntitiesResponse(BaseModel):
    entities: list[EntityItem]
    relations: list[tuple[str, str, str]]


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
        # Milvus rejects count(*) when paired with a limit — drop it.
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
            "MATCH (c:Chunk) RETURN count(DISTINCT c.doc_id) AS docs",
            database_=db,
        )
        docs = int(records[0]["docs"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH (e:Entity) RETURN count(e) AS entities",
            database_=db,
        )
        entities = int(records[0]["entities"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH ()-[r:RELATED]->() RETURN count(r) AS relations",
            database_=db,
        )
        relations = int(records[0]["relations"]) if records else 0
        records, _, _ = await driver.execute_query(
            "MATCH (c:Chunk) RETURN max(c.indexed_at) AS last",
            database_=db,
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


# ---------- corpus stats ----------


@router.get("/corpus/stats", response_model=CorpusStats)
async def corpus_stats() -> CorpusStats:
    pipe = get_pipeline()
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


# ---------- health ----------


@router.get("/health", response_model=HealthResponse)
async def health_detailed() -> HealthResponse:
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
        # psycopg async ping — open + close.
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
        _probe("postgres", probe_postgres, "postgres"),
        _probe("searxng", probe_searxng, s.searxng_url),
        _probe("ollama", probe_ollama, s.ollama_base_url),
        _probe("openai", probe_openai, "https://api.openai.com"),
    )
    return HealthResponse(services=list(statuses))


# ---------- settings ----------


def _settings_snapshot() -> SettingsResponse:
    s = get_settings()
    return SettingsResponse(
        llm_model=s.llm_model,
        embed_provider=s.embed_provider,
        embed_model=s.embed_model,
        embed_dim=s.embed_dim,
        retrieve_top_k=s.retrieve_top_k,
        rerank_top_k=s.rerank_top_k,
        rrf_k=s.rrf_k,
        enable_graph_retrieval=s.enable_graph_retrieval,
        enable_contextual_retrieval=s.enable_contextual_retrieval,
        dense_enabled=s.dense_enabled,
        sparse_enabled=s.sparse_enabled,
        fusion_strategy=s.fusion_strategy,
        fusion_graph_weight=s.fusion_graph_weight,
        fusion_vector_weight=s.fusion_vector_weight,
        graph_depth=s.graph_depth,
        graph_max_nodes=s.graph_max_nodes,
        rerank_score_floor=s.rerank_score_floor,
        adaptive_rerank=s.adaptive_rerank,
        reranker_model=s.reranker_model,
        reranker_device=s.reranker_device,
        web_fallback_min_chunks=s.web_fallback_min_chunks,
        web_fallback_max_urls=s.web_fallback_max_urls,
    )


@router.get("/settings", response_model=SettingsResponse)
async def settings_get() -> SettingsResponse:
    return _settings_snapshot()


@router.patch("/settings", response_model=SettingsResponse)
async def settings_patch(patch: SettingsPatch) -> SettingsResponse:
    # The Settings singleton is `lru_cache`d — mutate the cached instance
    # in-place so the next pipeline call sees the new values without a
    # process restart. Persistence (across restarts) is a follow-up:
    # store the override in Postgres + apply at boot.
    s = get_settings()
    for field, value in patch.model_dump(exclude_none=True).items():
        if hasattr(s, field):
            setattr(s, field, value)
    return _settings_snapshot()


# ---------- documents search ----------


@router.get("/documents/search", response_model=list[DocumentSummary])
async def documents_search(
    q: str = Query("", description="title-substring filter"),
    limit: int = Query(20, ge=1, le=100),
) -> list[DocumentSummary]:
    """List indexed documents (one row per unique doc_id), filtered by title."""
    pipe = get_pipeline()
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        return []
    driver = graph._driver
    db = graph._database
    where = "WHERE toLower(coalesce(c.title, '')) CONTAINS toLower($q)" if q else ""
    records, _, _ = await driver.execute_query(
        f"""
        MATCH (c:Chunk)
        {where}
        WITH c.doc_id AS doc_id,
             head(collect(c.title)) AS title,
             head(collect(c.source_uri)) AS source_uri,
             count(c) AS chunks
        RETURN doc_id, title, source_uri, chunks
        ORDER BY chunks DESC
        LIMIT $limit
        """,
        q=q,
        limit=limit,
        database_=db,
    )
    return [
        DocumentSummary(
            doc_id=r["doc_id"],
            title=r["title"] or "untitled",
            source_uri=r["source_uri"] or "",
            chunks=int(r["chunks"]),
        )
        for r in records
    ]


# ---------- chunk neighbours ----------


@router.get("/chunks/{chunk_id}/neighbours", response_model=NeighbourResponse)
async def chunk_neighbours(chunk_id: str) -> NeighbourResponse:
    pipe = get_pipeline()
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        raise HTTPException(503, "Graph store unavailable")
    driver = graph._driver
    db = graph._database
    records, _, _ = await driver.execute_query(
        """
        MATCH (c:Chunk {chunk_id: $cid})
        OPTIONAL MATCH (p:Chunk {doc_id: c.doc_id})
          WHERE p.position = c.position - 1
        OPTIONAL MATCH (n:Chunk {doc_id: c.doc_id})
          WHERE n.position = c.position + 1
        RETURN c, p, n
        """,
        cid=chunk_id,
        database_=db,
    )
    if not records:
        raise HTTPException(404, f"Chunk {chunk_id} not found")
    row = records[0]
    c = row["c"]

    def _to(rec: Any) -> ChunkSummary | None:
        if rec is None:
            return None
        return ChunkSummary(
            chunk_id=rec.get("chunk_id"),
            doc_id=rec.get("doc_id"),
            position=int(rec.get("position", 0) or 0),
            page=rec.get("page"),
            raw_text=rec.get("raw_text") or "",
        )

    return NeighbourResponse(
        chunk=_to(c) or ChunkSummary(chunk_id="", doc_id="", position=0, page=None, raw_text=""),
        prev=_to(row["p"]),
        next=_to(row["n"]),
    )


# ---------- entities ----------


@router.get("/entities", response_model=EntitiesResponse)
async def entities(
    doc_id: str = Query(...), limit: int = Query(40, ge=1, le=200)
) -> EntitiesResponse:
    pipe = get_pipeline()
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        return EntitiesResponse(entities=[], relations=[])
    driver = graph._driver
    db = graph._database

    ent_records, _, _ = await driver.execute_query(
        """
        MATCH (c:Chunk {doc_id: $doc})-[:MENTIONS]->(e:Entity)
        RETURN DISTINCT e.name AS name, e.type AS type, e.description AS description
        LIMIT $limit
        """,
        doc=doc_id,
        limit=limit,
        database_=db,
    )
    ents = [
        EntityItem(name=r["name"], type=r["type"] or "unknown", description=r["description"])
        for r in ent_records
    ]
    rel_records, _, _ = await driver.execute_query(
        """
        MATCH (c:Chunk {doc_id: $doc})-[:MENTIONS]->(s:Entity)-[r:RELATED]->(o:Entity)
        RETURN DISTINCT s.name AS s, r.type AS p, o.name AS o
        LIMIT $limit
        """,
        doc=doc_id,
        limit=limit,
        database_=db,
    )
    rels = [(r["s"], r["p"] or "related to", r["o"]) for r in rel_records]
    return EntitiesResponse(entities=ents, relations=rels)


__all__ = ["router"]
