"""Tests for the Milvus hybrid vector store.

Two tiers:

- Pure-unit tests (no server, no network): the row-mapping helpers and the
  store's request-building logic, exercised with a mocked AsyncMilvusClient
  and mocked Ollama embeddings.
- Integration tests (``@pytest.mark.integration``): hit a real Milvus. They
  SKIP automatically when no server is reachable.
"""

from __future__ import annotations

import contextlib
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.vectorstore.milvus_store import (
    MilvusHybridStore,
    chunk_to_row,
    doc_id_filter,
    escape_filter_value,
    hit_to_retrieved_chunk,
)

# ---------------------------------------------------------------------------
# Pure-unit: row mapping
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_chunk_to_row_maps_all_fields() -> None:
    chunk = Chunk(
        doc_id="doc-1",
        text="contextual prefix\n\nbody",
        raw_text="body",
        position=3,
        page=7,
        chunk_id="chunk-1",
        metadata={"title": "My Doc", "source_uri": "file:///x.pdf"},
    )
    dense = [0.1, 0.2, 0.3]
    row = chunk_to_row(chunk, dense)

    assert row["chunk_id"] == "chunk-1"
    assert row["text"] == "contextual prefix\n\nbody"
    assert row["raw_text"] == "body"
    assert row["doc_id"] == "doc-1"
    assert row["page"] == 7
    assert row["position"] == 3
    assert row["title"] == "My Doc"
    assert row["source_uri"] == "file:///x.pdf"
    assert row["dense"] == dense


@pytest.mark.unit
def test_chunk_to_row_page_none_becomes_sentinel() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", position=0, page=None)
    row = chunk_to_row(chunk, [0.0])
    assert row["page"] == -1


@pytest.mark.unit
def test_chunk_to_row_never_includes_sparse() -> None:
    # The BM25 function populates `sparse` server-side; inserting it is illegal.
    chunk = Chunk(doc_id="d", text="t", raw_text="t", position=0)
    row = chunk_to_row(chunk, [0.0])
    assert "sparse" not in row


@pytest.mark.unit
def test_chunk_to_row_missing_metadata_keys() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", position=0, metadata={})
    row = chunk_to_row(chunk, [0.0])
    assert row["title"] == ""
    assert row["source_uri"] == ""


# ---------------------------------------------------------------------------
# Pure-unit: hit -> RetrievedChunk
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_hit_to_retrieved_chunk_entity_shape() -> None:
    hit: dict[str, Any] = {
        "id": "chunk-9",
        "distance": 0.87,
        "entity": {
            "chunk_id": "chunk-9",
            "text": "ctx\n\nbody",
            "raw_text": "body",
            "doc_id": "doc-9",
            "page": 4,
            "position": 2,
            "title": "T",
            "source_uri": "u",
        },
    }
    rc = hit_to_retrieved_chunk(hit, source="milvus_hybrid")

    assert isinstance(rc, RetrievedChunk)
    assert rc.source == "milvus_hybrid"
    assert rc.score == pytest.approx(0.87)
    assert rc.chunk.chunk_id == "chunk-9"
    assert rc.chunk.text == "ctx\n\nbody"
    assert rc.chunk.raw_text == "body"  # raw_text used for citation
    assert rc.chunk.doc_id == "doc-9"
    assert rc.chunk.page == 4
    assert rc.chunk.position == 2
    assert rc.chunk.metadata == {"title": "T", "source_uri": "u"}


@pytest.mark.unit
def test_hit_to_retrieved_chunk_flat_shape() -> None:
    # Some encodings flatten fields onto the hit instead of nesting in entity.
    hit: dict[str, Any] = {
        "score": 1.5,
        "chunk_id": "c",
        "text": "t",
        "raw_text": "r",
        "doc_id": "d",
        "page": 0,
        "position": 0,
    }
    rc = hit_to_retrieved_chunk(hit, source="milvus_bm25")
    assert rc.score == pytest.approx(1.5)
    assert rc.chunk.chunk_id == "c"
    assert rc.chunk.raw_text == "r"
    assert rc.chunk.page == 0  # 0 is a valid page, not the sentinel


@pytest.mark.unit
def test_hit_to_retrieved_chunk_page_sentinel_back_to_none() -> None:
    hit = {"distance": 0.1, "entity": {"chunk_id": "c", "page": -1}}
    rc = hit_to_retrieved_chunk(hit, source="milvus_dense")
    assert rc.chunk.page is None


