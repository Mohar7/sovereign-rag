"""Shared data contracts.

Every layer speaks these three types:

- `SourceDocument` — a parsed source (PDF/web/search result) before chunking.
  Produced by `ingestion/*`, consumed by `chunking`.
- `Chunk` — an indexable unit. Produced by `chunking`, consumed by the
  Milvus store and the Neo4j graph builder.
- `RetrievedChunk` — a `Chunk` plus a score and provenance. Produced by
  retrievers (Milvus / graph / reranker), consumed by the QA pipeline
  and the eval harness.

Keeping these in one module means the parallel-built subsystems
(vectorstore, graph, ingestion, eval) never have to import each other —
they only depend on this contract.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any


class SourceType(StrEnum):
    PDF = "pdf"
    DOCX = "docx"
    WEB = "web"
    SEARCH = "search"
    TEXT = "text"


@dataclass(slots=True)
class SourceDocument:
    """A parsed document before chunking. `markdown` is the canonical text
    (Docling for files, Crawl4AI for web)."""

    title: str
    source_uri: str
    source_type: SourceType
    markdown: str
    doc_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class Chunk:
    """An indexable chunk.

    `text` is what gets embedded / BM25-indexed and may carry a contextual
    prefix (see `chunking.contextualize`). `raw_text` is the original chunk
    body without the prefix — that's what we show the user as a citation.
    """

    doc_id: str
    text: str
    raw_text: str
    position: int
    page: int | None = None
    chunk_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(slots=True)
class RetrievedChunk:
    """A chunk returned from retrieval, with score and provenance.

    `source` records which retriever produced it — useful for debugging
    fusion and for the eval harness to attribute precision to dense vs
    BM25 vs graph.
    """

    chunk: Chunk
    score: float
    source: str  # "milvus_dense" | "milvus_bm25" | "milvus_hybrid" | "graph" | "reranked"


__all__ = ["Chunk", "RetrievedChunk", "SourceDocument", "SourceType"]
