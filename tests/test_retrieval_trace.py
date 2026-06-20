from __future__ import annotations

from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import Settings


def test_retrieval_trace_defaults_on() -> None:
    assert Settings().enable_retrieval_trace is True


def test_settings_patch_accepts_retrieval_trace() -> None:
    patch = SettingsPatch(enable_retrieval_trace=False)
    assert patch.model_dump(exclude_none=True) == {"enable_retrieval_trace": False}
