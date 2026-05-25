"""Ingest routes — bring text / files / URLs / web hits into Milvus + Neo4j.

Two routers exposed because the original surface was split across two prefixes:

- ``root_router``: ``POST /documents/{text,file,url}``, ``POST /ingest/search``
- ``router`` (under ``/api``): ``POST /api/ingest`` (polymorphic), ``GET /api/search``
  (SearxNG proxy used by the WEB ingest sheet).
"""

from __future__ import annotations

import hashlib
import logging
import tempfile
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field

from sovereign_rag.api.dependencies import PipelineDep
from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion import crawl_url, parse_file, search_and_crawl
from sovereign_rag.ingestion import search as _web_search

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["ingest"])
root_router = APIRouter(tags=["ingest"])


# ---------- schemas ----------


class TextDocRequest(BaseModel):
    title: str = Field(min_length=1, max_length=300)
    text: str = Field(min_length=1)
    source_uri: str = "inline://text"


class UrlRequest(BaseModel):
    url: str = Field(min_length=4)


class SearchIngestRequest(BaseModel):
    query: str = Field(min_length=2)
    max_results: int = Field(default=3, ge=1, le=10)


class IngestRequest(BaseModel):
    """Polymorphic ingest body.

    ``type='url'`` crawls with Crawl4AI; ``type='text'`` indexes the paste
    as a synthetic source. ``title`` is optional — derived from the URL /
    first line if missing.
    """

    type: Literal["url", "text"]
    value: str = Field(min_length=1)
    title: str | None = None


class IngestResponse(BaseModel):
    doc_id: str
    title: str
    chunks_indexed: int
    source_uri: str | None = None


class WebSearchHit(BaseModel):
    url: str
    title: str
    snippet: str


# ---------- root-mounted (no /api prefix) ----------


@root_router.post("/documents/text", response_model=IngestResponse)
async def ingest_text(req: TextDocRequest, pipe: PipelineDep) -> IngestResponse:
    doc = SourceDocument(
        title=req.title,
        source_uri=req.source_uri,
        source_type=SourceType.TEXT,
        markdown=req.text,
    )
    n = await pipe.index_document(doc)
    return IngestResponse(
        doc_id=doc.doc_id, title=doc.title, chunks_indexed=n, source_uri=doc.source_uri
    )


@root_router.post("/documents/file", response_model=IngestResponse)
async def ingest_file(pipe: PipelineDep, file: UploadFile = File(...)) -> IngestResponse:
    suffix = Path(file.filename or "upload").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=True, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        try:
            doc = await parse_file(tmp.name)
        except Exception as exc:
            logger.exception("file parse failed")
            raise HTTPException(422, f"Could not parse file: {exc}") from exc
    n = await pipe.index_document(doc)
    return IngestResponse(
        doc_id=doc.doc_id, title=doc.title, chunks_indexed=n, source_uri=doc.source_uri
    )


@root_router.post("/documents/url", response_model=IngestResponse)
async def ingest_url(req: UrlRequest, pipe: PipelineDep) -> IngestResponse:
    try:
        doc = await crawl_url(req.url)
    except Exception as exc:
        logger.exception("crawl failed")
        raise HTTPException(422, f"Could not crawl URL: {exc}") from exc
    n = await pipe.index_document(doc)
    return IngestResponse(
        doc_id=doc.doc_id, title=doc.title, chunks_indexed=n, source_uri=doc.source_uri
    )


@root_router.post("/ingest/search")
async def ingest_search(req: SearchIngestRequest, pipe: PipelineDep) -> dict[str, Any]:
    docs = await search_and_crawl(req.query, max_results=req.max_results)
    indexed = []
    for doc in docs:
        n = await pipe.index_document(doc)
        indexed.append({"doc_id": doc.doc_id, "title": doc.title, "chunks_indexed": n})
    return {"query": req.query, "documents": indexed}


# ---------- /api ----------


@router.post("/ingest", response_model=IngestResponse)
async def api_ingest(body: IngestRequest, pipe: PipelineDep) -> IngestResponse:
    """Polymorphic URL-or-text ingest (used by the Ingest sheet)."""
    if body.type == "url":
        try:
            doc = await crawl_url(body.value)
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"crawl failed: {exc}") from exc
        if body.title:
            doc.title = body.title
    else:
        sha = hashlib.sha1(body.value.encode("utf-8"), usedforsecurity=False).hexdigest()[:8]
        title = body.title or body.value.splitlines()[0][:80]
        doc = SourceDocument(
            doc_id=f"text/{sha}",
            title=title,
            source_uri=f"text://{title}",
            source_type=SourceType.TEXT,
            markdown=body.value,
        )

    n = await pipe.index_document(doc)
    return IngestResponse(
        doc_id=doc.doc_id, title=doc.title, chunks_indexed=n, source_uri=doc.source_uri
    )


@router.get("/search", response_model=list[WebSearchHit])
async def web_search(
    q: str = Query(..., min_length=1, description="search query"),
    max_results: int = Query(8, ge=1, le=20),
) -> list[WebSearchHit]:
    """SearxNG proxy (ddgs fallback) — the WEB ingest sheet queries this."""
    hits = await _web_search(q, max_results=max_results)
    return [
        WebSearchHit(url=h["url"], title=h["title"], snippet=h.get("snippet", "")) for h in hits
    ]


__all__ = ["IngestResponse", "root_router", "router"]
