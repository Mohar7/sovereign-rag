from __future__ import annotations

import pytest

from sovereign_rag.embeddings_registry import EMBED_MODEL_DIMS, dim_for_model


def test_known_models_have_dims() -> None:
    assert EMBED_MODEL_DIMS["text-embedding-3-small"] == 1536
    assert EMBED_MODEL_DIMS["text-embedding-3-large"] == 3072
    assert EMBED_MODEL_DIMS["bge-m3"] == 1024


def test_dim_for_model_resolves() -> None:
    assert dim_for_model("openai", "text-embedding-3-small") == 1536
    assert dim_for_model("ollama", "bge-m3") == 1024


def test_dim_for_model_unknown_raises() -> None:
    with pytest.raises(ValueError):
        dim_for_model("openai", "not-a-model")
