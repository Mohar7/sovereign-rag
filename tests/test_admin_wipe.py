"""Unit tests for the destructive wipe primitives (no real services).

``wipe_neo4j`` must drop the dim-dependent vector index in addition to the
nodes — otherwise an embed-model/dimension change leaves a stale index that
silently breaks graph retrieval. We assert the exact Cypher is issued by
faking the neo4j async driver.
"""

from __future__ import annotations

import neo4j
import pytest

from sovereign_rag import admin
from sovereign_rag.graph.neo4j_store import CHUNK_VECTOR_INDEX


class _FakeDriver:
    """Records every Cypher statement; returns zero counts for count queries."""

    def __init__(self) -> None:
        self.queries: list[str] = []

    async def execute_query(self, query: str, *, database_: str | None = None, **_: object):
        self.queries.append(query)
        if "count(n)" in query or "count(r)" in query:
            return ([{"c": 0}], None, None)
        return ([], None, None)

    async def close(self) -> None:
        return None


@pytest.fixture
def captured_drivers(monkeypatch: pytest.MonkeyPatch) -> list[_FakeDriver]:
    drivers: list[_FakeDriver] = []

    def _fake_driver(_uri: str, *, auth: object = None, **_: object) -> _FakeDriver:
        d = _FakeDriver()
        drivers.append(d)
        return d

    monkeypatch.setattr(neo4j.AsyncGraphDatabase, "driver", _fake_driver)
    return drivers


async def test_wipe_neo4j_drops_vector_index(captured_drivers: list[_FakeDriver]) -> None:
    wiped, nodes_before, rels_before = await admin.wipe_neo4j()

    assert wiped is True
    assert nodes_before == 0
    assert rels_before == 0

    all_queries = [q for d in captured_drivers for q in d.queries]
    assert any("MATCH (n) DETACH DELETE n" in q for q in all_queries)
    # The dim-pinned vector index must be dropped (idempotent IF EXISTS).
    assert any(f"DROP INDEX {CHUNK_VECTOR_INDEX} IF EXISTS" in q for q in all_queries)
