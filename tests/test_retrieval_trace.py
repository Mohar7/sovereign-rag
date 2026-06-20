from __future__ import annotations

from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import Settings
from sovereign_rag.documents import Chunk, RetrievedChunk


def test_retrieval_trace_defaults_on() -> None:
    assert Settings().enable_retrieval_trace is True


def test_settings_patch_accepts_retrieval_trace() -> None:
    patch = SettingsPatch(enable_retrieval_trace=False)
    assert patch.model_dump(exclude_none=True) == {"enable_retrieval_trace": False}


def test_retrieved_chunk_origin_source_defaults_empty() -> None:
    chunk = Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")
    assert RetrievedChunk(chunk=chunk, score=1.0, source="graph").origin_source == ""
