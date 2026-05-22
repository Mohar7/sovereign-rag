"""Tests for the Neo4j knowledge-graph store.

Pure-unit tests (no server) cover:
- structured-output parsing/normalization in ``_extract`` (mocked LLM),
- the Cypher row → ``RetrievedChunk`` mapping and the related-facts/enrichment
  helpers,
- the chunk/extraction parameter builders.

Live tests are marked ``integration`` and skipped if Neo4j is unreachable.
"""

from __future__ import annotations

import os
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graph.neo4j_store import (
    DEFAULT_ENTITY_TYPES,
    ExtractedEntity,
    ExtractedRelation,
    Extraction,
    Neo4jGraphStore,
    _chunk_to_param,
    _enrich_chunk_text,
    _extraction_to_params,
    _format_related_facts,
    _normalize_extraction,
    _row_to_retrieved_chunk,
)

# ---------------------------------------------------------------------------
# Helper / mapping unit tests
# ---------------------------------------------------------------------------


def test_format_related_facts_empty() -> None:
    assert _format_related_facts([]) == ""
    assert _format_related_facts(["", "   "]) == ""


def test_format_related_facts_dedupes_and_orders() -> None:
    out = _format_related_facts(["Alice WORKS_FOR Acme", "Alice WORKS_FOR Acme", "Bob LIVES_IN NYC"])
    assert out == "Related facts:\n- Alice WORKS_FOR Acme\n- Bob LIVES_IN NYC"


def test_enrich_chunk_text_no_facts_returns_original() -> None:
    assert _enrich_chunk_text("body", []) == "body"


def test_enrich_chunk_text_appends_block() -> None:
    out = _enrich_chunk_text("body", ["Alice WORKS_FOR Acme"])
    assert out == "body\n\nRelated facts:\n- Alice WORKS_FOR Acme"


def test_row_to_retrieved_chunk_maps_fields_and_enriches() -> None:
    row: dict[str, Any] = {
        "chunk_id": "c1",
        "doc_id": "d1",
        "text": "ignored-stored-text",
        "raw_text": "The raw body.",
        "position": 3,
        "page": 7,
        "score": 0.87,
        "facts": ["Alice WORKS_FOR Acme", "Acme: a company"],
    }
    rc = _row_to_retrieved_chunk(row)
    assert isinstance(rc, RetrievedChunk)
    assert rc.source == "graph"
    assert rc.score == pytest.approx(0.87)
    assert rc.chunk.chunk_id == "c1"
    assert rc.chunk.doc_id == "d1"
    assert rc.chunk.position == 3
    assert rc.chunk.page == 7
    # raw_text preserved; text enriched with facts block.
    assert rc.chunk.raw_text == "The raw body."
    assert rc.chunk.text.startswith("The raw body.")
    assert "Related facts:" in rc.chunk.text
    assert "Alice WORKS_FOR Acme" in rc.chunk.text


def test_row_to_retrieved_chunk_handles_missing_optionals() -> None:
    row: dict[str, Any] = {
        "chunk_id": "c2",
        "doc_id": "d2",
        "text": "t",
        "raw_text": "body",
        "position": None,
        "page": None,
        "score": 1,
        "facts": None,
    }
    rc = _row_to_retrieved_chunk(row)
    assert rc.chunk.position == 0
    assert rc.chunk.page is None
    assert rc.chunk.text == "body"  # no facts → no enrichment
    assert rc.score == pytest.approx(1.0)


def test_chunk_to_param_flattens() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="r", position=2, page=1, chunk_id="cid")
    param = _chunk_to_param(chunk, [0.1, 0.2, 0.3])
    assert param == {
        "chunk_id": "cid",
        "doc_id": "d",
        "text": "t",
        "raw_text": "r",
        "position": 2,
        "page": 1,
        "embedding": [0.1, 0.2, 0.3],
    }


def test_extraction_to_params_shapes_lists() -> None:
    extraction = Extraction(
        entities=[ExtractedEntity(name="Alice", type="Person", description="An engineer")],
        relations=[
            ExtractedRelation(
                source="Alice", target="Acme", type="WORKS_FOR", description="employed by"
            )
        ],
    )
    params = _extraction_to_params("c1", extraction)
    assert params["chunk_id"] == "c1"
    assert params["entities"] == [
        {"name": "Alice", "type": "Person", "description": "An engineer"}
    ]
    assert params["relations"] == [
        {
            "source": "Alice",
            "target": "Acme",
            "type": "WORKS_FOR",
            "description": "employed by",
        }
    ]


