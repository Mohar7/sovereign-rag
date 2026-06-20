from __future__ import annotations

import pytest
from pydantic import ValidationError

from sovereign_rag.api.settings.schemas import EMBED_FIELDS, SettingsPatch


def test_patch_accepts_embed_fields() -> None:
    p = SettingsPatch(embed_provider="openai", openai_embed_model="text-embedding-3-large")
    d = p.model_dump(exclude_none=True)
    assert d["embed_provider"] == "openai"
    assert d["openai_embed_model"] == "text-embedding-3-large"


def test_embed_fields_set() -> None:
    assert {"embed_provider", "openai_embed_model", "embed_model"} <= EMBED_FIELDS


def test_patch_rejects_bad_provider() -> None:
    with pytest.raises(ValidationError):
        SettingsPatch(embed_provider="bogus")
