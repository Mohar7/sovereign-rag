# OpenAI Model Migration — Design

**Date:** 2026-06-20
**Status:** Approved (brainstorm)
**Goal:** Make OpenAI the project's default LLM **and** embeddings provider, replacing Ollama Cloud, using the current `gpt-5.4` model family with model-default reasoning.

## Context

The factory `src/sovereign_rag/shared/llm_factory.py` already supports an `openai`
provider end-to-end. `ReasoningSafeChatOpenAI` already strips the `temperature` /
`top_p` that `gpt-5.x` reasoning models reject (`_is_reasoning_model` matches
`gpt-5*`, so `gpt-5.4`/`gpt-5.5` are covered). Embeddings (`providers/ollama.py::
get_embeddings`) already branch to `OpenAIEmbeddings` when `embed_provider="openai"`.

So this is a **config-default flip + rollout hardening**, not a rewrite. Ollama
stays fully selectable; it is simply no longer the default.

Current defaults (all Ollama / local):
- `llm_provider = "ollama"`, chat tiers = `qwen2.5:7b/3b/1.5b`
- `openai_chat_model* = ""` (blank → would fall back to qwen names if flipped)
- `embed_provider = "ollama"` (`bge-m3`, `embed_dim=1024`)

Prod (Mac Mini) already runs **OpenAI embeddings** at `embed_dim=1024` via env override;
chat runs **Ollama Cloud**. CLAUDE.md: "the only paid-API dependency" is OpenAI embeddings.

## Latest OpenAI models (live docs, 2026-06-20)

`gpt-5.5` (flagship, 1M ctx), `gpt-5.4` (affordable, 1M ctx), `gpt-5.4-mini` (400K),
`gpt-5.4-nano` — all reasoning models. The older `gpt-5` / `gpt-5-mini` / `gpt-5-nano`
are **deprecated (shutdown 2026-12-11)**, so we use the `5.4` IDs.

## Decisions

| Decision | Choice |
|---|---|
| Scope | Flip the **in-code default** to OpenAI for all environments. Local dev / tests opt back to `ollama` or supply a key. |
| Chat tiers | `default=gpt-5.4`, `light=gpt-5.4-mini`, `nano=gpt-5.4-nano` |
| Reasoning effort | **Model default** — do **not** set `reasoning_effort` (no factory change) |
| Embeddings | Flip default to `openai` too. Keep `text-embedding-3-large` @ `embed_dim=1024`. **No reindex** (prod already this model+dim). |
| Tests | **Keep as-is.** No `conftest.py` safety net. Acceptable: no test asserts the old default and every LLM call site is monkeypatched. |
| API key | Read `OPENAI_API_KEY` from the **system environment** (pydantic-settings reads it automatically). Do **not** commit it to `.env`. |

## Change set

### 1. `src/sovereign_rag/config.py` — defaults

```python
llm_provider            = "openai"        # was "ollama"
openai_chat_model       = "gpt-5.4"       # was ""
openai_chat_model_light = "gpt-5.4-mini"  # was ""
openai_chat_model_nano  = "gpt-5.4-nano"  # was ""
embed_provider          = "openai"        # was "ollama"
```

Keep unchanged: `openai_embed_model = "text-embedding-3-large"`, `embed_dim = 1024`,
all `ollama_*` and `llm_model*` settings (the fallback provider), `llm_temperature`,
`llm_num_ctx`. Update the module docstring (the "No setting requires a paid API key"
and Ollama-first framing are now stale for defaults).

No change to `llm_factory.py` (reasoning effort unset; temperature-stripping already present).
No change to `providers/ollama.py::get_embeddings` (already branches correctly).

### 2. Docs

- `config.py` module docstring — reflect OpenAI-default.
- `CLAUDE.md` — "Ollama Cloud + OpenAI embeddings — the only paid-API dependency" →
  OpenAI (chat + embeddings) is the default paid dependency; Ollama remains selectable.
- `README.md` — update any "Ollama is the default" quickstart note + add that
  `OPENAI_API_KEY` must be in the environment when using the (now default) OpenAI provider.

### 3. Rollout / deploy (the real risk is persisted state, not code)

- ⚠️ **`llm_provider`, `embed_provider`, and `openai_chat_model*` are in `LLM_FIELDS`** →
  persistable to the prod `settings_overrides` table. A stale persisted
  `llm_provider="ollama"` (or blank `openai_chat_model*`) from earlier UI use will
  **override the new code default** and keep the live stack on Ollama.
  **Deploy step:** inspect `settings_overrides` on live PG; clear or repoint any stale
  `llm_provider` / `embed_provider` / `openai_chat_model*` override.
- **`OPENAI_API_KEY` must be visible to the launchd service.** `launchd` does **not**
  source `.zshrc`, so a `.zshrc` export alone won't reach the service. Since OpenAI
  **embeddings already work in prod**, the key is already plumbed into the service env —
  verify it still resolves after the chat flip (same env var).
- `OLLAMA_API_KEY` may stay as a fallback.

## Risks & mitigations

- **Chat is now a paid dependency on every `/ask`** — accepted (explicit ask).
- **`gpt-5.4` reasoning at model-default effort** adds latency/cost vs qwen — accepted.
- **Deprecated `gpt-5*` IDs** — avoided by using `5.4`.
- **Embeddings footgun:** flipping `embed_provider` is same-dim (1024) but a *different
  vector space* than `bge-m3`. Prod is already OpenAI (unaffected). A local dev with an
  existing `bge-m3` Milvus collection would get degraded retrieval until reindex or
  overriding `embed_provider=ollama`. Documented; no prod impact.
- **Persisted-override gotcha** — handled in Rollout above.

## Verification gates

- `uv run ruff check src/ tests/ eval/` + `uv run ruff format --check src/ tests/ eval/`
- `uv run mypy src/`
- `uv run pytest -m "not integration"` — green (expected: unchanged; hermetic)
- Smoke: with `OPENAI_API_KEY` set, `get_chat_model()` resolves to `gpt-5.4`
  (`_build_openai` logs `openai/gpt-5.4 (reasoning_safe=True)`).
- Post-deploy: live `/ask` smoke against the Mac Mini; confirm an answer + citations.

## Out of scope

- Reranker stays a local cross-encoder (OpenAI has no rerank API).
- No embedding reindex / dimension change.
- No `reasoning_effort` plumbing, no Responses-API-specific features, no Realtime.
- Removing Ollama support (it remains a selectable provider).
