"""Milvus 2.6 hybrid (dense + BM25) vector store.

Hybrid retrieval happens *entirely inside Milvus*:

- We embed `Chunk.text` with Ollama (bge-m3, 1024-dim) and store it in a
  `FLOAT_VECTOR` field (``dense``) — that's the semantic leg.
- We store the *raw text* in an analyzed VARCHAR field (``text``). Milvus's
  built-in BM25 ``Function`` reads that field and writes a server-side
  ``SPARSE_FLOAT_VECTOR`` (``sparse``) — that's the lexical leg. We never
  compute or insert sparse vectors ourselves.
- At query time we fire two ``AnnSearchRequest``s (dense vector + raw query
  string) and fuse them with Reciprocal Rank Fusion (``RRFRanker``) in a
  single ``hybrid_search`` call.

This module uses the modern ``AsyncMilvusClient`` API (pymilvus 2.6), not
the deprecated ``connections.connect()`` / ``Collection`` ORM style.
"""

from __future__ import annotations

import logging
from typing import Any

from pymilvus import (
    AnnSearchRequest,
    AsyncMilvusClient,
    DataType,
    Function,
    FunctionType,
    RRFRanker,
    WeightedRanker,
)

from sovereign_rag.config import Settings, get_settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.providers.ollama import embed_query, embed_texts

logger = logging.getLogger(__name__)

# Field names — kept as module constants so the mapping helpers and the
# store agree on the schema.
_F_CHUNK_ID = "chunk_id"
_F_TEXT = "text"
_F_DOC_ID = "doc_id"
_F_PAGE = "page"
_F_POSITION = "position"
_F_RAW_TEXT = "raw_text"
_F_TITLE = "title"
_F_SOURCE_URI = "source_uri"
_F_DENSE = "dense"
_F_SPARSE = "sparse"

# Sentinel for a missing page (the schema field is non-nullable INT64).
_PAGE_NONE = -1

# Max length of the analyzed/stored text VARCHAR fields.
_TEXT_MAX_LENGTH = 8000
_META_MAX_LENGTH = 2048

_BM25_FUNCTION_NAME = "text_bm25"

# Fields we ask Milvus to return so we can rebuild a Chunk for citations.
# The vector fields are intentionally excluded (we don't need them back).
_OUTPUT_FIELDS = [
    _F_CHUNK_ID,
    _F_TEXT,
    _F_DOC_ID,
    _F_PAGE,
    _F_POSITION,
    _F_RAW_TEXT,
    _F_TITLE,
    _F_SOURCE_URI,
]


def chunk_to_row(chunk: Chunk, dense: list[float]) -> dict[str, Any]:
    """Map a `Chunk` + its dense embedding to a Milvus insert row.

    Pure function (no I/O) so it can be unit-tested without a server.
    The ``sparse`` field is deliberately omitted — Milvus's BM25 ``Function``
    populates it server-side from ``text``; inserting into it is an error.

    ``page`` is coerced from ``None`` to the ``-1`` sentinel because the
    schema field is a non-nullable INT64.
    """
    meta = chunk.metadata or {}
    return {
        _F_CHUNK_ID: chunk.chunk_id,
        _F_TEXT: chunk.text,
        _F_DOC_ID: chunk.doc_id,
        _F_PAGE: chunk.page if chunk.page is not None else _PAGE_NONE,
        _F_POSITION: chunk.position,
        _F_RAW_TEXT: chunk.raw_text,
        _F_TITLE: str(meta.get("title", "")),
        _F_SOURCE_URI: str(meta.get("source_uri", "")),
        _F_DENSE: dense,
    }


