# Admin-Editable Embeddings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin change the embedding provider/model from the Settings UI (DB-persisted), with a guarded re-embed migration that rebuilds Milvus + Neo4j at the new dimension.

**Architecture:** Embeddings become a `SettingsPatch` field like the LLM settings, but `embed_dim` is *derived* from a model→dim registry, and a PATCH that touches an embed field launches a background `reembed_corpus()` (export chunk text from Milvus → recreate both stores at the new dim → re-embed). A process-global `ReindexState` + lock exposes progress at `GET /api/reindex/status`; the UI confirms + polls it.

**Tech Stack:** Python 3.12, FastAPI, pydantic-settings, pymilvus (AsyncMilvusClient), neo4j (AsyncGraphDatabase), React 19 + TS + i18next + vitest.

## Global Constraints

- `embed_dim` is NEVER user-set directly — derived from `EMBED_MODEL_DIMS` (`text-embedding-3-small`→1536, `text-embedding-3-large`→3072, `bge-m3`→1024).
- Secrets (`*_api_key`) + wiring (`*_uri`, passwords) stay env-only; never in `SettingsPatch`/DB.
- One reindex at a time (a lock); a PATCH touching embeds while a reindex runs → HTTP 409.
- Graph entities/relations are preserved on reembed — only `Chunk.embedding` is recomputed + the vector index recreated. No re-chunking, no entity re-extraction.
- Re-embed source is the stored Milvus `text` field — no original files.
- Gates: `uv run ruff check src/ tests/ eval/` + `ruff format --check` + `mypy src/` + `pytest -m "not integration"`; frontend `tsc -b` + `vitest run` + `npm run build`.
- Commit AS the user, NO `Co-Authored-By` footer.

---

### Task 1: Embedding model→dim registry

**Files:**
- Create: `src/sovereign_rag/embeddings_registry.py`
- Test: `tests/test_embeddings_registry.py`

**Interfaces:**
- Produces: `EMBED_MODEL_DIMS: dict[str, int]`; `EMBED_MODELS: list[EmbedModelChoice]`; `dim_for_model(provider: str, model: str) -> int` (raises `ValueError` on unknown model).

- [ ] **Step 1: Failing test**
```python
# tests/test_embeddings_registry.py
import pytest
from sovereign_rag.embeddings_registry import EMBED_MODEL_DIMS, dim_for_model

def test_known_models_have_dims():
    assert EMBED_MODEL_DIMS["text-embedding-3-small"] == 1536
    assert EMBED_MODEL_DIMS["text-embedding-3-large"] == 3072
    assert EMBED_MODEL_DIMS["bge-m3"] == 1024

def test_dim_for_model_resolves():
    assert dim_for_model("openai", "text-embedding-3-small") == 1536
    assert dim_for_model("ollama", "bge-m3") == 1024

def test_dim_for_model_unknown_raises():
    with pytest.raises(ValueError):
        dim_for_model("openai", "not-a-model")
```

- [ ] **Step 2: Run — FAIL** (`uv run pytest tests/test_embeddings_registry.py -q`) → ModuleNotFound.

- [ ] **Step 3: Implement**
```python
# src/sovereign_rag/embeddings_registry.py
"""Embedding model catalog. embed_dim is DERIVED from the model, never set by hand."""
from __future__ import annotations
from dataclasses import dataclass

EMBED_MODEL_DIMS: dict[str, int] = {
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "bge-m3": 1024,
}

@dataclass(frozen=True, slots=True)
class EmbedModelChoice:
    id: str
    provider: str  # "openai" | "ollama"
    dim: int
    label: str

EMBED_MODELS: list[EmbedModelChoice] = [
    EmbedModelChoice("text-embedding-3-small", "openai", 1536, "OpenAI 3-small (1536)"),
    EmbedModelChoice("text-embedding-3-large", "openai", 3072, "OpenAI 3-large (3072)"),
    EmbedModelChoice("bge-m3", "ollama", 1024, "bge-m3 local (1024)"),
]

def dim_for_model(provider: str, model: str) -> int:
    try:
        return EMBED_MODEL_DIMS[model]
    except KeyError as exc:
        raise ValueError(f"unknown embedding model {model!r} for provider {provider!r}") from exc

__all__ = ["EMBED_MODELS", "EMBED_MODEL_DIMS", "EmbedModelChoice", "dim_for_model"]
```

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit** — `git add src/sovereign_rag/embeddings_registry.py tests/test_embeddings_registry.py && git commit -m "feat(embeddings): model->dim registry"`

