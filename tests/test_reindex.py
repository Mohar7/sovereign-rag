from __future__ import annotations

from typing import Any

import pytest

from sovereign_rag import reindex
from sovereign_rag.documents import Chunk


async def test_reembed_busy_rejects_concurrent(monkeypatch) -> None:
    # The lock is the real mutex: holding it makes a concurrent call raise.
    async with reindex._LOCK:
        with pytest.raises(reindex.ReindexBusy):
            await reindex.reembed_corpus()


async def test_reembed_runs_and_reports(monkeypatch) -> None:
    calls = {"milvus_add": 0, "neo4j": 0, "wiped": 0}
    sample = [Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")]

    class FakeMilvus:
        async def export_chunks(self, **kw: Any) -> list[Chunk]:
            return sample

        async def ensure_collection(self) -> None: ...

        async def add_chunks(self, chunks: list[Chunk]) -> int:
            calls["milvus_add"] += len(chunks)
            return len(chunks)

        async def close(self) -> None: ...

    class FakeGraph:
        async def reembed_chunks(self, chunks: list[Chunk]) -> int:
            calls["neo4j"] += len(chunks)
            return len(chunks)

        async def close(self) -> None: ...

    async def fake_wipe() -> tuple[bool, int]:
        calls["wiped"] += 1
        return (True, 1)

    reindex._STATE.status = "idle"
    monkeypatch.setattr(reindex, "MilvusHybridStore", lambda **kw: FakeMilvus())
    monkeypatch.setattr(reindex, "Neo4jGraphStore", lambda **kw: FakeGraph())
    monkeypatch.setattr(reindex, "wipe_milvus", fake_wipe)
    monkeypatch.setattr(reindex, "bust_embeddings_cache", lambda: None)

    st = await reindex.reembed_corpus()
    assert st.status == "done"
    assert st.total == 1
    assert calls["milvus_add"] == 1 and calls["neo4j"] == 1 and calls["wiped"] == 1