@pytest.mark.unit
def test_chunk_round_trips_through_row_and_hit() -> None:
    original = Chunk(
        doc_id="doc-rt",
        text="prefix\n\nbody text",
        raw_text="body text",
        position=5,
        page=2,
        chunk_id="chunk-rt",
        metadata={"title": "RT", "source_uri": "uri"},
    )
    row = chunk_to_row(original, [0.5, 0.5])
    # Simulate Milvus returning the stored scalar fields.
    hit = {"distance": 0.9, "entity": {k: row[k] for k in row if k != "dense"}}
    rc = hit_to_retrieved_chunk(hit, source="milvus_hybrid")

    assert rc.chunk.chunk_id == original.chunk_id
    assert rc.chunk.doc_id == original.doc_id
    assert rc.chunk.text == original.text
    assert rc.chunk.raw_text == original.raw_text
    assert rc.chunk.position == original.position
    assert rc.chunk.page == original.page


# ---------------------------------------------------------------------------
# Pure-unit: filter expression building
# ---------------------------------------------------------------------------


@pytest.mark.unit
def test_doc_id_filter_none_is_empty() -> None:
    assert doc_id_filter(None) == ""


@pytest.mark.unit
def test_doc_id_filter_builds_expr() -> None:
    assert doc_id_filter("doc-42") == 'doc_id == "doc-42"'


@pytest.mark.unit
def test_escape_filter_value_quotes_and_backslashes() -> None:
    assert escape_filter_value('a"b') == 'a\\"b'
    assert escape_filter_value("a\\b") == "a\\\\b"


@pytest.mark.unit
def test_doc_id_filter_escapes_injection() -> None:
    expr = doc_id_filter('x" or "1"=="1')
    assert expr == 'doc_id == "x\\" or \\"1\\"==\\"1"'


# ---------------------------------------------------------------------------
# Unit: store wiring with a mocked AsyncMilvusClient
# ---------------------------------------------------------------------------


@pytest.fixture
def settings() -> Settings:
    return Settings(
        milvus_collection="test_chunks",
        embed_dim=4,
        retrieve_top_k=10,
        rrf_k=60,
    )


@pytest.fixture
def mock_client() -> MagicMock:
    """A mock AsyncMilvusClient. Coroutine methods are AsyncMock; the
    schema/index builders are sync (they return builder objects)."""
    client = MagicMock()
    client.has_collection = AsyncMock(return_value=False)
    client.create_collection = AsyncMock(return_value=None)
    client.load_collection = AsyncMock(return_value=None)
    client.insert = AsyncMock(return_value={"insert_count": 0})
    client.delete = AsyncMock(return_value={"delete_count": 0})
    client.hybrid_search = AsyncMock(return_value=[[]])
    client.search = AsyncMock(return_value=[[]])
    client.close = AsyncMock(return_value=None)
    # create_schema / prepare_index_params are sync helpers returning builders.
    client.create_schema = MagicMock(return_value=MagicMock())
    client.prepare_index_params = MagicMock(return_value=MagicMock())
    return client


def _store(mock_client: MagicMock, settings: Settings) -> MilvusHybridStore:
    return MilvusHybridStore(client=mock_client, settings=settings)