---

### Task 2: SettingsPatch embed fields + EMBED_FIELDS + embeddings cache-bust

**Files:**
- Modify: `src/sovereign_rag/api/settings/schemas.py` (add embed fields + `EMBED_FIELDS`)
- Modify: `src/sovereign_rag/api/settings/service.py` (add `bust_embeddings_cache`; bust it in `load_and_apply_overrides`)
- Test: `tests/test_settings_embed_patch.py`

**Interfaces:**
- Produces: `SettingsPatch.embed_provider`, `.openai_embed_model`, `.embed_model`; `EMBED_FIELDS: frozenset[str]`; `service.bust_embeddings_cache() -> None`.

- [ ] **Step 1: Failing test**
```python
# tests/test_settings_embed_patch.py
from sovereign_rag.api.settings.schemas import EMBED_FIELDS, SettingsPatch

def test_patch_accepts_embed_fields():
    p = SettingsPatch(embed_provider="openai", openai_embed_model="text-embedding-3-large")
    d = p.model_dump(exclude_none=True)
    assert d["embed_provider"] == "openai"
    assert d["openai_embed_model"] == "text-embedding-3-large"

def test_embed_fields_set():
    assert {"embed_provider", "openai_embed_model", "embed_model"} <= EMBED_FIELDS

def test_patch_rejects_bad_provider():
    import pytest
    from pydantic import ValidationError
    with pytest.raises(ValidationError):
        SettingsPatch(embed_provider="bogus")
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — in `schemas.py` add to `SettingsPatch` (after the LLM block):
```python
    # Embeddings (changing these triggers a re-embed migration). embed_dim is
    # DERIVED from the model, never patched directly.
    embed_provider: str | None = Field(default=None, pattern="^(openai|ollama)$")
    openai_embed_model: str | None = Field(default=None, max_length=200)
    embed_model: str | None = Field(default=None, max_length=200)
```
Add after `LLM_FIELDS`:
```python
EMBED_FIELDS: frozenset[str] = frozenset({"embed_provider", "openai_embed_model", "embed_model"})
```
Add `"EMBED_FIELDS"` to `__all__`.
In `service.py` add:
```python
def bust_embeddings_cache() -> None:
    """Clear the get_embeddings lru_cache so the next embed uses the new model."""
    try:
        from sovereign_rag.providers.ollama import get_embeddings
        get_embeddings.cache_clear()
        logger.info("get_embeddings cache cleared")
    except Exception as exc:  # pragma: no cover
        logger.warning("could not clear embeddings cache: %s", exc)
```
In `load_and_apply_overrides`, after the LLM-cache bust add:
```python
    from sovereign_rag.api.settings.schemas import EMBED_FIELDS
    if any(field in EMBED_FIELDS for field in applied):
        bust_embeddings_cache()
```
Add `bust_embeddings_cache` to `service.__all__`.

- [ ] **Step 4: Run — PASS** (`uv run pytest tests/test_settings_embed_patch.py -q`).

- [ ] **Step 5: Commit** — `git commit -am "feat(settings): embed fields patchable + embeddings cache-bust"`

---

### Task 3: Milvus `export_chunks` (read all chunks back)

**Files:**
- Modify: `src/sovereign_rag/vectorstore/milvus_store.py` (add `export_chunks`; add a `row_to_chunk` pure helper next to `chunk_to_row`)
- Test: `tests/test_milvus_export.py`

**Interfaces:**
- Consumes: `Chunk` (doc_id, text, raw_text, position, page, chunk_id, metadata).
- Produces: `row_to_chunk(row: dict) -> Chunk` (pure); `MilvusHybridStore.export_chunks() -> list[Chunk]` (paginated `client.query`, no vectors).

- [ ] **Step 1: Failing test (pure helper, hermetic)**
```python
# tests/test_milvus_export.py
from sovereign_rag.vectorstore.milvus_store import row_to_chunk

