"""Destructive admin operations.

Wipe primitives shared by both the `/admin/wipe` HTTP endpoint and the
`scripts/wipe.py` CLI. Each `wipe_*` coroutine reports its own counts and
is safe to call against a freshly-installed stack — missing collections,
tables, or files are not errors, they just yield zero counts.

Operations:

* :func:`wipe_milvus` — drop the chunks collection (re-created lazily on
  the next ingest by ``MilvusHybridStore.ensure_collection``).
* :func:`wipe_neo4j` — ``MATCH (n) DETACH DELETE n`` on the configured
  database. Schema constraints/indexes remain (cheap to keep).
* :func:`wipe_threads_postgres` — TRUNCATE the LangGraph checkpoint
  tables in the configured ``langgraph_pg_uri`` database. Keeps the
  ``checkpoint_migrations`` row so the checkpointer doesn't re-migrate.
* :func:`wipe_thread_context_json` — delete the on-disk pins file.
* :func:`wipe_all` — orchestrator covering corpus + threads.

These are intentionally crude — full-collection drops, blanket DETACH
DELETE, full TRUNCATE. They are not meant for surgical cleanup; use the
existing per-document ``delete_document`` methods for that.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import TypedDict

from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)


class WipeReport(TypedDict):
    milvus_dropped: bool
    milvus_chunks_before: int
    neo4j_nodes_before: int
    neo4j_relationships_before: int
    neo4j_wiped: bool
    pg_threads_before: int
    pg_tables_truncated: list[str]
    pins_file_removed: bool
    pins_entries_removed: int


async def _milvus_chunk_count(collection: str) -> int:
    from pymilvus import AsyncMilvusClient

    s = get_settings()
    client = AsyncMilvusClient(uri=s.milvus_uri)
    try:
        if not await client.has_collection(collection):
            return 0
        # Lightweight stats — uses the loaded collection's row count.
        stats = await client.get_collection_stats(collection_name=collection)
        # pymilvus returns either {"row_count": "12345"} or {"row_count": 12345}.
        raw = stats.get("row_count", 0) if isinstance(stats, dict) else 0
        return int(raw)
    finally:
        await client.close()


async def wipe_milvus() -> tuple[bool, int]:
    """Drop the chunks collection. Returns ``(dropped, chunks_before)``."""
    from pymilvus import AsyncMilvusClient

    s = get_settings()
    before = await _milvus_chunk_count(s.milvus_collection)
    client = AsyncMilvusClient(uri=s.milvus_uri)
    try:
        if not await client.has_collection(s.milvus_collection):
            logger.info("Milvus collection %s absent — nothing to drop", s.milvus_collection)
            return (False, 0)
        # Releasing before dropping is good hygiene though not strictly required.
        try:
            await client.release_collection(collection_name=s.milvus_collection)
        except Exception:  # noqa: BLE001
            pass
        await client.drop_collection(collection_name=s.milvus_collection)
        logger.info("Dropped Milvus collection %s (had %d chunks)", s.milvus_collection, before)
        return (True, before)
    finally:
        await client.close()


async def _neo4j_counts() -> tuple[int, int]:
    from neo4j import AsyncGraphDatabase

    s = get_settings()
    driver = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    try:
        nodes_rec, _, _ = await driver.execute_query(
            "MATCH (n) RETURN count(n) AS c", database_=s.neo4j_database
        )
        rels_rec, _, _ = await driver.execute_query(
            "MATCH ()-[r]->() RETURN count(r) AS c", database_=s.neo4j_database
        )
        return (int(nodes_rec[0]["c"]) if nodes_rec else 0, int(rels_rec[0]["c"]) if rels_rec else 0)
    finally:
        await driver.close()


async def wipe_neo4j() -> tuple[bool, int, int]:
    """``DETACH DELETE`` every node. Returns ``(wiped, nodes_before, rels_before)``."""
    from neo4j import AsyncGraphDatabase

    s = get_settings()
    nodes_before, rels_before = await _neo4j_counts()
    driver = AsyncGraphDatabase.driver(s.neo4j_uri, auth=(s.neo4j_user, s.neo4j_password))
    try:
        # Single MATCH avoids loading the whole graph into memory.
        await driver.execute_query("MATCH (n) DETACH DELETE n", database_=s.neo4j_database)
        logger.info(
            "Wiped Neo4j: %d nodes, %d relationships removed", nodes_before, rels_before
        )
        return (True, nodes_before, rels_before)
    finally:
        await driver.close()


# LangGraph's postgres checkpointer creates these. We keep checkpoint_migrations
# so re-init on next ingest is a no-op rather than running migrations again.
_LG_TABLES = ("checkpoint_writes", "checkpoint_blobs", "checkpoints")


async def wipe_threads_postgres() -> tuple[int, list[str]]:
    """TRUNCATE the LangGraph thread/checkpoint tables.

    Returns ``(threads_before, truncated_tables)``. ``threads_before`` is
    the distinct ``thread_id`` count in ``checkpoints`` — zero if the
    table doesn't exist yet (first-run install)."""
    import psycopg

    s = get_settings()
    truncated: list[str] = []
    threads_before = 0
    async with await psycopg.AsyncConnection.connect(s.langgraph_pg_uri) as conn:
        async with conn.cursor() as cur:
            # Discover which of our target tables actually exist.
            await cur.execute(
                "SELECT table_name FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = ANY(%s)",
                (list(_LG_TABLES),),
            )
            existing = {row[0] for row in await cur.fetchall()}

            if "checkpoints" in existing:
                await cur.execute("SELECT count(DISTINCT thread_id) FROM checkpoints")
                row = await cur.fetchone()
                threads_before = int(row[0]) if row else 0

            for tbl in _LG_TABLES:
                if tbl in existing:
                    # TRUNCATE in dependency order — CASCADE keeps it simple.
                    await cur.execute(f"TRUNCATE TABLE {tbl} CASCADE")
                    truncated.append(tbl)
                    logger.info("Truncated %s", tbl)
        await conn.commit()
    return (threads_before, truncated)


