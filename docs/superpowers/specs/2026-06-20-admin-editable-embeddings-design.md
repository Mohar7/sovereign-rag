# Admin-Editable Embeddings (with guarded re-embed) — Design

**Date:** 2026-06-20
**Status:** Approved in concept ("lets go"); spec for review
**Goal:** Make the embedding **provider + model** changeable from the admin Settings UI (DB-persisted, like the LLM settings), with a **guarded re-embed migration** on change — because embeddings are stateful (they define the Milvus collection / Neo4j index dimension and the stored vector space).

## Why this is different from the LLM settings

The LLM is stateless: switching `gpt-5.4`→`qwen` only affects future generations. Embeddings are stateful: `embed_dim` is baked into the Milvus collection schema + Neo4j vector index at creation (not alterable in place), and even a same-dim model change moves the vector space, invalidating every stored vector. So "change the embedding model" = **re-embed the whole corpus**, not just persist a value. This spec adds that guard so the admin toggle is safe.

Aligns with the standing preference: every tunable should be admin-configurable + DB-persisted, with `.env` as bootstrap only — **with the right rules** for stateful ones (project memory: `prefer-all-settings-admin-configurable`).

## Decisions

| # | Decision |
|---|---|
| 1 | Expose `embed_provider` + the model (`openai_embed_model` / `embed_model`) in `SettingsPatch` + admin UI. |
| 2 | **`embed_dim` is DERIVED**, not free: a `EMBED_MODEL_DIMS` registry maps model→native dim (`text-embedding-3-small`→1536, `text-embedding-3-large`→3072, `bge-m3`→1024). UI shows it read-only. Removes the mismatched-dim footgun. |
| 3 | Changing any embed field triggers a **re-embed migration** (not just persist). Persist → bust embeddings cache → drop+recreate stores at the new dim → re-embed existing chunks → done. |
| 4 | **Re-embed source = the stored chunk text in Milvus** (`_F_TEXT`); no original files needed. Neo4j Chunk nodes keep their text + graph; only `Chunk.embedding` is recomputed and the vector index recreated — **entities/relations are preserved** (they don't depend on the embed model). |
| 5 | **v1 strategy = in-place** with a `reindexing` status flag (retrieval returns "reindexing" during the window). Atomic dual-collection cutover is a future enhancement. Acceptable: single-user self-hosted stack, and the corpus is empty *now* (zero-cost first switch). |
| 6 | Guards: model allowlist (the registry), one reindex at a time (lock/flag), secrets + `*_uri` stay env-only, never persisted. |

## Backend

### Settings (`config.py`, `api/settings/schemas.py`, `service.py`, `router.py`)
- `EMBED_MODEL_DIMS: dict[str, int]` registry + `dim_for_model(provider, model) -> int`.
- `SettingsPatch` gains `embed_provider` (`^(openai|ollama)$`), `openai_embed_model`, `embed_model` (validated against the registry). Add `EMBED_FIELDS` frozenset.
- On PATCH: if any `EMBED_FIELDS` changed → set derived `embed_dim` too → `persist_overrides` (incl. `embed_dim`) → `get_embeddings.cache_clear()` → launch the re-embed (below) → return a response indicating reindex started.
- `load_and_apply_overrides`: bust the embeddings cache when an embed field is among the applied set (mirror the existing LLM-cache logic).

### Re-embed orchestration (`src/sovereign_rag/reindex.py` — new)
- `export_chunks() -> list[Chunk]`: read all chunks back from Milvus (`query` with empty filter + pagination, output the stored fields) → reconstruct `Chunk`s.
- `reembed_corpus()`:
  1. `chunks = export_chunks()` (snapshot the text before dropping).
  2. Drop + recreate Milvus collection at the new `embed_dim` (`wipe_milvus` + `ensure_collection`); `add_chunks(chunks)` re-embeds with the new model.
  3. Neo4j: `DROP INDEX chunk_embedding_index IF EXISTS` → recreate at new dim (`ensure_schema`) → recompute `Chunk.embedding` for existing Chunk nodes (embed their text, `setNodeVectorProperty` in batches). Entities/relations untouched.
  4. Status: a process-level `ReindexState` (status: idle|running|error, counts, started_at) exposed via `GET /api/reindex/status`; a lock prevents concurrent runs.
- `milvus_store`: add `export_chunks()` (or `iter_chunks`) using `client.query`.

### Reuse
- `MilvusHybridStore.add_chunks` already embeds via `get_embeddings` → re-add = re-embed.
- `admin.wipe_milvus` (drop) + `ensure_collection` (recreate) already exist; `wipe_neo4j` now drops the vector index (shipped today).

## Frontend (`frontend/src/...`)
- Settings panel: an **Embeddings** section — provider toggle + model select (from the registry), `embed_dim` shown read-only (derived).
- Save shows a **confirm dialog**: "Changing the embedding model re-embeds the entire corpus (N chunks). Retrieval is unavailable until it finishes." 
- After save: poll `GET /api/reindex/status` and show progress; disable the control while running.
- i18n EN + RU parity for all new strings.

## Testing
- Unit: `dim_for_model` registry; `SettingsPatch` accepts/validates embed fields + derives dim; PATCH triggers reembed (mock the reembed); `export_chunks` reconstruction (mock Milvus query); reindex lock rejects concurrent runs. Hermetic (mock stores/embeddings).
- Frontend: vitest for the confirm + status polling.
- Integration (gated): a real end-to-end reembed against Milvus+Neo4j with a 2-doc corpus (RUN_*_IT=1) — verify dims flip and retrieval still returns the docs.

## Out of scope (v1)
- Atomic dual-collection cutover (zero-downtime). v1 has a brief retrieval-unavailable window.
- Custom Matryoshka sub-dimensions (only native model dims for now).
- Re-running graph entity/relation extraction (preserved as-is; only embeddings recomputed).
- Switching embedding *providers'* API keys from the UI (keys stay env-only).

## Risks
- **Data loss if reembed crashes mid-flight (in-place)**: mitigated by snapshotting chunk text into memory before the Milvus drop, and (future) dual-collection cutover. For large corpora the in-memory snapshot is a known v1 limitation — log + cap, revisit with streaming.
- **Long reindex** on a big corpus blocks retrieval: surfaced via status + confirm copy; future async/cutover removes the window.
- Empty corpus now → the risky paths are exercised trivially first; good time to ship.