def test_row_to_chunk_roundtrips_fields():
    row = {"chunk_id": "c1", "text": "ctx body", "doc_id": "d1", "page": -1,
           "position": 3, "raw_text": "body", "title": "T", "source_uri": "u"}
    c = row_to_chunk(row)
    assert c.chunk_id == "c1" and c.doc_id == "d1" and c.text == "ctx body"
    assert c.raw_text == "body" and c.position == 3
    assert c.page is None  # -1 sentinel -> None
    assert c.metadata["title"] == "T" and c.metadata["source_uri"] == "u"
```

- [ ] **Step 2: Run — FAIL** (no `row_to_chunk`).

- [ ] **Step 3: Implement** — in `milvus_store.py`, next to `chunk_to_row` (uses the existing `_PAGE_NONE` sentinel = -1):
```python
def row_to_chunk(row: dict[str, Any]) -> Chunk:
    """Inverse of chunk_to_row (minus the vectors) — reconstruct a Chunk."""
    page = row.get(_F_PAGE, _PAGE_NONE)
    return Chunk(
        doc_id=str(row.get(_F_DOC_ID, "")),
        text=str(row.get(_F_TEXT, "")),
        raw_text=str(row.get(_F_RAW_TEXT, "")),
        position=int(row.get(_F_POSITION, 0)),
        page=None if page == _PAGE_NONE else int(page),
        chunk_id=str(row.get(_F_CHUNK_ID, "")),
        metadata={"title": str(row.get(_F_TITLE, "")), "source_uri": str(row.get(_F_SOURCE_URI, ""))},
    )
```
Add the method to `MilvusHybridStore` (after `delete_document`):
```python
    async def export_chunks(self, *, batch: int = 1000) -> list[Chunk]:
        """Read every chunk back (text + metadata, no vectors) for re-embedding."""
        if not await self._client.has_collection(self._collection):
            return []
        await self.ensure_collection()
        fields = [_F_CHUNK_ID, _F_TEXT, _F_DOC_ID, _F_PAGE, _F_POSITION,
                  _F_RAW_TEXT, _F_TITLE, _F_SOURCE_URI]
        out: list[Chunk] = []
        offset = 0
        while True:
            rows = await self._client.query(
                collection_name=self._collection,
                filter="",
                output_fields=fields,
                limit=batch,
                offset=offset,
            )
            if not rows:
                break
            out.extend(row_to_chunk(r) for r in rows)
            if len(rows) < batch:
                break
            offset += batch
        return out
```
Export `row_to_chunk` in `__all__`.

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(milvus): export_chunks + row_to_chunk for re-embedding"`

---

### Task 4: Neo4j `reembed_chunks` (recompute Chunk.embedding, recreate index)

**Files:**
- Modify: `src/sovereign_rag/graph/neo4j_store.py` (add `reembed_chunks`)
- Test: `tests/test_neo4j_reembed.py` (hermetic — fake driver + monkeypatched embed)

**Interfaces:**
- Consumes: `Chunk` list, `embed_texts`.
- Produces: `Neo4jGraphStore.reembed_chunks(chunks: list[Chunk]) -> int` — drops + recreates the vector index at the current `embed_dim`, then sets `c.embedding` for each chunk_id (batched), returns count updated.

- [ ] **Step 1: Failing test**
```python
# tests/test_neo4j_reembed.py
import pytest
from sovereign_rag.documents import Chunk
from sovereign_rag.graph import neo4j_store as ns

class _Drv:
    def __init__(self): self.queries = []
    async def execute_query(self, q, *, database_=None, **kw):
        self.queries.append(q); return ([], None, None)
    async def close(self): ...

async def test_reembed_drops_recreates_index_and_sets_embeddings(monkeypatch):
    async def fake_embed(texts): return [[0.1] * 4 for _ in texts]
    monkeypatch.setattr(ns, "embed_texts", fake_embed)
    drv = _Drv()
    store = ns.Neo4jGraphStore(driver=drv, embed_dim=4)
    n = await store.reembed_chunks([Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")])
    assert n == 1
    joined = " ".join(drv.queries)
    assert "DROP INDEX chunk_embedding_index IF EXISTS" in joined
    assert "CREATE VECTOR INDEX" in joined
    assert "setNodeVectorProperty" in joined or "c.embedding" in joined
```