def wipe_thread_context_json() -> tuple[bool, int]:
    """Remove the on-disk pins file. Returns ``(removed, entries_removed)``."""
    # Path layout matches sovereign_rag.thread_context._STORE_PATH:
    #   src/sovereign_rag/thread_context.py -> ../../../.runtime/thread_context.json
    here = Path(__file__).resolve().parent
    runtime = here.parent.parent / ".runtime"
    path = runtime / "thread_context.json"
    if not path.exists():
        return (False, 0)
    try:
        import json

        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
        entries = sum(len(v) for v in raw.values()) if isinstance(raw, dict) else 0
    except Exception:  # noqa: BLE001
        entries = 0
    path.unlink()
    logger.info("Removed pins file %s (%d entries)", path, entries)
    return (True, entries)


async def wipe_corpus() -> dict[str, object]:
    """Wipe Milvus chunks + Neo4j graph. Leaves threads / pins alone."""
    milvus_dropped, milvus_before = await wipe_milvus()
    neo4j_wiped, nodes_before, rels_before = await wipe_neo4j()
    return {
        "milvus_dropped": milvus_dropped,
        "milvus_chunks_before": milvus_before,
        "neo4j_wiped": neo4j_wiped,
        "neo4j_nodes_before": nodes_before,
        "neo4j_relationships_before": rels_before,
    }


async def wipe_threads() -> dict[str, object]:
    """Wipe LangGraph checkpoint tables + on-disk pins file."""
    threads_before, truncated = await wipe_threads_postgres()
    removed, entries = wipe_thread_context_json()
    return {
        "pg_threads_before": threads_before,
        "pg_tables_truncated": truncated,
        "pins_file_removed": removed,
        "pins_entries_removed": entries,
    }


async def wipe_all() -> WipeReport:
    """Full reset: corpus + threads. Order is: graph → vectors → threads → pins.

    Graph first so any in-flight retrieval that touched both stores can't
    surface orphan citations between the wipes."""
    neo4j_wiped, nodes_before, rels_before = await wipe_neo4j()
    milvus_dropped, milvus_before = await wipe_milvus()
    threads_before, truncated = await wipe_threads_postgres()
    pins_removed, pins_entries = wipe_thread_context_json()
    return WipeReport(
        milvus_dropped=milvus_dropped,
        milvus_chunks_before=milvus_before,
        neo4j_nodes_before=nodes_before,
        neo4j_relationships_before=rels_before,
        neo4j_wiped=neo4j_wiped,
        pg_threads_before=threads_before,
        pg_tables_truncated=truncated,
        pins_file_removed=pins_removed,
        pins_entries_removed=pins_entries,
    )


__all__ = [
    "WipeReport",
    "wipe_all",
    "wipe_corpus",
    "wipe_milvus",
    "wipe_neo4j",
    "wipe_thread_context_json",
    "wipe_threads",
    "wipe_threads_postgres",
]
