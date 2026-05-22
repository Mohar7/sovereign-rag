"""Neo4j knowledge-graph store implementing GraphRAG local search.

Pipeline
--------
1. :meth:`Neo4jGraphStore.add_chunks` embeds each chunk, MERGEs a ``:Chunk``
   node carrying the embedding, then runs LLM entity/relationship extraction
   on the chunk's ``raw_text`` and MERGEs ``:Entity`` nodes, ``:RELATED``
   relationships, and ``:Chunk-[:MENTIONS]->:Entity`` edges.
2. :meth:`Neo4jGraphStore.local_search` embeds the query, finds seed chunks
   via the native vector index, then traverses the entity graph 1 hop out of
   each seed's mentioned entities to gather "related facts", which are
   appended to the seed chunk text before it is returned.

Design notes
------------
* Uses the **current** ``neo4j.AsyncGraphDatabase`` async driver and the
  driver-managed ``driver.execute_query(...)`` API (auto transaction +
  retry) — no manual session juggling.
* All Cypher is parameterized; no value is ever f-string-interpolated into a
  query. Index/constraint *names* and dimensions are validated/typed but the
  schema DDL is built once at construction from trusted config.
* Entity extraction uses ``ChatOllama.with_structured_output(Extraction)``
  (LangChain structured output backed by Ollama's JSON-schema mode). This
  deliberately avoids the deprecated ``LLMGraphTransformer`` from
  ``langchain-experimental`` (which conflicts with langchain 1.x).
* The native vector index is a Neo4j 5 Community feature, so no enterprise
  licence is required.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Final

from neo4j import AsyncDriver, AsyncGraphDatabase
from neo4j.exceptions import Neo4jError
from pydantic import BaseModel, Field

from sovereign_rag.config import get_settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.providers.ollama import embed_query, embed_texts, get_llm

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants — names are fixed (not user-controlled) so they are safe to embed
# directly in DDL. Everything else flows through query parameters.
# ---------------------------------------------------------------------------
CHUNK_VECTOR_INDEX: Final[str] = "chunk_embedding_index"
ENTITY_NAME_CONSTRAINT: Final[str] = "entity_name_unique"
CHUNK_ID_CONSTRAINT: Final[str] = "chunk_id_unique"

#: Default entity types the extractor is constrained to.
DEFAULT_ENTITY_TYPES: Final[tuple[str, ...]] = (
    "Person",
    "Organization",
    "Location",
    "Concept",
    "Technology",
    "Event",
)

#: Bound LLM concurrency so we don't overwhelm the local Ollama daemon.
_EXTRACTION_CONCURRENCY: Final[int] = 4

#: Chunks MERGEd per write round-trip.
_CHUNK_WRITE_BATCH: Final[int] = 50


# ---------------------------------------------------------------------------
# Structured-output models for LLM extraction
# ---------------------------------------------------------------------------
class ExtractedEntity(BaseModel):
    """A single entity mentioned in a chunk."""

    name: str = Field(description="The canonical surface name of the entity.")
    type: str = Field(
        description="The entity category, e.g. one of: "
        + ", ".join(DEFAULT_ENTITY_TYPES)
    )
    description: str = Field(
        default="",
        description="A short description of the entity grounded in the text.",
    )


class ExtractedRelation(BaseModel):
    """A directed relationship between two extracted entities."""

    source: str = Field(description="Name of the source entity (must appear in 'entities').")
    target: str = Field(description="Name of the target entity (must appear in 'entities').")
    type: str = Field(description="A short, UPPER_SNAKE_CASE relationship label.")
    description: str = Field(
        default="",
        description="A short fact describing the relationship, grounded in the text.",
    )


class Extraction(BaseModel):
    """Entities and relationships extracted from one chunk of text."""

    entities: list[ExtractedEntity] = Field(default_factory=list)
    relations: list[ExtractedRelation] = Field(default_factory=list)


_EXTRACTION_SYSTEM_PROMPT: Final[str] = (
    "You are an expert knowledge-graph extraction engine. Given a passage of "
    "text, extract the salient named entities and the relationships between "
    "them.\n\n"
    "Rules:\n"
    f"1. Classify each entity 'type' as one of: {', '.join(DEFAULT_ENTITY_TYPES)}. "
    "If none fits, use 'Concept'.\n"
    "2. Use the entity's most canonical surface form as 'name' (deduplicate "
    "aliases to a single name).\n"
    "3. For every relation, 'source' and 'target' MUST exactly match a 'name' "
    "you listed in 'entities'. Never invent entity names in relations.\n"
    "4. Use a concise UPPER_SNAKE_CASE label for relation 'type' "
    "(e.g. WORKS_FOR, LOCATED_IN, FOUNDED).\n"
    "5. Ground every description in the text; do not hallucinate facts.\n"
    "6. If the text contains no meaningful entities, return empty lists."
)


def _build_extraction_messages(text: str) -> list[tuple[str, str]]:
    """Build the (role, content) message list for an extraction call."""
    return [
        ("system", _EXTRACTION_SYSTEM_PROMPT),
        ("human", f"Extract entities and relationships from the following text:\n\n{text}"),
    ]


def _normalize_extraction(extraction: Extraction) -> Extraction:
    """Drop blank entities and any relation that references an unknown entity.

    The LLM occasionally emits relations whose endpoints aren't in the entity
    list (despite the prompt). We discard those to keep the graph consistent,
    and skip entities with empty names.
    """
    entities = [e for e in extraction.entities if e.name and e.name.strip()]
    valid_names = {e.name for e in entities}
    relations = [
        r
        for r in extraction.relations
        if r.source in valid_names and r.target in valid_names and r.type.strip()
    ]
    return Extraction(entities=entities, relations=relations)


# ---------------------------------------------------------------------------
# Cypher row → domain mapping helpers (factored out for unit testing)
# ---------------------------------------------------------------------------
def _format_related_facts(facts: list[str]) -> str:
    """Render a deduplicated 'Related facts:' block, or '' if none.

    Order is preserved (first occurrence wins) so output is deterministic.
    """
    seen: set[str] = set()
    ordered: list[str] = []
    for fact in facts:
        clean = fact.strip()
        if clean and clean not in seen:
            seen.add(clean)
            ordered.append(clean)
    if not ordered:
        return ""
    bullets = "\n".join(f"- {f}" for f in ordered)
    return f"Related facts:\n{bullets}"


def _enrich_chunk_text(raw_text: str, facts: list[str]) -> str:
    """Append a related-facts block to chunk text for the retriever output."""
    block = _format_related_facts(facts)
    if not block:
        return raw_text
    return f"{raw_text}\n\n{block}"


def _row_to_retrieved_chunk(row: dict[str, Any]) -> RetrievedChunk:
    """Map a ``local_search`` Cypher result row to a :class:`RetrievedChunk`.

    Expected keys: ``chunk_id``, ``doc_id``, ``text``, ``raw_text``,
    ``position``, ``page``, ``score``, ``facts`` (list[str]).
    """
    raw_text: str = row["raw_text"]
    facts: list[str] = row.get("facts") or []
    enriched = _enrich_chunk_text(raw_text, facts)
    chunk = Chunk(
        doc_id=row["doc_id"],
        text=enriched,
        raw_text=raw_text,
        position=int(row.get("position") or 0),
        page=row.get("page"),
        chunk_id=row["chunk_id"],
    )
    return RetrievedChunk(chunk=chunk, score=float(row["score"]), source="graph")


def _chunk_to_param(chunk: Chunk, embedding: list[float]) -> dict[str, Any]:
    """Flatten a chunk + its embedding into a Cypher parameter map."""
    return {
        "chunk_id": chunk.chunk_id,
        "doc_id": chunk.doc_id,
        "text": chunk.text,
        "raw_text": chunk.raw_text,
        "position": chunk.position,
        "page": chunk.page,
        "embedding": embedding,
    }


def _extraction_to_params(chunk_id: str, extraction: Extraction) -> dict[str, Any]:
    """Build the parameter map for the entity/relation MERGE query."""
    return {
        "chunk_id": chunk_id,
        "entities": [
            {"name": e.name, "type": e.type, "description": e.description}
            for e in extraction.entities
        ],
        "relations": [
            {
                "source": r.source,
                "target": r.target,
                "type": r.type,
                "description": r.description,
            }
            for r in extraction.relations
        ],
    }


# ---------------------------------------------------------------------------
# The store
# ---------------------------------------------------------------------------
class Neo4jGraphStore:
    """Async Neo4j-backed knowledge graph with GraphRAG local search."""

    def __init__(
        self,
        uri: str | None = None,
        user: str | None = None,
        password: str | None = None,
        database: str | None = None,
        embed_dim: int | None = None,
    ) -> None:
        s = get_settings()
        self._uri = uri or s.neo4j_uri
        self._auth = (user or s.neo4j_user, password or s.neo4j_password)
        self._database = database or s.neo4j_database
        self._embed_dim = embed_dim or s.embed_dim
        self._driver: AsyncDriver = AsyncGraphDatabase.driver(self._uri, auth=self._auth)

    # -- lifecycle ---------------------------------------------------------
    async def close(self) -> None:
        """Close the underlying async driver."""
        await self._driver.close()

    async def __aenter__(self) -> Neo4jGraphStore:
        return self

    async def __aexit__(self, *exc: object) -> None:
        await self.close()

    # -- schema ------------------------------------------------------------
    async def ensure_schema(self) -> None:
        """Create constraints and the native vector index idempotently.

        Uniqueness constraints are created with ``IF NOT EXISTS``; the vector
        index uses ``CREATE VECTOR INDEX ... IF NOT EXISTS`` with cosine
        similarity at the configured embedding dimension. Index/constraint
        names and the dimension are trusted config, not user input.
        """
        # Constraints implicitly back the MERGE lookups below.
        await self._driver.execute_query(
            f"CREATE CONSTRAINT {CHUNK_ID_CONSTRAINT} IF NOT EXISTS "
            "FOR (c:Chunk) REQUIRE c.chunk_id IS UNIQUE",
            database_=self._database,
        )
        await self._driver.execute_query(
            f"CREATE CONSTRAINT {ENTITY_NAME_CONSTRAINT} IF NOT EXISTS "
            "FOR (e:Entity) REQUIRE e.name IS UNIQUE",
            database_=self._database,
        )
        # Native vector index (Neo4j 5 Community). Dimension is an int from
        # config; embedded via str() of a validated int, never user text.
        await self._driver.execute_query(
            f"CREATE VECTOR INDEX {CHUNK_VECTOR_INDEX} IF NOT EXISTS "
            "FOR (c:Chunk) ON c.embedding "
            "OPTIONS {indexConfig: {"
            f"`vector.dimensions`: {int(self._embed_dim)}, "
            "`vector.similarity_function`: 'cosine'"
            "}}",
            database_=self._database,
        )
        logger.info(
            "Neo4j schema ensured (vector index %s, dim=%d)",
            CHUNK_VECTOR_INDEX,
            self._embed_dim,
        )

    # -- extraction --------------------------------------------------------
    async def _extract(self, text: str) -> Extraction:
        """Extract entities and relations from text via structured output.

        Returns an empty :class:`Extraction` on any failure (the chunk is
        still indexed for vector search; only its graph edges are skipped).
        """
        if not text or not text.strip():
            return Extraction()
        structured_llm = get_llm().with_structured_output(Extraction)
        try:
            result = await structured_llm.ainvoke(_build_extraction_messages(text))
        except (Neo4jError, ValueError, TypeError, KeyError) as exc:
            logger.warning("Entity extraction failed, skipping graph edges: %s", exc)
            return Extraction()
        except Exception as exc:  # never let extraction kill ingestion
            logger.warning("Entity extraction raised %s, skipping graph edges", type(exc).__name__)
            return Extraction()
        if not isinstance(result, Extraction):
            # with_structured_output should return our model, but be defensive.
            logger.warning("Extraction returned unexpected type %s", type(result).__name__)
            return Extraction()
        return _normalize_extraction(result)

    # -- ingestion ---------------------------------------------------------
    async def add_chunks(self, chunks: list[Chunk]) -> int:
        """Index chunks: embed, MERGE nodes, extract + MERGE graph edges.

        Returns the number of chunks processed.
        """
        if not chunks:
            return 0

        # 1. Embed all chunk texts in one batched call.
        embeddings = await embed_texts([c.text for c in chunks])
        if len(embeddings) != len(chunks):
            raise ValueError(
                f"Embedding count mismatch: {len(embeddings)} != {len(chunks)} chunks"
            )

        # 2. MERGE chunk nodes (with embeddings) in batches.
        chunk_params = [
            _chunk_to_param(chunk, emb) for chunk, emb in zip(chunks, embeddings, strict=True)
        ]
        for start in range(0, len(chunk_params), _CHUNK_WRITE_BATCH):
            batch = chunk_params[start : start + _CHUNK_WRITE_BATCH]
            await self._driver.execute_query(
                """
                UNWIND $chunks AS ch
                MERGE (c:Chunk {chunk_id: ch.chunk_id})
                SET c.doc_id = ch.doc_id,
                    c.text = ch.text,
                    c.raw_text = ch.raw_text,
                    c.position = ch.position,
                    c.page = ch.page,
                    c.embedding = ch.embedding
                """,
                chunks=batch,
                database_=self._database,
            )

        # 3. Extract entities/relations concurrently (bounded), then MERGE.
        semaphore = asyncio.Semaphore(_EXTRACTION_CONCURRENCY)

        async def _extract_bounded(chunk: Chunk) -> tuple[str, Extraction]:
            async with semaphore:
                return chunk.chunk_id, await self._extract(chunk.raw_text)

        extractions = await asyncio.gather(*(_extract_bounded(c) for c in chunks))

        for chunk_id, extraction in extractions:
            if not extraction.entities:
                continue
            await self._write_extraction(chunk_id, extraction)

        logger.info("Indexed %d chunks into Neo4j", len(chunks))
        return len(chunks)

    async def _write_extraction(self, chunk_id: str, extraction: Extraction) -> None:
        """MERGE entities, MENTIONS edges, and RELATED relationships."""
        params = _extraction_to_params(chunk_id, extraction)
        # Entities + MENTIONS. coalesce keeps the first non-empty description.
        await self._driver.execute_query(
            """
            MATCH (c:Chunk {chunk_id: $chunk_id})
            UNWIND $entities AS ent
            MERGE (e:Entity {name: ent.name})
            SET e.type = coalesce(e.type, ent.type),
                e.description = CASE
                    WHEN coalesce(e.description, '') = '' THEN ent.description
                    ELSE e.description END
            MERGE (c)-[:MENTIONS]->(e)
            """,
            chunk_id=params["chunk_id"],
            entities=params["entities"],
            database_=self._database,
        )
        if not params["relations"]:
            return
        # RELATED relationships between already-MERGEd entities.
        await self._driver.execute_query(
            """
            UNWIND $relations AS rel
            MATCH (s:Entity {name: rel.source})
            MATCH (t:Entity {name: rel.target})
            MERGE (s)-[r:RELATED {type: rel.type}]->(t)
            SET r.description = CASE
                WHEN coalesce(r.description, '') = '' THEN rel.description
                ELSE r.description END
            """,
            relations=params["relations"],
            database_=self._database,
        )

    # -- retrieval ---------------------------------------------------------
    async def local_search(
        self, query: str, top_k: int | None = None
    ) -> list[RetrievedChunk]:
        """GraphRAG local search.

        Embed the query, vector-search seed chunks, then for each seed gather
        the 1-hop neighborhood of its mentioned entities and append the
        relation facts as a "Related facts:" block. Score is the vector
        similarity (0..1, cosine) from the index.
        """
        k = top_k if top_k is not None else get_settings().retrieve_top_k
        if k <= 0:
            return []
        query_embedding = await embed_query(query)

        records, _summary, _keys = await self._driver.execute_query(
            """
            CALL db.index.vector.queryNodes($index_name, $k, $embedding)
            YIELD node AS c, score
            // 1-hop entity neighborhood of each seed chunk's mentioned entities
            OPTIONAL MATCH (c)-[:MENTIONS]->(e:Entity)
            OPTIONAL MATCH (e)-[r:RELATED]-(neighbor:Entity)
            WITH c, score,
                 collect(DISTINCT
                     CASE WHEN r IS NULL THEN null
                     ELSE startNode(r).name + ' ' + r.type + ' ' + endNode(r).name +
                          CASE WHEN coalesce(r.description, '') = '' THEN ''
                               ELSE ' (' + r.description + ')' END
                     END
                 ) AS rel_facts,
                 collect(DISTINCT
                     CASE WHEN e IS NULL OR coalesce(e.description, '') = '' THEN null
                     ELSE e.name + ': ' + e.description END
                 ) AS ent_facts
            WITH c, score,
                 [f IN (rel_facts + ent_facts) WHERE f IS NOT NULL] AS facts
            RETURN c.chunk_id   AS chunk_id,
                   c.doc_id     AS doc_id,
                   c.text       AS text,
                   c.raw_text   AS raw_text,
                   c.position   AS position,
                   c.page       AS page,
                   score        AS score,
                   facts        AS facts
            ORDER BY score DESC
            """,
            index_name=CHUNK_VECTOR_INDEX,
            k=k,
            embedding=query_embedding,
            routing_="r",
            database_=self._database,
        )
        return [_row_to_retrieved_chunk(dict(r)) for r in records]

    # -- deletion ----------------------------------------------------------
    async def delete_document(self, doc_id: str) -> None:
        """Detach-delete a document's chunks and any now-orphaned entities."""
        await self._driver.execute_query(
            """
            MATCH (c:Chunk {doc_id: $doc_id})
            DETACH DELETE c
            """,
            doc_id=doc_id,
            database_=self._database,
        )
        # Remove entities no longer mentioned by any chunk.
        await self._driver.execute_query(
            """
            MATCH (e:Entity)
            WHERE NOT (e)<-[:MENTIONS]-(:Chunk)
            DETACH DELETE e
            """,
            database_=self._database,
        )
        logger.info("Deleted document %s and pruned orphaned entities", doc_id)


__all__ = [
    "DEFAULT_ENTITY_TYPES",
    "ExtractedEntity",
    "ExtractedRelation",
    "Extraction",
    "Neo4jGraphStore",
]
