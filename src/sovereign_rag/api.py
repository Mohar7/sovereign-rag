"""FastAPI surface in front of the LangGraph QA orchestrator.

Endpoints:
- POST /documents/text   — index raw text (Docling/Crawl4AI not needed)
- POST /documents/file   — upload a PDF/DOCX, parse with Docling, index
- POST /documents/url    — crawl a URL with Crawl4AI, index
- POST /ingest/search    — web-search (SearXNG) + crawl top hits + index
- POST /ask              — run the QA graph; may return an HITL interrupt
                           (candidate URLs to approve for web fallback)
- POST /ask/resume       — resume an interrupted /ask with approved URLs
- GET  /health
- GET  /                 — banner

Architecture: the control plane is a LangGraph ``StateGraph`` with a
Postgres-backed checkpointer (``AsyncPostgresSaver``) — runs can pause
at human-approval steps and resume across requests. The data plane
(Milvus / Neo4j / Ollama / SearXNG / Docling / Crawl4AI) is direct
async calls because LangChain's wrappers don't expose what we need
(RRF hybrid, GraphRAG local search, contextual prefixing).
"""

from __future__ import annotations

import logging
import tempfile
import uuid
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager
from dataclasses import asdict
from pathlib import Path
from typing import Any, Literal

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from langgraph.checkpoint.postgres.aio import AsyncPostgresSaver
from langgraph.types import Command
from pydantic import BaseModel, Field

from sovereign_rag.agent import (
    INTERRUPT_REASON_APPROVE_URLS,
    build_graph,
    set_pipeline,
)
from sovereign_rag.api_extras import router as api_router
from sovereign_rag.config import get_settings
from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion import crawl_url, parse_file, search_and_crawl
from sovereign_rag.retrieval.pipeline import RAGPipeline

logger = logging.getLogger(__name__)


# ---------- lifespan ----------


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Open the Postgres checkpointer, build the pipeline + compiled graph.

    The ``async with`` keeps the Postgres connection pool alive for the
    lifetime of the server; on shutdown it closes cleanly.
    """
    logging.basicConfig(level=logging.INFO)
    s = get_settings()

    pipeline = RAGPipeline()
    set_pipeline(pipeline)

    async with AsyncPostgresSaver.from_conn_string(s.langgraph_pg_uri) as checkpointer:
        # Idempotent: creates checkpoint tables on first boot.
        await checkpointer.setup()
        app.state.graph = build_graph(checkpointer=checkpointer)
        logger.info("sovereign-rag pipeline + LangGraph ready")
        try:
            yield
        finally:
            await pipeline.aclose()
            set_pipeline(None)


app = FastAPI(
    title="sovereign-rag",
    description=(
        "Local-first GraphRAG orchestrated with LangGraph (Postgres checkpointer, "
        "HITL on web fallback). Milvus hybrid + Neo4j graph + bge-reranker-v2-m3."
    ),
    version="0.1.0",
    lifespan=lifespan,
)

# Allow the dev frontend on :5173 (and the Tailscale IPs of the same) to
# call /api/* without a Vite proxy round-trip.  In production the SPA is
# served from the same nginx that proxies the backend, so CORS is moot.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1|100\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+):\d+$",
    allow_methods=["*"],
    allow_headers=["*"],
)

# /api/* — real-data endpoints powering the frontend (corpus stats, health,
# settings, documents search, chunk neighbours, entities). See api_extras.py.
app.include_router(api_router)


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
    # If supplied, the run is associated with this thread (for resumes /
    # multi-turn). Otherwise a fresh UUID is minted per call.
    thread_id: str | None = None


class AskResumeRequest(BaseModel):
    thread_id: str
    approved_urls: list[str] = Field(default_factory=list)


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


class CandidateUrlModel(BaseModel):
    url: str
    title: str
    snippet: str


class AskInterrupt(BaseModel):
    reason: str
    candidate_urls: list[CandidateUrlModel]


class AskResponse(BaseModel):
    thread_id: str
    status: Literal["ok", "interrupted"]
    # Set when status == "ok":
    answer: str | None = None
    citations: list[CitationModel] = Field(default_factory=list)
    retrieved: int = 0
    used: int = 0
    fallback_used: bool = False
    # Set when status == "interrupted":
    interrupt: AskInterrupt | None = None


def _graph() -> Any:
    g = getattr(app.state, "graph", None)
    if g is None:
        raise HTTPException(503, "Graph not initialized")
    return g


def _pipe() -> RAGPipeline:
    """Direct pipeline access for non-graph endpoints (/documents/*)."""
    from sovereign_rag.agent import get_pipeline

    try:
        return get_pipeline()
    except RuntimeError as exc:
        raise HTTPException(503, "Pipeline not initialized") from exc


def _build_response(thread_id: str, state: dict[str, Any]) -> AskResponse:
    """Convert a compiled-graph result dict into the API response.

    The presence of an ``__interrupt__`` field on the result means the run
    paused inside a node; otherwise the final state carries the answer.
    """
    interrupt_payload = state.get("__interrupt__")
    if interrupt_payload:
        # LangGraph wraps interrupts in an Interrupt object; pull the value
        # from the first one (we only have a single interrupt node).
        first = (
            interrupt_payload[0]
            if isinstance(interrupt_payload, list | tuple)
            else interrupt_payload
        )
        value = getattr(first, "value", first)
        candidate_urls = value.get("candidate_urls", []) if isinstance(value, dict) else []
        return AskResponse(
            thread_id=thread_id,
            status="interrupted",
            interrupt=AskInterrupt(
                reason=str(value.get("reason", INTERRUPT_REASON_APPROVE_URLS))
                if isinstance(value, dict)
                else INTERRUPT_REASON_APPROVE_URLS,
                candidate_urls=[CandidateUrlModel(**c) for c in candidate_urls],
            ),
        )

    citations = state.get("citations") or []
    return AskResponse(
        thread_id=thread_id,
        status="ok",
        answer=state.get("answer"),
        citations=[CitationModel(**asdict(c)) for c in citations],
        retrieved=int(state.get("retrieved", 0)),
        used=int(state.get("used", 0)),
        fallback_used=bool(state.get("fallback_used", False)),
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
    """Run the QA graph. May return an HITL interrupt for web fallback."""
    thread_id = req.thread_id or str(uuid.uuid4())
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    initial = {"question": req.question, "doc_id": req.doc_id}

    try:
        state = await _graph().ainvoke(initial, config=config)
    except Exception as exc:
        logger.exception("graph invocation failed")
        raise HTTPException(500, f"Graph failed: {exc}") from exc

    return _build_response(thread_id, state)


@app.post("/ask/resume", response_model=AskResponse)
async def ask_resume(req: AskResumeRequest) -> AskResponse:
    """Resume an interrupted run with the user's approved URLs."""
    config: dict[str, Any] = {"configurable": {"thread_id": req.thread_id}}
    try:
        state = await _graph().ainvoke(
            Command(resume={"approved_urls": req.approved_urls}),
            config=config,
        )
    except Exception as exc:
        logger.exception("graph resume failed")
        raise HTTPException(500, f"Graph resume failed: {exc}") from exc

    return _build_response(req.thread_id, state)


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "healthy"}


@app.get("/")
async def root() -> dict[str, str]:
    return {"name": "sovereign-rag", "docs": "/docs", "version": "0.1.0"}
