"""``/api/graph/*`` — knowledge graph explorer.

Three reads over the Neo4j store the indexer already populates:

- :func:`graph_stats` — total entities / relations / mention edges. Powers
  the empty-state copy on the Graph page.
- :func:`graph_entities` — name-substring search over ``:Entity`` nodes with
  mention counts. Powers the autocomplete on the seed picker.
- :func:`graph_neighborhood` — BFS out from a seed entity to a configurable
  depth, returning a :class:`Neighborhood` (``nodes`` + ``edges``) ready for
  client-side force-directed layout.

Schema reminder (see ``graph/neo4j_store.py:_write_extraction``):

- ``(c:Chunk)-[:MENTIONS]->(e:Entity)``
- ``(e1:Entity)-[r:RELATED {type, description}]->(e2:Entity)``

Entities are keyed by ``name`` (UNIQUE constraint at index time).
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sovereign_rag.api.dependencies import PipelineDep

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/graph", tags=["graph"])


# ─────────────────────────────────────────────────────────────────
# schemas
# ─────────────────────────────────────────────────────────────────


class GraphStats(BaseModel):
    entities: int
    relations: int
    mentions: int


class EntityRow(BaseModel):
    name: str
    type: str | None = None
    description: str | None = None
    mentions: int = 0


class GraphNode(BaseModel):
    """One entity for the explorer.

    ``mentions`` is the count of ``:Chunk-[:MENTIONS]`` edges into the node
    — useful both for sizing the rendered glyph and for biasing the layout.
    ``distance`` is the BFS hop count from the seed (0 for the seed itself).
    """

    id: str
    label: str
    type: str | None = None
    description: str | None = None
    mentions: int = 0
    distance: int = 0


class GraphEdge(BaseModel):
    """One ``:RELATED`` edge between two entities.

    ``source`` / ``target`` are entity names (which match :class:`GraphNode.id`).
    """

    source: str
    target: str
    type: str = ""
    description: str | None = None


class Neighborhood(BaseModel):
    seed: str
    depth: int
    nodes: list[GraphNode] = Field(default_factory=list)
    edges: list[GraphEdge] = Field(default_factory=list)


# ─────────────────────────────────────────────────────────────────
# helpers
# ─────────────────────────────────────────────────────────────────


def _graph_driver(pipe: object) -> tuple[Any, str]:
    """Return ``(driver, database)`` from the pipeline, or 503 if unset.

    The :class:`Neo4jGraphStore` instance is private to the pipeline, but its
    ``_driver`` / ``_database`` are the canonical handles we need here. The
    router doesn't re-open its own driver because we'd duplicate connection
    pools and miss out on the lifespan shutdown.
    """
    graph = getattr(pipe, "_graph", None)
    if graph is None:
        raise HTTPException(503, "Graph store unavailable (enable_graph_retrieval=false?)")
    driver = getattr(graph, "_driver", None)
    database = getattr(graph, "_database", "neo4j")
    if driver is None:
        raise HTTPException(503, "Graph driver not initialised")
    return driver, str(database)


# ─────────────────────────────────────────────────────────────────
# routes
# ─────────────────────────────────────────────────────────────────


@router.get("/stats", response_model=GraphStats)
async def graph_stats(pipe: PipelineDep) -> GraphStats:
    """Cheap counts for the Graph empty state."""
    driver, db = _graph_driver(pipe)
    rows, _, _ = await driver.execute_query(
        """
        OPTIONAL MATCH (e:Entity)
        WITH count(e) AS entities
        OPTIONAL MATCH ()-[r:RELATED]->()
        WITH entities, count(r) AS relations
        OPTIONAL MATCH ()-[m:MENTIONS]->()
        RETURN entities, relations, count(m) AS mentions
        """,
        database_=db,
    )
    if not rows:
        return GraphStats(entities=0, relations=0, mentions=0)
    row = rows[0]
    return GraphStats(
        entities=int(row["entities"] or 0),
        relations=int(row["relations"] or 0),
        mentions=int(row["mentions"] or 0),
    )


@router.get("/entities", response_model=list[EntityRow])
async def graph_entities(
    pipe: PipelineDep,
    q: str = Query("", description="name-substring filter (case-insensitive)"),
    limit: int = Query(20, ge=1, le=200),
) -> list[EntityRow]:
    """List entities with mention counts, optionally name-filtered."""
    driver, db = _graph_driver(pipe)
    where = "WHERE toLower(e.name) CONTAINS toLower($q)" if q else ""
    cypher = f"""
        MATCH (e:Entity)
        {where}
        OPTIONAL MATCH (:Chunk)-[m:MENTIONS]->(e)
        WITH e, count(m) AS mentions
        RETURN e.name AS name, e.type AS type, e.description AS description, mentions
        ORDER BY mentions DESC, e.name ASC
        LIMIT $limit
    """
    rows, _, _ = await driver.execute_query(cypher, q=q, limit=limit, database_=db)
    return [
        EntityRow(
            name=r["name"],
            type=r["type"],
            description=r["description"],
            mentions=int(r["mentions"] or 0),
        )
        for r in rows
    ]


@router.get("/neighborhood", response_model=Neighborhood)
async def graph_neighborhood(
    pipe: PipelineDep,
    seed: str = Query(..., min_length=1, description="entity name to expand from"),
    depth: int = Query(2, ge=1, le=4),
    limit: int = Query(80, ge=1, le=500, description="hard cap on returned nodes"),
) -> Neighborhood:
    """Return the ``depth``-hop neighborhood around ``seed``.

    The query uses a variable-length pattern ``(seed)-[:RELATED*1..depth]-(other)``
    to fan out, then materialises the edges between any pair of collected nodes
    (so the rendered graph carries every edge among the visible nodes, not just
    the BFS-tree edges).
    """
    driver, db = _graph_driver(pipe)

    # First confirm the seed exists. 404 if not — cheaper than running the
    # expansion against a typo.
    seed_rows, _, _ = await driver.execute_query(
        """
        MATCH (e:Entity {name: $seed})
        OPTIONAL MATCH (:Chunk)-[m:MENTIONS]->(e)
        RETURN e.name AS name, e.type AS type, e.description AS description,
               count(m) AS mentions
        """,
        seed=seed,
        database_=db,
    )
    if not seed_rows:
        raise HTTPException(404, f"Entity {seed!r} not found")
    seed_row = seed_rows[0]

    # Expand to N hops. APOC's path expander would be cleaner but we avoid the
    # dependency: variable-length pattern + collect handles ~200 nodes fine.
    # Direction is undirected (:RELATED is directed in storage but for the
    # *visualisation* we want to see neighbours regardless of arrow direction).
    expand = f"""
        MATCH (seed:Entity {{name: $seed}})
        OPTIONAL MATCH path = (seed)-[:RELATED*1..{depth}]-(other:Entity)
        WITH collect(DISTINCT seed) + collect(DISTINCT other) AS raw_nodes
        UNWIND raw_nodes AS e
        WITH DISTINCT e WHERE e IS NOT NULL
        WITH collect(e) AS nodes
        // Collect every RELATED edge between any pair of visible nodes.
        UNWIND nodes AS a
        OPTIONAL MATCH (a)-[r:RELATED]-(b:Entity) WHERE b IN nodes
        // Re-issue MENTIONS counts for the visible nodes in one round-trip.
        OPTIONAL MATCH (:Chunk)-[m:MENTIONS]->(a)
        WITH a, collect(DISTINCT {{src: startNode(r).name, dst: endNode(r).name,
                                   type: r.type, description: r.description}}) AS edges_raw,
             count(m) AS mentions
        RETURN a.name AS name, a.type AS type, a.description AS description,
               mentions, edges_raw
        LIMIT $limit
    """
    rows, _, _ = await driver.execute_query(expand, seed=seed, limit=limit, database_=db)

    nodes_by_name: dict[str, GraphNode] = {
        seed_row["name"]: GraphNode(
            id=seed_row["name"],
            label=seed_row["name"],
            type=seed_row["type"],
            description=seed_row["description"],
            mentions=int(seed_row["mentions"] or 0),
            distance=0,
        ),
    }
    edges_seen: set[tuple[str, str, str]] = set()
    edges: list[GraphEdge] = []
    for r in rows:
        name = r["name"]
        if name not in nodes_by_name:
            nodes_by_name[name] = GraphNode(
                id=name,
                label=name,
                type=r["type"],
                description=r["description"],
                mentions=int(r["mentions"] or 0),
                # We don't have a true BFS distance from this query — mark
                # every non-seed node as 1; a follow-up could surface real
                # hop counts via APOC.
                distance=1,
            )
        for edge in r["edges_raw"] or []:
            src = edge.get("src")
            dst = edge.get("dst")
            etype = edge.get("type") or ""
            if not src or not dst or src == dst:
                continue
            # Edges are undirected for the picture; canonicalise so we don't
            # double-count A->B and B->A.
            key = (min(src, dst), max(src, dst), etype)
            if key in edges_seen:
                continue
            edges_seen.add(key)
            edges.append(
                GraphEdge(
                    source=src,
                    target=dst,
                    type=etype,
                    description=edge.get("description"),
                ),
            )
    return Neighborhood(
        seed=seed,
        depth=depth,
        nodes=list(nodes_by_name.values()),
        edges=edges,
    )


__all__ = ["router"]