@pytest.mark.unit
async def test_ensure_collection_creates_and_loads(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    await store.ensure_collection()

    mock_client.has_collection.assert_awaited_once_with("test_chunks")
    mock_client.create_collection.assert_awaited_once()
    _, kwargs = mock_client.create_collection.call_args
    assert kwargs["collection_name"] == "test_chunks"
    assert kwargs["consistency_level"] == "Strong"
    mock_client.load_collection.assert_awaited_once_with("test_chunks")


@pytest.mark.unit
async def test_ensure_collection_idempotent(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    await store.ensure_collection()
    await store.ensure_collection()
    # Second call short-circuits: no extra create/load.
    mock_client.create_collection.assert_awaited_once()
    mock_client.load_collection.assert_awaited_once()


@pytest.mark.unit
async def test_ensure_collection_skips_create_when_exists(
    mock_client: MagicMock, settings: Settings
) -> None:
    mock_client.has_collection = AsyncMock(return_value=True)
    store = _store(mock_client, settings)
    await store.ensure_collection()
    mock_client.create_collection.assert_not_awaited()
    mock_client.load_collection.assert_awaited_once_with("test_chunks")


@pytest.mark.unit
async def test_add_chunks_embeds_text_and_inserts_rows(
    mock_client: MagicMock, settings: Settings
) -> None:
    chunks = [
        Chunk(doc_id="d", text="alpha", raw_text="alpha", position=0, chunk_id="c0"),
        Chunk(doc_id="d", text="beta", raw_text="beta", position=1, chunk_id="c1"),
    ]
    mock_client.insert = AsyncMock(return_value={"insert_count": 2})
    fake_vectors = [[0.1, 0.2, 0.3, 0.4], [0.5, 0.6, 0.7, 0.8]]

    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_texts",
        new=AsyncMock(return_value=fake_vectors),
    ) as mock_embed:
        count = await store.add_chunks(chunks)

    assert count == 2
    mock_embed.assert_awaited_once_with(["alpha", "beta"])
    _, kwargs = mock_client.insert.call_args
    rows = kwargs["data"]
    assert [r["chunk_id"] for r in rows] == ["c0", "c1"]
    assert rows[0]["dense"] == fake_vectors[0]
    assert "sparse" not in rows[0]  # never insert sparse


@pytest.mark.unit
async def test_add_chunks_empty_is_noop(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_texts",
        new=AsyncMock(),
    ) as mock_embed:
        count = await store.add_chunks([])
    assert count == 0
    mock_embed.assert_not_awaited()
    mock_client.insert.assert_not_awaited()


@pytest.mark.unit
async def test_add_chunks_mismatched_embeddings_raises(
    mock_client: MagicMock, settings: Settings
) -> None:
    chunks = [Chunk(doc_id="d", text="x", raw_text="x", position=0)]
    store = _store(mock_client, settings)
    with (
        patch(
            "sovereign_rag.vectorstore.milvus_store.embed_texts",
            new=AsyncMock(return_value=[[0.1], [0.2]]),  # 2 vectors for 1 chunk
        ),
        pytest.raises(ValueError, match="embed_texts returned"),
    ):
        await store.add_chunks(chunks)


@pytest.mark.unit
async def test_hybrid_search_builds_two_legs_and_uses_rrf(
    mock_client: MagicMock, settings: Settings
) -> None:
    hit = {
        "distance": 0.9,
        "entity": {
            "chunk_id": "c",
            "text": "t",
            "raw_text": "r",
            "doc_id": "d",
            "page": -1,
            "position": 0,
        },
    }
    mock_client.hybrid_search = AsyncMock(return_value=[[hit]])

    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_query",
        new=AsyncMock(return_value=[0.1, 0.2, 0.3, 0.4]),
    ) as mock_embed:
        results = await store.hybrid_search("what is sovereignty?", top_k=5, doc_id="d")

    mock_embed.assert_awaited_once_with("what is sovereignty?")
    _, kwargs = mock_client.hybrid_search.call_args
    reqs = kwargs["reqs"]
    assert len(reqs) == 2  # dense + bm25

    dense_req, sparse_req = reqs
    # Dense leg carries the embedding vector against the dense field.
    assert dense_req.anns_field == "dense"
    assert dense_req.data == [[0.1, 0.2, 0.3, 0.4]]
    # BM25 leg carries the RAW query string against the sparse field.
    assert sparse_req.anns_field == "sparse"
    assert sparse_req.data == ["what is sovereignty?"]

    # Ranker is RRF with the configured k.
    from pymilvus import RRFRanker

    assert isinstance(kwargs["ranker"], RRFRanker)
    assert kwargs["limit"] == 5

    assert len(results) == 1
    assert results[0].source == "milvus_hybrid"
    assert results[0].chunk.page is None  # -1 sentinel mapped back


@pytest.mark.unit
async def test_hybrid_search_default_top_k(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_query",
        new=AsyncMock(return_value=[0.0, 0.0, 0.0, 0.0]),
    ):
        await store.hybrid_search("q")
    _, kwargs = mock_client.hybrid_search.call_args
    assert kwargs["limit"] == settings.retrieve_top_k  # 10


@pytest.mark.unit
async def test_hybrid_search_no_doc_id_uses_no_expr(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_query",
        new=AsyncMock(return_value=[0.0, 0.0, 0.0, 0.0]),
    ):
        await store.hybrid_search("q")
    _, kwargs = mock_client.hybrid_search.call_args
    for req in kwargs["reqs"]:
        assert getattr(req, "expr", None) in (None, "")


@pytest.mark.unit
async def test_dense_search_uses_filter_kwarg_and_source(
    mock_client: MagicMock, settings: Settings
) -> None:
    mock_client.search = AsyncMock(return_value=[[]])
    store = _store(mock_client, settings)
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_query",
        new=AsyncMock(return_value=[0.1, 0.2, 0.3, 0.4]),
    ):
        await store.dense_search("q", doc_id="doc-7")
    _, kwargs = mock_client.search.call_args
    assert kwargs["anns_field"] == "dense"
    assert kwargs["data"] == [[0.1, 0.2, 0.3, 0.4]]
    assert kwargs["search_params"]["metric_type"] == "COSINE"
    # MilvusClient.search uses `filter`, not `expr`.
    assert kwargs["filter"] == 'doc_id == "doc-7"'


