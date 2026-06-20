from __future__ import annotations

from sovereign_rag.vectorstore.milvus_store import row_to_chunk


def test_row_to_chunk_roundtrips_fields() -> None:
    row = {
        "chunk_id": "c1",
        "text": "ctx body",
        "doc_id": "d1",
        "page": -1,
        "position": 3,
        "raw_text": "body",
        "title": "T",
        "source_uri": "u",
    }
    c = row_to_chunk(row)
    assert c.chunk_id == "c1"
    assert c.doc_id == "d1"
    assert c.text == "ctx body"
    assert c.raw_text == "body"
    assert c.position == 3
    assert c.page is None  # -1 sentinel -> None
    assert c.metadata["title"] == "T"
    assert c.metadata["source_uri"] == "u"
