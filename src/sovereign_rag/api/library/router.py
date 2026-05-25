"""Library endpoints — search documents + list chunks + delete per document."""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sovereign_rag.api.dependencies import PipelineDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["library"])


class DocumentSummary(BaseModel):
    doc_id: str
    title: str
    source_uri: str
    chunks: int


class ChunkRow(BaseModel):
    chunk_id: str
    doc_id: str
    position: int
    page: int | None
    raw_text: str


class DeleteRequest(BaseModel):
    """Body for the bulk DELETE endpoint."""

    doc_ids: list[str] = Field(min_length=1, max_length=500)


class DeleteResult(BaseModel):
    doc_id: str
    chunks_deleted: int
    graph_deleted: bool
    error: str | None = None


class DeleteResponse(BaseModel):
    ok: bool
    total_chunks_deleted: int
    results: list[DeleteResult]


@router.get("/documents/search", response_model=list[DocumentSummary])
async def documents_search(
    pipe: PipelineDep,
    q: str = Query("", description="title-substring filter"),
    limit: int = Query(20, ge=1, le=500),
) -> list[DocumentSummary]:
    """List indexed documents (one row per unique doc_id), filtered by title."""
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


@router.get("/library/{doc_id}/chunks", response_model=list[ChunkRow])
async def document_chunks(
    doc_id: str,
    pipe: PipelineDep,
    limit: int = Query(500, ge=1, le=2000),
) -> list[ChunkRow]:
    """Return every chunk for one document, ordered by position.

    Powers the Chunks tab in the Source Detail drawer. Reads from Neo4j (we
    already store ``:Chunk`` nodes there for graph-side retrieval); falls
    back to an empty list when graph retrieval is off and we never built
    the Chunk side of the graph.
    """
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        raise HTTPException(503, "Graph store unavailable")
    driver = graph._driver
    db = graph._database
    records, _, _ = await driver.execute_query(
        """
        MATCH (c:Chunk {doc_id: $doc})
        RETURN c.chunk_id AS chunk_id,
               c.position AS position,
               c.page AS page,
               c.raw_text AS raw_text
        ORDER BY c.position ASC
        LIMIT $limit
        """,
        doc=doc_id,
        limit=limit,
        database_=db,
    )
    return [
        ChunkRow(
            chunk_id=r["chunk_id"],
            doc_id=doc_id,
            position=int(r["position"] or 0),
            page=r["page"],
            raw_text=r["raw_text"] or "",
        )
        for r in records
    ]


@router.delete("/library/{doc_id}", response_model=DeleteResult)
async def document_delete(doc_id: str, pipe: PipelineDep) -> DeleteResult:
    """Delete a single document from Milvus + Neo4j."""
    try:
        report = await pipe.delete_document(doc_id)
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("delete_document failed")
        raise HTTPException(500, f"delete failed: {exc}") from exc
    return DeleteResult(
        doc_id=doc_id,
        chunks_deleted=int(report.get("chunks_deleted", 0)),
        graph_deleted=bool(report.get("graph_deleted", 0)),
    )


@router.post("/library/delete", response_model=DeleteResponse)
async def documents_delete_bulk(
    body: DeleteRequest,
    pipe: PipelineDep,
) -> DeleteResponse:
    """Delete N documents in one round-trip.

    POST rather than DELETE so we can carry a JSON body — FastAPI / starlette
    accept request bodies on DELETE but many proxies and clients strip them.
    Errors on individual docs are captured per-row; the response is always
    200 unless every delete failed.
    """
    results: list[DeleteResult] = []
    total = 0
    failures = 0
    # Deduplicate but preserve order to keep the UI's "this one is processing"
    # animation in a predictable order.
    seen: set[str] = set()
    for raw_id in body.doc_ids:
        doc_id = raw_id.strip()
        if not doc_id or doc_id in seen:
            continue
        seen.add(doc_id)
        try:
            report = await pipe.delete_document(doc_id)
            chunks = int(report.get("chunks_deleted", 0))
            results.append(
                DeleteResult(
                    doc_id=doc_id,
                    chunks_deleted=chunks,
                    graph_deleted=bool(report.get("graph_deleted", 0)),
                ),
            )
            total += chunks
        except Exception as exc:  # pragma: no cover — defensive
            logger.warning("bulk delete failed for %s: %s", doc_id, exc)
            failures += 1
            results.append(
                DeleteResult(
                    doc_id=doc_id,
                    chunks_deleted=0,
                    graph_deleted=False,
                    error=str(exc),
                ),
            )
    if failures == len(results) and failures > 0:
        raise HTTPException(500, "All deletes failed.")
    return DeleteResponse(ok=failures == 0, total_chunks_deleted=total, results=results)


__all__ = ["router"]