@pytest.mark.unit
async def test_bm25_search_passes_raw_query_string(
    mock_client: MagicMock, settings: Settings
) -> None:
    mock_client.search = AsyncMock(return_value=[[]])
    store = _store(mock_client, settings)
    # bm25_search must NOT embed — Milvus does the tokenization server-side.
    with patch(
        "sovereign_rag.vectorstore.milvus_store.embed_query",
        new=AsyncMock(),
    ) as mock_embed:
        await store.bm25_search("free text query")
    mock_embed.assert_not_awaited()
    _, kwargs = mock_client.search.call_args
    assert kwargs["anns_field"] == "sparse"
    assert kwargs["data"] == ["free text query"]
    assert kwargs["search_params"]["metric_type"] == "BM25"


@pytest.mark.unit
async def test_delete_document_uses_filter(
    mock_client: MagicMock, settings: Settings
) -> None:
    mock_client.delete = AsyncMock(return_value={"delete_count": 3})
    store = _store(mock_client, settings)
    deleted = await store.delete_document("doc-x")
    assert deleted == 3
    _, kwargs = mock_client.delete.call_args
    assert kwargs["filter"] == 'doc_id == "doc-x"'


@pytest.mark.unit
async def test_close_awaits_client_close(
    mock_client: MagicMock, settings: Settings
) -> None:
    store = _store(mock_client, settings)
    await store.close()
    mock_client.close.assert_awaited_once()


# ---------------------------------------------------------------------------
# Integration: real Milvus (skips if unreachable)
# ---------------------------------------------------------------------------


@pytest.fixture
async def live_store() -> Any:
    """Yield a MilvusHybridStore backed by a real server, or skip.

    Uses a throwaway collection so we never touch the project's real one.
    """
    from pymilvus import AsyncMilvusClient

    s = Settings(milvus_collection=f"test_hybrid_{uuid.uuid4().hex[:8]}")
    client = AsyncMilvusClient(uri=s.milvus_uri)
    try:
        await client.has_collection(s.milvus_collection)
    except Exception as exc:  # any failure means no server
        await client.close()
        pytest.skip(f"Milvus not reachable at {s.milvus_uri}: {exc}")

    store = MilvusHybridStore(client=client, settings=s)
    try:
        yield store
    finally:
        with contextlib.suppress(Exception):
            await client.drop_collection(s.milvus_collection)
        await store.close()


@pytest.mark.integration
async def test_integration_add_and_hybrid_search(live_store: MilvusHybridStore) -> None:
    chunks = [
        Chunk(
            doc_id="doc-a",
            text="The capital of France is Paris.",
            raw_text="The capital of France is Paris.",
            position=0,
            page=1,
            metadata={"title": "Geo", "source_uri": "mem://a"},
        ),
        Chunk(
            doc_id="doc-b",
            text="Photosynthesis converts sunlight into chemical energy.",
            raw_text="Photosynthesis converts sunlight into chemical energy.",
            position=0,
            page=None,
            metadata={"title": "Bio", "source_uri": "mem://b"},
        ),
    ]
    inserted = await live_store.add_chunks(chunks)
    assert inserted == 2

    results = await live_store.hybrid_search("What is the capital of France?", top_k=2)
    assert results, "hybrid search returned no results"
    assert results[0].source == "milvus_hybrid"
    assert any("Paris" in r.chunk.raw_text for r in results)


@pytest.mark.integration
async def test_integration_dense_and_bm25_legs(live_store: MilvusHybridStore) -> None:
    chunks = [
        Chunk(
            doc_id="doc-c",
            text="Milvus is a vector database for similarity search.",
            raw_text="Milvus is a vector database for similarity search.",
            position=0,
        ),
    ]
    await live_store.add_chunks(chunks)

    dense = await live_store.dense_search("vector similarity", top_k=1)
    assert dense and dense[0].source == "milvus_dense"

    bm25 = await live_store.bm25_search("Milvus database", top_k=1)
    assert bm25 and bm25[0].source == "milvus_bm25"


@pytest.mark.integration
async def test_integration_doc_id_filter_and_delete(
    live_store: MilvusHybridStore,
) -> None:
    await live_store.add_chunks(
        [
            Chunk(doc_id="keep", text="alpha content here", raw_text="alpha", position=0),
            Chunk(doc_id="drop", text="beta content here", raw_text="beta", position=0),
        ]
    )

    filtered = await live_store.hybrid_search("content", top_k=10, doc_id="keep")
    assert all(r.chunk.doc_id == "keep" for r in filtered)

    deleted = await live_store.delete_document("drop")
    assert deleted >= 1