def hit_to_retrieved_chunk(hit: dict[str, Any], source: str) -> RetrievedChunk:
    """Map one Milvus search hit to a `RetrievedChunk`.

    Pure function (no I/O). A pymilvus hit looks like
    ``{"id": ..., "distance": <score>, "entity": {<output fields>}}``.
    Older/edge encodings flatten the fields onto the hit itself, so we look
    in both places. ``page == -1`` is mapped back to ``None``.
    """
    entity: dict[str, Any] = hit.get("entity") or hit
    score = float(hit.get("distance", hit.get("score", 0.0)))

    raw_page = entity.get(_F_PAGE, _PAGE_NONE)
    page: int | None = None if raw_page is None or raw_page == _PAGE_NONE else int(raw_page)

    metadata: dict[str, Any] = {}
    title = entity.get(_F_TITLE)
    source_uri = entity.get(_F_SOURCE_URI)
    if title:
        metadata["title"] = title
    if source_uri:
        metadata["source_uri"] = source_uri

    chunk = Chunk(
        doc_id=str(entity.get(_F_DOC_ID, "")),
        text=str(entity.get(_F_TEXT, "")),
        raw_text=str(entity.get(_F_RAW_TEXT, "")),
        position=int(entity.get(_F_POSITION, 0)),
        page=page,
        chunk_id=str(entity.get(_F_CHUNK_ID, "")),
        metadata=metadata,
    )
    return RetrievedChunk(chunk=chunk, score=score, source=source, origin_source=source)


def escape_filter_value(value: str) -> str:
    """Escape a string for safe use inside a Milvus boolean filter literal."""
    return value.replace("\\", "\\\\").replace('"', '\\"')


def doc_id_filter(doc_id: str | None) -> str:
    """Build a ``doc_id == "..."`` filter expression, or ``""`` for no filter."""
    if doc_id is None:
        return ""
    return f'{_F_DOC_ID} == "{escape_filter_value(doc_id)}"'