# ---------------------------------------------------------------------------
# Normalization unit tests
# ---------------------------------------------------------------------------


def test_normalize_drops_blank_entities() -> None:
    extraction = Extraction(
        entities=[
            ExtractedEntity(name="Alice", type="Person"),
            ExtractedEntity(name="   ", type="Person"),
            ExtractedEntity(name="", type="Person"),
        ],
        relations=[],
    )
    out = _normalize_extraction(extraction)
    assert [e.name for e in out.entities] == ["Alice"]


def test_normalize_drops_relations_referencing_unknown_entities() -> None:
    extraction = Extraction(
        entities=[
            ExtractedEntity(name="Alice", type="Person"),
            ExtractedEntity(name="Acme", type="Organization"),
        ],
        relations=[
            ExtractedRelation(source="Alice", target="Acme", type="WORKS_FOR"),
            # target not in entity set → dropped
            ExtractedRelation(source="Alice", target="Ghost", type="KNOWS"),
            # blank type → dropped
            ExtractedRelation(source="Alice", target="Acme", type="  "),
        ],
    )
    out = _normalize_extraction(extraction)
    assert len(out.relations) == 1
    assert out.relations[0].source == "Alice"
    assert out.relations[0].target == "Acme"
    assert out.relations[0].type == "WORKS_FOR"


def test_default_entity_types_present() -> None:
    # Guard against accidental edits to the constrained set.
    assert "Person" in DEFAULT_ENTITY_TYPES
    assert "Organization" in DEFAULT_ENTITY_TYPES
    assert len(DEFAULT_ENTITY_TYPES) == 6


# ---------------------------------------------------------------------------
# _extract structured-output tests (mocked LLM + mocked driver construction)
# ---------------------------------------------------------------------------


@pytest.fixture
def patched_store(monkeypatch: pytest.MonkeyPatch) -> Neo4jGraphStore:
    """A store whose async driver construction is mocked out (no connection)."""
    fake_driver = MagicMock()
    fake_driver.close = AsyncMock()
    monkeypatch.setattr(
        "sovereign_rag.graph.neo4j_store.AsyncGraphDatabase.driver",
        lambda *a, **k: fake_driver,
    )
    return Neo4jGraphStore()


