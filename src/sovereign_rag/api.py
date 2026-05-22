"""FastAPI wrapper around the RAG pipeline.

Endpoints:
- POST /documents/file   — upload a PDF/DOCX, parse with Docling, index
- POST /documents/url    — crawl a URL with Crawl4AI, index
- POST /documents/text   — index raw text
- POST /ingest/search    — web-search (SearXNG) + crawl top hits + index
- POST /ask              — retrieve (hybrid + graph) → rerank → cited answer
- GET  /health

The pipeline (Milvus + Neo4j clients) is built once in the lifespan and
reused. Ollama, Milvus, Neo4j, SearXNG are all expected to be reachable
per `config.Settings` — bring them up with `docker compose up` + a host
`ollama serve`. None of this requires a paid API key.
"""

from __future__ import annotations

import logging
import tempfile
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel, Field

from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion import crawl_url, parse_file, search_and_crawl
from sovereign_rag.retrieval.pipeline import AnswerResult, RAGPipeline

logger = logging.getLogger(__name__)

_pipeline: RAGPipeline | None = None


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    global _pipeline
    logging.basicConfig(level=logging.INFO)
    _pipeline = RAGPipeline()
    logger.info("sovereign-rag pipeline ready")
    try:
        yield
    finally:
        if _pipeline is not None:
            await _pipeline.aclose()


app = FastAPI(
    title="sovereign-rag",
    description="Self-hosted GraphRAG: Milvus hybrid + Neo4j graph + rerank, all on Ollama.",
    version="0.1.0",
    lifespan=lifespan,
)


def _pipe() -> RAGPipeline:
    if _pipeline is None:
        raise HTTPException(503, "Pipeline not initialized")
    return _pipeline


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


class AskRequest(BaseModel):
    question: str = Field(min_length=2, max_length=2000)
    doc_id: str | None = None


class IngestResponse(BaseModel):
    doc_id: str
    title: str
    chunks_indexed: int


class CitationModel(BaseModel):
    chunk_id: str
    doc_id: str
    title: str
    source_uri: str
    page: int | None
    score: float
    snippet: str


class AskResponse(BaseModel):
    answer: str
    citations: list[CitationModel]
    retrieved: int
    used: int


def _to_ask_response(result: AnswerResult) -> AskResponse:
    return AskResponse(
        answer=result.answer,
        citations=[CitationModel(**asdict(c)) for c in result.citations],
        retrieved=result.retrieved,
        used=result.used,
    )


# ---------- routes ----------


@app.post("/documents/text", response_model=IngestResponse)
async def ingest_text(req: TextDocRequest) -> IngestResponse:
    doc = SourceDocument(
        title=req.title,
        source_uri=req.source_uri,
        source_type=SourceType.TEXT,
        markdown=req.text,
    )
    n = await _pipe().index_document(doc)
    return IngestResponse(doc_id=doc.doc_id, title=doc.title, chunks_indexed=n)


@app.post("/documents/file", response_model=IngestResponse)
async def ingest_file(file: UploadFile = File(...)) -> IngestResponse:
    suffix = Path(file.filename or "upload").suffix or ".pdf"
    with tempfile.NamedTemporaryFile(delete=True, suffix=suffix) as tmp:
        tmp.write(await file.read())
        tmp.flush()
        try:
            doc = await parse_file(tmp.name)
        except Exception as exc:
            logger.exception("file parse failed")
            raise HTTPException(422, f"Could not parse file: {exc}") from exc
    n = await _pipe().index_document(doc)
    return IngestResponse(doc_id=doc.doc_id, title=doc.title, chunks_indexed=n)


@app.post("/documents/url", response_model=IngestResponse)
async def ingest_url(req: UrlRequest) -> IngestResponse:
    try:
        doc = await crawl_url(req.url)
    except Exception as exc:
        logger.exception("crawl failed")
        raise HTTPException(422, f"Could not crawl URL: {exc}") from exc
    n = await _pipe().index_document(doc)
    return IngestResponse(doc_id=doc.doc_id, title=doc.title, chunks_indexed=n)


@app.post("/ingest/search")
async def ingest_search(req: SearchIngestRequest) -> dict[str, Any]:
    docs = await search_and_crawl(req.query, max_results=req.max_results)
    pipe = _pipe()
    indexed = []
    for doc in docs:
        n = await pipe.index_document(doc)
        indexed.append({"doc_id": doc.doc_id, "title": doc.title, "chunks_indexed": n})
    return {"query": req.query, "documents": indexed}


@app.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest) -> AskResponse:
    result = await _pipe().answer(req.question, doc_id=req.doc_id)
    return _to_ask_response(result)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "sovereign-rag", "docs": "/docs", "version": "0.1.0"}