class MilvusHybridStore:
    """Async Milvus 2.6 store doing dense + BM25 hybrid search server-side.

    All search/index work goes through ``AsyncMilvusClient``. The client
    connects lazily, so :meth:`close` must always be awaited on shutdown.
    """

    def __init__(
        self,
        client: AsyncMilvusClient | None = None,
        settings: Settings | None = None,
    ) -> None:
        self._settings = settings or get_settings()
        self._collection = self._settings.milvus_collection
        self._client = client or AsyncMilvusClient(uri=self._settings.milvus_uri)
        self._ensured = False

    # ----- lifecycle -------------------------------------------------------

    async def ensure_collection(self) -> None:
        """Create the collection + indexes if absent, then load it. Idempotent."""
        if self._ensured:
            return

        exists = await self._client.has_collection(self._collection)
        if not exists:
            schema = self._build_schema()
            index_params = self._build_index_params()
            await self._client.create_collection(
                collection_name=self._collection,
                schema=schema,
                index_params=index_params,
                consistency_level="Strong",
            )
            logger.info("Created Milvus collection %s", self._collection)

        # Loading is required before any search; it is a no-op if already loaded.
        await self._client.load_collection(self._collection)
        self._ensured = True
        logger.info("Milvus collection %s loaded", self._collection)

    def _build_schema(self) -> Any:
        """Build the hybrid schema with the BM25 function attached."""
        schema = self._client.create_schema(
            auto_id=False,
            description="sovereign-rag hybrid (dense + BM25) chunks",
        )
        schema.add_field(_F_CHUNK_ID, DataType.VARCHAR, is_primary=True, max_length=64)
        # enable_analyzer=True is REQUIRED for the BM25 function to tokenize.
        schema.add_field(
            _F_TEXT, DataType.VARCHAR, max_length=_TEXT_MAX_LENGTH, enable_analyzer=True
        )
        schema.add_field(_F_DOC_ID, DataType.VARCHAR, max_length=64)
        schema.add_field(_F_PAGE, DataType.INT64)
        schema.add_field(_F_POSITION, DataType.INT64)
        schema.add_field(_F_RAW_TEXT, DataType.VARCHAR, max_length=_TEXT_MAX_LENGTH)
        schema.add_field(_F_TITLE, DataType.VARCHAR, max_length=_META_MAX_LENGTH)
        schema.add_field(_F_SOURCE_URI, DataType.VARCHAR, max_length=_META_MAX_LENGTH)
        schema.add_field(_F_DENSE, DataType.FLOAT_VECTOR, dim=self._settings.embed_dim)
        # Output field of the BM25 function — populated server-side.
        schema.add_field(_F_SPARSE, DataType.SPARSE_FLOAT_VECTOR)

        bm25 = Function(
            name=_BM25_FUNCTION_NAME,
            function_type=FunctionType.BM25,
            input_field_names=[_F_TEXT],
            output_field_names=_F_SPARSE,
        )
        schema.add_function(bm25)
        return schema

    def _build_index_params(self) -> Any:
        """HNSW/COSINE for dense, SPARSE_INVERTED_INDEX/BM25 for sparse."""
        index_params = self._client.prepare_index_params()
        index_params.add_index(
            field_name=_F_DENSE,
            index_name="dense_hnsw",
            index_type="HNSW",
            metric_type="COSINE",
            params={"M": 16, "efConstruction": 200},
        )
        index_params.add_index(
            field_name=_F_SPARSE,
            index_name="sparse_bm25",
            index_type="SPARSE_INVERTED_INDEX",
            metric_type="BM25",
            params={"bm25_k1": 1.2, "bm25_b": 0.75},
        )
        return index_params

    async def close(self) -> None:
        """Close the async client. AsyncMilvusClient connects lazily, so this
        must always be awaited on shutdown."""
        await self._client.close()

    # ----- writes ----------------------------------------------------------

    async def add_chunks(self, chunks: list[Chunk]) -> int:
        """Embed each chunk's ``text`` (dense) and insert. Returns count inserted.

        Only raw text + the dense vector are inserted; Milvus computes the
        BM25 sparse vector server-side from the analyzed ``text`` field.
        """
        if not chunks:
            return 0
        await self.ensure_collection()

        dense_vectors = await embed_texts([c.text for c in chunks])
        if len(dense_vectors) != len(chunks):
            raise ValueError(
                f"embed_texts returned {len(dense_vectors)} vectors for {len(chunks)} chunks"
            )

        rows = [
            chunk_to_row(chunk, dense) for chunk, dense in zip(chunks, dense_vectors, strict=True)
        ]
        result = await self._client.insert(collection_name=self._collection, data=rows)
        inserted = _insert_count(result, fallback=len(rows))
        logger.info("Inserted %d chunks into %s", inserted, self._collection)
        return inserted

    async def delete_document(self, doc_id: str) -> int:
        """Delete every chunk belonging to ``doc_id``. Returns delete count."""
        await self.ensure_collection()
        result = await self._client.delete(
            collection_name=self._collection,
            filter=doc_id_filter(doc_id),
        )
        deleted = _delete_count(result)
        logger.info("Deleted %d chunks for doc_id=%s", deleted, doc_id)
        return deleted

    # ----- reads -----------------------------------------------------------

    async def hybrid_search(
        self,
        query: str,
        top_k: int | None = None,
        doc_id: str | None = None,
    ) -> list[RetrievedChunk]:
        """Dense + BM25 hybrid search fused with RRF, all inside Milvus.

        Honours ``dense_enabled`` / ``sparse_enabled`` from Settings: when one
        leg is turned off in the SettingsPanel we drop it from the request set
        and fall back to a single-leg search instead of hybrid. When both legs
        are off we short-circuit to an empty result rather than fire a noop
        request.
        """
        await self.ensure_collection()
        s = self._settings
        limit = top_k or s.retrieve_top_k
        expr = doc_id_filter(doc_id)

        if not s.dense_enabled and not s.sparse_enabled:
            return []

        reqs: list[AnnSearchRequest] = []
        if s.dense_enabled:
            query_dense = await embed_query(query)
            reqs.append(
                AnnSearchRequest(
                    data=[query_dense],
                    anns_field=_F_DENSE,
                    param={"metric_type": "COSINE"},
                    limit=limit,
                    expr=expr or None,
                )
            )
        if s.sparse_enabled:
            reqs.append(
                AnnSearchRequest(
                    data=[query],
                    anns_field=_F_SPARSE,
                    param={"metric_type": "BM25"},
                    limit=limit,
                    expr=expr or None,
                )
            )

        # Pick the ranker. When both legs are enabled we keep RRF (the only
        # strategy whose fusion math we actually implement); WeightedRanker
        # is available when fusion_strategy=="weighted" so the user's choice
        # in the panel takes effect end-to-end.
        ranker: Any
        if len(reqs) == 1:
            # Hybrid with a single leg is just a regular search; Milvus
            # accepts it but the ranker still has to be set to something.
            ranker = RRFRanker(s.rrf_k)
        elif s.fusion_strategy == "weighted":
            ranker = WeightedRanker(s.fusion_vector_weight, s.fusion_graph_weight)
        else:
            ranker = RRFRanker(s.rrf_k)

        results = await self._client.hybrid_search(
            collection_name=self._collection,
            reqs=reqs,
            ranker=ranker,
            limit=limit,
            output_fields=_OUTPUT_FIELDS,
        )
        # nq == 1, so the single query's hits live at results[0].
        hits = results[0] if results else []
        return [hit_to_retrieved_chunk(hit, source="milvus_hybrid") for hit in hits]

    async def dense_search(
        self,
        query: str,
        top_k: int | None = None,
        doc_id: str | None = None,
    ) -> list[RetrievedChunk]:
        """Single-leg semantic search over the dense vector field."""
        await self.ensure_collection()
        limit = top_k or self._settings.retrieve_top_k
        query_dense = await embed_query(query)

        results = await self._client.search(
            collection_name=self._collection,
            data=[query_dense],
            anns_field=_F_DENSE,
            search_params={"metric_type": "COSINE"},
            limit=limit,
            filter=doc_id_filter(doc_id),
            output_fields=_OUTPUT_FIELDS,
        )
        hits = results[0] if results else []
        return [hit_to_retrieved_chunk(hit, source="milvus_dense") for hit in hits]

    async def bm25_search(
        self,
        query: str,
        top_k: int | None = None,
        doc_id: str | None = None,
    ) -> list[RetrievedChunk]:
        """Single-leg lexical search over the server-side BM25 sparse field.

        The raw query string is passed as ``data`` — Milvus's analyzer
        tokenizes it; we never build a sparse vector ourselves.
        """
        await self.ensure_collection()
        limit = top_k or self._settings.retrieve_top_k

        results = await self._client.search(
            collection_name=self._collection,
            data=[query],
            anns_field=_F_SPARSE,
            search_params={"metric_type": "BM25"},
            limit=limit,
            filter=doc_id_filter(doc_id),
            output_fields=_OUTPUT_FIELDS,
        )
        hits = results[0] if results else []
        return [hit_to_retrieved_chunk(hit, source="milvus_bm25") for hit in hits]


def _insert_count(result: Any, fallback: int) -> int:
    """Best-effort extraction of insert count from a pymilvus insert result."""
    if isinstance(result, dict):
        count = result.get("insert_count")
        if count is not None:
            return int(count)
    count_attr = getattr(result, "insert_count", None)
    if count_attr is not None:
        return int(count_attr)
    return fallback


def _delete_count(result: Any) -> int:
    """Best-effort extraction of delete count from a pymilvus delete result."""
    if isinstance(result, dict):
        count = result.get("delete_count")
        if count is not None:
            return int(count)
    count_attr = getattr(result, "delete_count", None)
    if count_attr is not None:
        return int(count_attr)
    return 0


__all__ = [
    "MilvusHybridStore",
    "chunk_to_row",
    "doc_id_filter",
    "escape_filter_value",
    "hit_to_retrieved_chunk",
]