async def test_extract_parses_structured_output(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    canned = Extraction(
        entities=[
            ExtractedEntity(name="Ada Lovelace", type="Person", description="A mathematician"),
            ExtractedEntity(name="Analytical Engine", type="Technology"),
        ],
        relations=[
            ExtractedRelation(
                source="Ada Lovelace",
                target="Analytical Engine",
                type="WORKED_ON",
                description="wrote the first algorithm for it",
            )
        ],
    )

    structured_llm = MagicMock()
    structured_llm.ainvoke = AsyncMock(return_value=canned)
    fake_llm = MagicMock()
    fake_llm.with_structured_output.return_value = structured_llm
    monkeypatch.setattr(
        "sovereign_rag.graph.neo4j_store.get_llm", lambda: fake_llm
    )

    result = await patched_store._extract("Ada Lovelace worked on the Analytical Engine.")

    fake_llm.with_structured_output.assert_called_once_with(Extraction)
    assert structured_llm.ainvoke.await_count == 1
    assert {e.name for e in result.entities} == {"Ada Lovelace", "Analytical Engine"}
    assert len(result.relations) == 1
    assert result.relations[0].type == "WORKED_ON"


async def test_extract_normalizes_bad_relations(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    canned = Extraction(
        entities=[ExtractedEntity(name="Alice", type="Person")],
        relations=[
            ExtractedRelation(source="Alice", target="Nonexistent", type="KNOWS"),
        ],
    )
    structured_llm = MagicMock()
    structured_llm.ainvoke = AsyncMock(return_value=canned)
    fake_llm = MagicMock()
    fake_llm.with_structured_output.return_value = structured_llm
    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.get_llm", lambda: fake_llm)

    result = await patched_store._extract("Alice exists.")
    assert [e.name for e in result.entities] == ["Alice"]
    assert result.relations == []  # dangling relation dropped


async def test_extract_empty_text_skips_llm(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake_llm = MagicMock()
    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.get_llm", lambda: fake_llm)
    result = await patched_store._extract("   ")
    assert result.entities == []
    assert result.relations == []
    fake_llm.with_structured_output.assert_not_called()


async def test_extract_handles_llm_failure_gracefully(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    structured_llm = MagicMock()
    structured_llm.ainvoke = AsyncMock(side_effect=RuntimeError("ollama down"))
    fake_llm = MagicMock()
    fake_llm.with_structured_output.return_value = structured_llm
    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.get_llm", lambda: fake_llm)

    result = await patched_store._extract("some text")
    assert result.entities == []
    assert result.relations == []


async def test_extract_handles_unexpected_return_type(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    structured_llm = MagicMock()
    structured_llm.ainvoke = AsyncMock(return_value={"not": "an Extraction"})
    fake_llm = MagicMock()
    fake_llm.with_structured_output.return_value = structured_llm
    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.get_llm", lambda: fake_llm)

    result = await patched_store._extract("some text")
    assert result.entities == []
    assert result.relations == []


# ---------------------------------------------------------------------------
# add_chunks unit test (mocked driver + mocked embeddings + mocked extract)
# ---------------------------------------------------------------------------


async def test_add_chunks_embeds_writes_and_extracts(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Mock the embedding call.
    async def fake_embed_texts(texts: list[str]) -> list[list[float]]:
        return [[0.0, 1.0] for _ in texts]

    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.embed_texts", fake_embed_texts)

    # Mock the driver write path.
    exec_query = AsyncMock(return_value=([], None, None))
    patched_store._driver.execute_query = exec_query  # type: ignore[method-assign]

    # Mock extraction to return one entity (so a write happens).
    async def fake_extract(self: Neo4jGraphStore, text: str) -> Extraction:
        return Extraction(entities=[ExtractedEntity(name="X", type="Concept")])

    monkeypatch.setattr(Neo4jGraphStore, "_extract", fake_extract)

    chunks = [
        Chunk(doc_id="d", text="t1", raw_text="r1", position=0, chunk_id="c1"),
        Chunk(doc_id="d", text="t2", raw_text="r2", position=1, chunk_id="c2"),
    ]
    count = await patched_store.add_chunks(chunks)
    assert count == 2
    # At least: 1 chunk MERGE batch + 1 entity MERGE per chunk.
    assert exec_query.await_count >= 1
    merged_chunk_queries = [
        call for call in exec_query.await_args_list if "MERGE (c:Chunk" in call.args[0]
    ]
    assert len(merged_chunk_queries) == 1  # single batch for 2 chunks


async def test_add_chunks_empty_returns_zero(patched_store: Neo4jGraphStore) -> None:
    assert await patched_store.add_chunks([]) == 0


async def test_add_chunks_raises_on_embedding_count_mismatch(
    patched_store: Neo4jGraphStore, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def bad_embed(texts: list[str]) -> list[list[float]]:
        return [[0.0]]  # wrong count

    monkeypatch.setattr("sovereign_rag.graph.neo4j_store.embed_texts", bad_embed)
    patched_store._driver.execute_query = AsyncMock(return_value=([], None, None))  # type: ignore[method-assign]
    chunks = [
        Chunk(doc_id="d", text="t1", raw_text="r1", position=0),
        Chunk(doc_id="d", text="t2", raw_text="r2", position=1),
    ]
    with pytest.raises(ValueError, match="Embedding count mismatch"):
        await patched_store.add_chunks(chunks)


# ---------------------------------------------------------------------------
# Integration tests (require a live Neo4j) — skipped if unreachable.
# ---------------------------------------------------------------------------


def _neo4j_reachable() -> bool:
    from neo4j import GraphDatabase

    from sovereign_rag.config import get_settings

    s = get_settings()
    try:
        with GraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password)) as drv:
            drv.verify_connectivity()
        return True
    except Exception:
        return False


_LIVE = os.getenv("RUN_NEO4J_IT") == "1" and _neo4j_reachable()
_skip_live = pytest.mark.skipif(not _LIVE, reason="Neo4j not reachable (set RUN_NEO4J_IT=1)")


@pytest.mark.integration
@_skip_live
async def test_live_schema_add_search_delete() -> None:
    store = Neo4jGraphStore()
    try:
        await store.ensure_schema()
        chunks = [
            Chunk(
                doc_id="it-doc",
                text="Ada Lovelace worked on the Analytical Engine designed by Charles Babbage.",
                raw_text="Ada Lovelace worked on the Analytical Engine designed by Charles Babbage.",
                position=0,
                chunk_id="it-c1",
            )
        ]
        n = await store.add_chunks(chunks)
        assert n == 1
        results = await store.local_search("Who worked on the Analytical Engine?", top_k=3)
        assert results
        assert results[0].source == "graph"
        assert results[0].chunk.doc_id == "it-doc"
    finally:
        await store.delete_document("it-doc")
        await store.close()