- [ ] **Step 2: Run — FAIL.** (Confirm `Neo4jGraphStore.__init__` accepts `driver=` + `embed_dim=`; per `neo4j_store.py:257-263` it takes `embed_dim`. If it doesn't accept an injected `driver`, add a `driver: AsyncDriver | None = None` param defaulting to the real one — needed for the hermetic test.)

- [ ] **Step 3: Implement** — add to `Neo4jGraphStore`:
```python
    async def reembed_chunks(self, chunks: list[Chunk]) -> int:
        """Recompute c.embedding for the given chunks at the current dim.

        Drops + recreates the vector index (its dimension is fixed at creation),
        then re-embeds each chunk's text and writes it by chunk_id. Entities and
        relationships are untouched.
        """
        from sovereign_rag.providers.ollama import embed_texts
        await self._driver.execute_query(
            f"DROP INDEX {CHUNK_VECTOR_INDEX} IF EXISTS", database_=self._database
        )
        await self.ensure_schema()  # recreates the index at self._embed_dim
        if not chunks:
            return 0
        vectors = await embed_texts([c.text for c in chunks])
        rows = [{"id": c.chunk_id, "emb": v} for c, v in zip(chunks, vectors, strict=True)]
        await self._driver.execute_query(
            "UNWIND $rows AS row MATCH (c:Chunk {chunk_id: row.id}) "
            "CALL db.create.setNodeVectorProperty(c, 'embedding', row.emb)",
            rows=rows,
            database_=self._database,
        )
        return len(rows)
```
(Import `embed_texts` lazily as shown; add `from sovereign_rag.documents import Chunk` to the type imports if not present. Make `__init__` accept `driver` injection if it doesn't already.)

- [ ] **Step 4: Run — PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(neo4j): reembed_chunks recomputes embeddings + recreates index"`

---

### Task 5: Reindex orchestrator (`reindex.py`) — state, lock, `reembed_corpus`

**Files:**
- Create: `src/sovereign_rag/reindex.py`
- Test: `tests/test_reindex.py`

**Interfaces:**
- Consumes: `MilvusHybridStore.export_chunks`/`add_chunks`/`ensure_collection`, `admin.wipe_milvus`, `Neo4jGraphStore.reembed_chunks`, `service.bust_embeddings_cache`.
- Produces: `ReindexState` (dataclass: `status: str` idle|running|done|error, `total: int`, `done_count: int`, `error: str | None`); `get_reindex_state() -> ReindexState`; `async reembed_corpus() -> ReindexState` (acquires `_LOCK`, raises `ReindexBusy` if already running).

- [ ] **Step 1: Failing test (hermetic — monkeypatch the stores)**
```python
# tests/test_reindex.py
import pytest
from sovereign_rag import reindex
from sovereign_rag.documents import Chunk

async def test_reembed_busy_rejects_concurrent(monkeypatch):
    reindex._STATE.status = "running"
    with pytest.raises(reindex.ReindexBusy):
        await reindex.reembed_corpus()
    reindex._STATE.status = "idle"

async def test_reembed_runs_and_reports(monkeypatch):
    calls = {"milvus_add": 0, "neo4j": 0, "wiped": 0}
    sample = [Chunk(doc_id="d", text="t", raw_text="t", position=0, chunk_id="c1")]
    class FakeMilvus:
        async def export_chunks(self, **kw): return sample
        async def ensure_collection(self): ...
        async def add_chunks(self, chunks): calls["milvus_add"] += len(chunks); return len(chunks)
        async def close(self): ...
    class FakeGraph:
        async def reembed_chunks(self, chunks): calls["neo4j"] += len(chunks); return len(chunks)
        async def close(self): ...
    async def fake_wipe(): calls["wiped"] += 1; return (True, 1)
    monkeypatch.setattr(reindex, "MilvusHybridStore", lambda **kw: FakeMilvus())
    monkeypatch.setattr(reindex, "Neo4jGraphStore", lambda **kw: FakeGraph())
    monkeypatch.setattr(reindex, "wipe_milvus", fake_wipe)
    monkeypatch.setattr(reindex, "bust_embeddings_cache", lambda: None)
    st = await reindex.reembed_corpus()
    assert st.status == "done" and st.total == 1
    assert calls["milvus_add"] == 1 and calls["neo4j"] == 1 and calls["wiped"] == 1
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement**
```python
# src/sovereign_rag/reindex.py
"""Guarded corpus re-embed — run when the embedding model/dim changes."""
from __future__ import annotations
import asyncio
import logging
from dataclasses import dataclass, field

from sovereign_rag.admin import wipe_milvus
from sovereign_rag.api.settings.service import bust_embeddings_cache
from sovereign_rag.graph.neo4j_store import Neo4jGraphStore
from sovereign_rag.vectorstore.milvus_store import MilvusHybridStore

logger = logging.getLogger(__name__)

class ReindexBusy(RuntimeError): ...

@dataclass
class ReindexState:
    status: str = "idle"          # idle | running | done | error
    total: int = 0
    done_count: int = 0
    error: str | None = None

_STATE = ReindexState()
_LOCK = asyncio.Lock()

def get_reindex_state() -> ReindexState:
    return _STATE

async def reembed_corpus() -> ReindexState:
    if _STATE.status == "running" or _LOCK.locked():
        raise ReindexBusy("a reindex is already running")
    async with _LOCK:
        _STATE.status, _STATE.error, _STATE.done_count = "running", None, 0
        try:
            bust_embeddings_cache()
            milvus = MilvusHybridStore()
            chunks = await milvus.export_chunks()
            _STATE.total = len(chunks)
            # Milvus: drop + recreate at the new dim, then re-embed via add_chunks.
            await wipe_milvus()
            await milvus.ensure_collection()
            if chunks:
                await milvus.add_chunks(chunks)
            await milvus.close()
            # Neo4j: recreate index at the new dim + recompute embeddings.
            graph = Neo4jGraphStore()
            await graph.reembed_chunks(chunks)
            await graph.close()
            _STATE.done_count = len(chunks)
            _STATE.status = "done"
            logger.info("reembed_corpus done: %d chunks", len(chunks))
        except Exception as exc:
            _STATE.status, _STATE.error = "error", str(exc)
            logger.exception("reembed_corpus failed")
        return _STATE

__all__ = ["ReindexBusy", "ReindexState", "get_reindex_state", "reembed_corpus"]
```

- [ ] **Step 4: Run — PASS** (`uv run pytest tests/test_reindex.py -q`).

- [ ] **Step 5: Commit** — `git commit -am "feat(reindex): guarded reembed_corpus orchestrator + state/lock"`

---

### Task 6: Wire PATCH to trigger reembed + `GET /api/reindex/status`

**Files:**
- Modify: `src/sovereign_rag/api/settings/router.py` (derive `embed_dim`, persist it, trigger background reembed on embed change)
- Create: `src/sovereign_rag/api/reindex/router.py` (+ `__init__.py`) for `GET /api/reindex/status` and `GET /api/embed-models`
- Modify: `src/sovereign_rag/api/main.py` (mount the reindex router)
- Test: `tests/test_settings_patch_reembed.py` (hermetic, FastAPI TestClient or direct call with monkeypatched `reembed_corpus`)

**Interfaces:**
- Consumes: `EMBED_FIELDS`, `dim_for_model`, `reindex.reembed_corpus`, `reindex.get_reindex_state`, `EMBED_MODELS`.
- Produces: `GET /api/reindex/status -> {status,total,doneCount,error}`; `GET /api/embed-models -> [{id,provider,dim,label}]`; PATCH side effect: derive+persist `embed_dim`, launch `asyncio.create_task(reembed_corpus())`.

- [ ] **Step 1: Failing test**
```python
# tests/test_settings_patch_reembed.py
import sovereign_rag.api.settings.router as r

async def test_patch_embed_derives_dim_and_triggers_reembed(monkeypatch):
    persisted = {}
    launched = {"n": 0}
    async def fake_persist(changed): persisted.update(changed)
    monkeypatch.setattr(r, "persist_overrides", fake_persist)
    monkeypatch.setattr(r, "_launch_reembed", lambda: launched.__setitem__("n", launched["n"] + 1))
    from sovereign_rag.api.settings.schemas import SettingsPatch
    await r.settings_patch(SettingsPatch(embed_provider="openai", openai_embed_model="text-embedding-3-large"))
    assert persisted["embed_dim"] == 3072        # derived
    assert persisted["openai_embed_model"] == "text-embedding-3-large"
    assert launched["n"] == 1                      # reembed kicked off
```

- [ ] **Step 2: Run — FAIL.**

- [ ] **Step 3: Implement** — in `settings/router.py` import `EMBED_FIELDS`, `dim_for_model`, `reindex`; add helper + extend `settings_patch`:
```python
def _launch_reembed() -> None:
    import asyncio
    from sovereign_rag.reindex import reembed_corpus
    asyncio.create_task(reembed_corpus())

# inside settings_patch, after computing `changed` and BEFORE persist:
embed_touched = any(f in EMBED_FIELDS for f in changed)
if embed_touched:
    from sovereign_rag.reindex import get_reindex_state
    if get_reindex_state().status == "running":
        raise HTTPException(409, "a reindex is already running")
    provider = changed.get("embed_provider", get_settings().embed_provider)
    model = changed.get("openai_embed_model") or changed.get("embed_model") \
        or (get_settings().openai_embed_model if provider == "openai" else get_settings().embed_model)
    from sovereign_rag.embeddings_registry import dim_for_model
    changed["embed_dim"] = dim_for_model(provider, model)   # derived
# ... existing persist + apply ...
# after apply + LLM bust:
if embed_touched:
    _launch_reembed()
```
(`embed_dim` must be applyable: add `embed_dim: int | None = Field(default=None, ge=1)` to `SettingsPatch` so `apply_to_settings`/persistence accept it — it is set by the server, not the client, but must validate. Add `embed_dim` to `EMBED_FIELDS`? No — keep it out so it doesn't itself re-trigger; it is just persisted+applied.)
Create `src/sovereign_rag/api/reindex/router.py`:
```python
from fastapi import APIRouter
from sovereign_rag.embeddings_registry import EMBED_MODELS
from sovereign_rag.reindex import get_reindex_state
router = APIRouter(prefix="/api", tags=["reindex"])

@router.get("/reindex/status")
async def reindex_status() -> dict[str, object]:
    s = get_reindex_state()
    return {"status": s.status, "total": s.total, "doneCount": s.done_count, "error": s.error}

@router.get("/embed-models")
async def embed_models() -> list[dict[str, object]]:
    return [{"id": m.id, "provider": m.provider, "dim": m.dim, "label": m.label} for m in EMBED_MODELS]

__all__ = ["router"]
```
Mount in `main.py`: `from sovereign_rag.api.reindex.router import router as reindex_router` + `app.include_router(reindex_router)`.

- [ ] **Step 4: Run — PASS** + full backend gate (`ruff` + `mypy src/` + `pytest -m "not integration" -q`).

- [ ] **Step 5: Commit** — `git commit -am "feat(api): embed PATCH derives dim + triggers reembed; /api/reindex/status + /api/embed-models"`

---

### Task 7: Frontend — api types + Embeddings settings section + confirm + status polling

**Files:**
- Modify: `frontend/src/lib/api.ts` (add `ReindexStatus`, `EmbedModel`, `getReindexStatus`, `getEmbedModels`; ensure `SettingsPatch` allows embed fields — it is `Partial<SettingsResponse>`, so add `openai_embed_model` to `SettingsResponse`/patch typing if needed)
- Modify: `frontend/src/pages/Settings.tsx` (Embeddings section)
- Test: `frontend/src/pages/settings-embeddings.test.tsx`

**Interfaces:**
- Consumes: `GET /api/embed-models`, `PATCH /api/settings`, `GET /api/reindex/status`.

- [ ] **Step 1: Failing vitest** — render the Embeddings section, assert it lists models from a mocked `getEmbedModels`, shows the derived dim, and that selecting a new model + confirming calls `patchSettings` with `{embed_provider, openai_embed_model}` and then polls status. (Mock `api` module.)
```tsx
// frontend/src/pages/settings-embeddings.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, vi, expect } from "vitest";
// ... mock ../lib/api: getEmbedModels -> [{id:"text-embedding-3-small",provider:"openai",dim:1536,...},
//      {id:"text-embedding-3-large",provider:"openai",dim:3072,...}];
//      patchSettings -> resolves; getReindexStatus -> {status:"done",...}
// render the EmbeddingsSection; pick 3-large; click confirm; expect patchSettings called with that model.
```

- [ ] **Step 2: Run — FAIL** (`cd frontend && npx vitest run settings-embeddings`).

- [ ] **Step 3: Implement** — `api.ts`:
```ts
export interface EmbedModel { id: string; provider: "openai" | "ollama"; dim: number; label: string }
export interface ReindexStatus { status: "idle" | "running" | "done" | "error"; total: number; doneCount: number; error: string | null }
// in the api object:
getEmbedModels: () => request<EmbedModel[]>("/api/embed-models"),
getReindexStatus: () => request<ReindexStatus>("/api/reindex/status"),
```
Add an `EmbeddingsSection` to `Settings.tsx`: a `<select>` of embed models (label), the derived `dim` shown read-only, a Save button that opens a confirm dialog ("Changing the embedding model re-embeds the corpus; retrieval is unavailable until it finishes"), and on confirm calls `api.patchSettings({ embed_provider: m.provider, openai_embed_model: m.id })` then polls `api.getReindexStatus()` every 1.5s until `status !== "running"`, showing progress (`doneCount/total`) and disabling the control while running. Use `t("pages.settings.embeddings.*")`.

- [ ] **Step 4: Run — PASS** (vitest) + `cd frontend && npx tsc -b && npx vitest run`.

- [ ] **Step 5: Commit** — `git commit -am "feat(ui): admin Embeddings section with reindex confirm + status"`

---

### Task 8: i18n EN/RU for the Embeddings section

**Files:**
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ru.json`

**Interfaces:** keys under `pages.settings.embeddings`: `title`, `model`, `dimension`, `save`, `confirmTitle`, `confirmBody`, `reindexing`, `progress` (`"{{done}}/{{total}} chunks"`), `done`, `error`.

- [ ] **Step 1:** Add the 9 keys to `en.json` and translated equivalents to `ru.json` (CLDR-correct RU).
- [ ] **Step 2: Verify parity** — `node -e "const e=require('./frontend/src/locales/en.json'),r=require('./frontend/src/locales/ru.json'); const ek=Object.keys(e.pages.settings.embeddings), rk=Object.keys(r.pages.settings.embeddings); if(JSON.stringify(ek.sort())!==JSON.stringify(rk.sort())) throw new Error('key mismatch'); console.log('parity ok', ek.length)"` → `parity ok 9`.
- [ ] **Step 3:** Build — `cd frontend && npx vite build` (or `npm run build`) → success.
- [ ] **Step 4: Commit** — `git commit -am "feat(i18n): EN/RU for admin Embeddings section"`

---

### Task 9: Full verification

- [ ] **Step 1: Backend gates** — `uv run ruff check src/ tests/ eval/ && uv run ruff format --check src/ tests/ eval/ && uv run mypy src/ && uv run pytest -m "not integration" -q` → all green.
- [ ] **Step 2: Frontend gates** — `cd frontend && npx tsc -b && npx vitest run && npm run build` → all green.
- [ ] **Step 3: Manual smoke (local, optional / integration)** — with services up: PATCH `embed` via the UI on an empty corpus → `/api/reindex/status` reaches `done`; `/api/settings` shows the new model + derived dim; store dims match (reuse the box inspection script).
- [ ] **Step 4:** finishing-a-development-branch (verify tests → merge → deploy). After deploy, the embeddings can be changed live from the admin UI.

---

## Self-review notes
- **Spec coverage:** registry (T1), settings editability+cache-bust (T2), export_chunks (T3), Neo4j reembed (T4), orchestrator+lock+state (T5), PATCH trigger + status/embed-models endpoints (T6), frontend section+confirm+polling (T7), i18n (T8), verify (T9). All spec sections covered.
- **Derived dim:** set server-side in T6 from `dim_for_model` (T1); `embed_dim` added to `SettingsPatch` as server-set-only.
- **v1 limits honored:** in-place (T5 wipes Milvus then re-adds; Neo4j keeps graph); double-embed (Milvus add_chunks + Neo4j reembed) accepted as a known v1 inefficiency — optimize to embed-once later.
- **Concurrency:** lock in T5 + 409 in T6.
