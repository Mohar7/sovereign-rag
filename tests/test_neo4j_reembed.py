from __future__ import annotations

from typing import Any

from sovereign_rag.documents import Chunk
from sovereign_rag.graph import neo4j_store as ns


class _Drv:
    def __init__(self) -> None:
        self.queries: list[str] = []

    async def execute_query(self, q: str, *, database_: str | None = None, **kw: Any):
        self.queries.append(q)
        return ([], None, None)

    async def close(self) -> None:
        return None


async def test_reembed_drops_recreates_index_and_sets_embeddings(monkeypatch) -> None:
    async def fake_embed(texts: list[str]) -> list[list[float]]:
        return [[0.1] * 4 for _ in texts]

    monkeypatch.setattr(ns, "embed_texts", fake_embed)
    drv = _Drv()
    store = ns.Neo4jGraphStore(driver=drv, embed_dim=4)
    n = await store.reembed_chunks(
        [Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")]
    )
    assert n == 1
    joined = " ".join(drv.queries)
    assert "DROP INDEX chunk_embedding_index IF EXISTS" in joined
    assert "CREATE VECTOR INDEX" in joined
    assert "setNodeVectorProperty" in joined
