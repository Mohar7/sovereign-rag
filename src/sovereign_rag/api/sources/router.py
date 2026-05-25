"""Source-detail endpoints powering the chunk drawer + entity chips.

- ``GET /api/chunks/{chunk_id}/neighbours`` — prev/next sibling chunks
- ``GET /api/entities`` — entities + relations mentioned in a doc
"""

from __future__ import annotations

from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from sovereign_rag.api.dependencies import PipelineDep

router = APIRouter(prefix="/api", tags=["sources"])


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


@router.get("/chunks/{chunk_id}/neighbours", response_model=NeighbourResponse)
async def chunk_neighbours(chunk_id: str, pipe: PipelineDep) -> NeighbourResponse:
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

    c = row["c"]
    return NeighbourResponse(
        chunk=_to(c) or ChunkSummary(chunk_id="", doc_id="", position=0, page=None, raw_text=""),
        prev=_to(row["p"]),
        next=_to(row["n"]),
    )


@router.get("/entities", response_model=EntitiesResponse)
async def entities(
    pipe: PipelineDep,
    doc_id: str = Query(...),
    limit: int = Query(40, ge=1, le=200),
) -> EntitiesResponse:
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
