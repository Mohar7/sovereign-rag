from __future__ import annotations

import importlib

from sovereign_rag.api.settings.schemas import SettingsPatch
from sovereign_rag.config import get_settings

# ``sovereign_rag.api.settings.__init__`` re-exports ``router`` (the APIRouter),
# which shadows the submodule name — so ``import ...settings.router as r`` would
# bind the APIRouter, not the module. import_module returns the real module.
r = importlib.import_module("sovereign_rag.api.settings.router")


async def test_patch_embed_derives_dim_and_triggers_reembed(monkeypatch) -> None:
    persisted: dict[str, object] = {}
    launched = {"n": 0}

    async def fake_persist(changed: dict[str, object]) -> None:
        persisted.update(changed)

    monkeypatch.setattr(r, "persist_overrides", fake_persist)
    monkeypatch.setattr(r, "_launch_reembed", lambda: launched.__setitem__("n", launched["n"] + 1))

    s = get_settings()
    before = (s.embed_provider, s.openai_embed_model, s.embed_dim)
    try:
        await r.settings_patch(
            SettingsPatch(embed_provider="openai", openai_embed_model="text-embedding-3-large")
        )
        assert persisted["embed_dim"] == 3072  # derived from the model
        assert persisted["openai_embed_model"] == "text-embedding-3-large"
        assert launched["n"] == 1  # reembed kicked off
    finally:
        # restore the mutated singleton so we don't leak into other tests
        s.embed_provider, s.openai_embed_model, s.embed_dim = before
