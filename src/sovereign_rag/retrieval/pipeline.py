"""The RAG pipeline — ties every subsystem together.

Indexing path:
    SourceDocument → chunk_document → (contextualize) → Milvus + Neo4j

Query path:
    query → [Milvus hybrid (dense+BM25, RRF)] + [Neo4j graph local-search]
          → dedup by chunk_id → cross-encoder rerank → top-k
          → assemble cited context → Ollama LLM → AnswerResult

The two retrievers run concurrently. Graph retrieval is optional
(`enable_graph_retrieval`); contextual prefixing is optional
(`enable_contextual_retrieval`). Both default on.
"""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass, field

from langchain_core.messages import HumanMessage, SystemMessage

from sovereign_rag.chunking import chunk_document, contextualize
from sovereign_rag.config import Settings, get_settings
from sovereign_rag.documents import RetrievedChunk, SourceDocument
from sovereign_rag.graph.neo4j_store import Neo4jGraphStore
from sovereign_rag.providers.ollama import get_llm
from sovereign_rag.providers.reranker import rerank
from sovereign_rag.vectorstore.milvus_store import MilvusHybridStore

logger = logging.getLogger(__name__)

# Sentinel so callers can pass graph=None to explicitly disable graph
# retrieval, distinct from "not provided" (which auto-constructs per config).
_UNSET: object = object()


@dataclass(slots=True)
class Citation:
    """A source citation backing an answer."""

    chunk_id: str
    doc_id: str
    title: str
    source_uri: str
    page: int | None
    score: float
    snippet: str


@dataclass(slots=True)
class AnswerResult:
    answer: str
    citations: list[Citation] = field(default_factory=list)
    retrieved: int = 0
    used: int = 0


_ANSWER_SYSTEM = """\
You are a careful research assistant. Answer the user's question using ONLY \
the numbered context passages provided. Cite the passages you use inline as \
[1], [2], etc. If the context does not contain the answer, say so plainly — \
do not invent facts. Be concise and direct.\
"""


class RAGPipeline:
    """Owns the Milvus + Neo4j stores and the answer LLM.

    Construct once and reuse (the underlying clients pool connections).
    Call `aclose()` on shutdown.
    """

    def __init__(
        self,
        settings: Settings | None = None,
        milvus: MilvusHybridStore | None = None,
        graph: Neo4jGraphStore | None | object = _UNSET,
    ) -> None:
        self._s = settings or get_settings()
        self._milvus = milvus or MilvusHybridStore(settings=self._s)
        if graph is _UNSET:
            # Not provided → honor config.
            self._graph = (
                Neo4jGraphStore() if self._s.enable_graph_retrieval else None
            )
        else:
            # Explicitly provided (including None to disable).
            self._graph = graph  # type: ignore[assignment]

    # ---------- indexing ----------

    async def index_document(self, doc: SourceDocument) -> int:
        """Chunk, optionally contextualize, then index into Milvus (+ graph)."""
        chunks = chunk_document(doc)
        if not chunks:
            return 0
        if self._s.enable_contextual_retrieval:
            chunks = await contextualize(doc, chunks)

        await self._milvus.ensure_collection()
        tasks = [self._milvus.add_chunks(chunks)]
        if self._graph is not None:
            await self._graph.ensure_schema()
            tasks.append(self._graph.add_chunks(chunks))
        await asyncio.gather(*tasks)
        logger.info("Indexed %d chunks from doc %s", len(chunks), doc.doc_id)
        return len(chunks)

    # ---------- retrieval ----------

    async def retrieve(
        self, query: str, *, doc_id: str | None = None
    ) -> list[RetrievedChunk]:
        """Hybrid (Milvus) + graph (Neo4j) → dedup → rerank → top-k."""
        coros = [self._milvus.hybrid_search(query, doc_id=doc_id)]
        if self._graph is not None:
            coros.append(self._graph.local_search(query))

        results = await asyncio.gather(*coros, return_exceptions=True)

        merged: list[RetrievedChunk] = []
        for r in results:
            if isinstance(r, BaseException):
                logger.warning("a retriever failed: %s", r)
                continue
            merged.extend(r)

        deduped = _dedup_by_chunk(merged)
        if not deduped:
            return []
        return rerank(query, deduped, top_k=self._s.rerank_top_k)

    # ---------- answer ----------

    async def answer(self, query: str, *, doc_id: str | None = None) -> AnswerResult:
        """Retrieve, then generate a cited answer with the local LLM."""
        retrieved = await self.retrieve(query, doc_id=doc_id)
        if not retrieved:
            return AnswerResult(
                answer="I couldn't find anything relevant in the indexed sources.",
                citations=[],
                retrieved=0,
                used=0,
            )

        context_block, citations = _format_context(retrieved)
        llm = get_llm()
        resp = await llm.ainvoke(
            [
                SystemMessage(content=_ANSWER_SYSTEM),
                HumanMessage(
                    content=f"Context passages:\n{context_block}\n\nQuestion: {query}"
                ),
            ]
        )
        answer_text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return AnswerResult(
            answer=answer_text.strip(),
            citations=citations,
            retrieved=len(retrieved),
            used=len(citations),
        )

    async def aclose(self) -> None:
        await self._milvus.close()
        if self._graph is not None:
            await self._graph.close()


# ---------- pure helpers (unit-testable without services) ----------


def _dedup_by_chunk(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
    """Keep the highest-scoring instance of each chunk_id across retrievers."""
    best: dict[str, RetrievedChunk] = {}
    for rc in chunks:
        existing = best.get(rc.chunk.chunk_id)
        if existing is None or rc.score > existing.score:
            best[rc.chunk.chunk_id] = rc
    return list(best.values())


def _format_context(retrieved: list[RetrievedChunk]) -> tuple[str, list[Citation]]:
    """Build the numbered context block + parallel citation list."""
    lines: list[str] = []
    citations: list[Citation] = []
    for i, rc in enumerate(retrieved, start=1):
        c = rc.chunk
        lines.append(f"[{i}] {c.raw_text}")
        citations.append(
            Citation(
                chunk_id=c.chunk_id,
                doc_id=c.doc_id,
                title=str(c.metadata.get("title", "")),
                source_uri=str(c.metadata.get("source_uri", "")),
                page=c.page,
                score=rc.score,
                snippet=c.raw_text[:240],
            )
        )
    return "\n\n".join(lines), citations


__all__ = ["AnswerResult", "Citation", "RAGPipeline"]
