# OpenAI Model Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make OpenAI (`gpt-5.4` family) the default LLM and embeddings provider, replacing Ollama Cloud.

**Architecture:** Config-default flip only — the factory (`shared/llm_factory.py`) and embeddings (`providers/ollama.py::get_embeddings`) already support `openai` end-to-end. No factory/provider code changes. Ollama stays a selectable provider. Reasoning effort is left at model default (no `reasoning_effort`), so the existing `gpt-5.x` temperature-stripping is the only special handling and it is already present.

**Tech Stack:** Python 3.12, pydantic-settings, `langchain-openai>=1.0`, OpenAI `gpt-5.4`/`-mini`/`-nano`, `text-embedding-3-large`.

## Global Constraints

- Chat tiers: `default=gpt-5.4`, `light=gpt-5.4-mini`, `nano=gpt-5.4-nano`. NEVER use deprecated `gpt-5`/`gpt-5-mini`/`gpt-5-nano` (shutdown 2026-12-11).
- Embeddings: `text-embedding-3-large` @ `embed_dim=1024`. **No reindex** — do not change `embed_dim` or `openai_embed_model`.
- No `reasoning_effort` plumbing. No `conftest.py`. **Do not add or modify tests** (spec: tests stay as-is).
- `OPENAI_API_KEY` read from the system environment (pydantic-settings auto-reads it); never commit it to `.env`.
- Commit AS the user, NO `Co-Authored-By` footer (project convention).
- Gates: `uv run ruff check src/ tests/ eval/` + `uv run ruff format --check src/ tests/ eval/` + `uv run mypy src/` + `uv run pytest -m "not integration"` all green.

---

### Task 1: Flip config defaults to OpenAI

**Files:**
- Modify: `src/sovereign_rag/config.py` (module docstring lines 1-5; `llm_provider` line 26; `openai_chat_model*` lines 46-48; `embed_provider` line 52)

**Interfaces:**
- Consumes: nothing (leaf change).
- Produces: `Settings()` defaults — `llm_provider="openai"`, `openai_chat_model="gpt-5.4"`, `openai_chat_model_light="gpt-5.4-mini"`, `openai_chat_model_nano="gpt-5.4-nano"`, `embed_provider="openai"`. Every `get_chat_model()` / `get_embeddings()` caller picks these up via `get_settings()`.

- [ ] **Step 1: Edit `llm_provider` default (config.py:26)**

```python
    # ---- LLM provider selection ----
    # "openai" (default) or "ollama" (local daemon or Ollama Cloud). All
    # ``shared.llm_factory`` callers and the legacy ``providers.ollama.get_llm``
    # route through this.
    llm_provider: str = "openai"
```

- [ ] **Step 2: Edit OpenAI chat model defaults (config.py:46-48)**

```python
    # ---- OpenAI chat models (used when llm_provider == "openai") ----
    # Current gpt-5.4 family (2026 line). The deprecated gpt-5/-mini/-nano
    # snapshots (shutdown 2026-12-11) must NOT be used. If blank, the factory
    # falls back to the matching ``llm_model*`` (Ollama) setting.
    openai_chat_model: str = "gpt-5.4"  # tier=default
    openai_chat_model_light: str = "gpt-5.4-mini"  # tier=light
    openai_chat_model_nano: str = "gpt-5.4-nano"  # tier=nano
```

- [ ] **Step 3: Edit `embed_provider` default (config.py:52)**

```python
    # "openai" (default; text-embedding-3-large) or "ollama" (local bge-m3).
    embed_provider: str = "openai"
```

- [ ] **Step 4: Update the module docstring (config.py:1-5)** — the old text claims local-by-default and "No setting requires a paid API key", now stale.

```python
"""Runtime configuration. Everything is overridable via env / `.env`.

The control plane defaults to OpenAI (chat `gpt-5.4` family + `text-embedding-3-large`),
which requires `OPENAI_API_KEY` in the environment. The data plane stays local:
Milvus on :19530, Neo4j on :7687, SearXNG on :8080. Set `llm_provider=ollama` /
`embed_provider=ollama` to run fully local against an Ollama daemon on :11434.
"""
```

- [ ] **Step 5: Verify the defaults resolve (smoke, bypassing `.env`)**

Run: `uv run python -c "from sovereign_rag.config import Settings; s=Settings(_env_file=None); print(s.llm_provider, '|', s.openai_chat_model, s.openai_chat_model_light, s.openai_chat_model_nano, '|', s.embed_provider, s.openai_embed_model, s.embed_dim)"`
Expected: `openai | gpt-5.4 gpt-5.4-mini gpt-5.4-nano | openai text-embedding-3-large 1024`

- [ ] **Step 6: Run the gate suite — must stay green**

Run: `uv run ruff check src/ tests/ eval/ && uv run ruff format --check src/ tests/ eval/ && uv run mypy src/ && uv run pytest -m "not integration" -q`
Expected: ruff clean, mypy clean, all unit tests PASS (hermetic — every LLM site is monkeypatched, none assert the old default).

- [ ] **Step 7: Commit**

```bash
git add src/sovereign_rag/config.py
git commit -m "feat(config): default to OpenAI gpt-5.4 family + OpenAI embeddings"
```

---

### Task 2: Update docs

**Files:**
- Modify: `CLAUDE.md` (the "paid-API dependency" line)
- Modify: `README.md` (provider/default mention + `OPENAI_API_KEY` requirement) — read first; edit the actual lines found.

**Interfaces:**
- Consumes: Task 1's new defaults.
- Produces: docs consistent with OpenAI-default. No code.

- [ ] **Step 1: Update `CLAUDE.md`** — find the line `self-hosted Mac Mini runs integration + eval (uses Ollama Cloud + OpenAI embeddings — the only paid-API dependency)` and replace `Ollama Cloud + OpenAI embeddings — the only paid-API dependency` with `OpenAI (chat gpt-5.4 family + embeddings) — set OPENAI_API_KEY in the environment; Ollama remains selectable via llm_provider/embed_provider=ollama`.

- [ ] **Step 2: Update `README.md`** — Read `README.md`; locate any statement that Ollama is the default LLM/embeddings provider or that the stack needs no API key. Edit those to state OpenAI (`gpt-5.4` family + `text-embedding-3-large`) is the default and requires `OPENAI_API_KEY` in the environment, with `llm_provider=ollama`/`embed_provider=ollama` as the local-only fallback. If no such statement exists, add a one-line note under the setup/quickstart section. (Exact text depends on the file's current wording — match its style.)

- [ ] **Step 3: Verify no stale "Ollama is the default" / "no API key" claims remain**

Run: `rg -ni "no .*api key|only paid|ollama.*default|default.*ollama" CLAUDE.md README.md`
Expected: no remaining line that asserts Ollama-default or zero-API-key as the project default (matches may remain only where they describe the *fallback*).

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md README.md
git commit -m "docs: OpenAI is the default provider (chat + embeddings)"
```

---

### Task 3: Rollout — clear stale persisted overrides on live PG (post-merge)

**Files:** none (operational; runs against the live Mac Mini Postgres). **Do this only after Tasks 1–2 are merged and the push triggers auto-deploy.**

**Interfaces:**
- Consumes: merged config defaults.
- Produces: a live stack actually running OpenAI (not silently pinned to Ollama by a persisted override).

- [ ] **Step 1: Inspect the persisted settings overrides on live PG**

The dev `.env` `langgraph_pg_uri` points at the LIVE Mac Mini Postgres (per project memory), so query it directly. Inspect for stale provider/model rows:

Run: `uv run python -c "import asyncio,os; import psycopg; uri=__import__('sovereign_rag.config',fromlist=['get_settings']).get_settings().langgraph_pg_uri;
import psycopg;
conn=psycopg.connect(uri);
cur=conn.execute(\"select key, value from settings_overrides where key in ('llm_provider','embed_provider','openai_chat_model','openai_chat_model_light','openai_chat_model_nano')\");
print(cur.fetchall()); conn.close()"`
Expected: a list of any persisted overrides for those keys (often empty `[]`).

- [ ] **Step 2: Decide & clear stale rows**

- If the result is empty `[]` → nothing pinned; the new code default (`openai`) wins. Done — skip to Step 3.
- If a row pins `llm_provider`/`embed_provider` to `ollama`, or `openai_chat_model*` to a deprecated/blank value → delete those rows so the code default applies (or repoint them to the `gpt-5.4` family). Delete:

  `delete from settings_overrides where key in ('llm_provider','embed_provider') and value::text in ('"ollama"','ollama');`

  (Adjust the matched keys/values to exactly what Step 1 returned. Re-run Step 1 to confirm the rows are gone.)

- [ ] **Step 3: Verify the key reaches the service**

`launchd` does not source `.zshrc`. Since OpenAI **embeddings already work live**, the key is already in the service env — confirm the running service resolves it (e.g. the health endpoint's OpenAI-embeddings probe is healthy, or a live `/ask` succeeds). If it fails with "OPENAI_API_KEY is not set", add the key to the service's actual environment (the launchd plist `EnvironmentVariables` or the server-side `.env`), not just `.zshrc`, and restart the service.

- [ ] **Step 4: Live `/ask` smoke**

Ask one question against the live Mac Mini API and confirm a non-empty answer with citations comes back (proves chat is now served by `gpt-5.4`). No commit (operational task).

---

## Verification (whole plan)

- Tasks 1–2 gates green: `ruff check` + `ruff format --check` + `mypy src/` + `pytest -m "not integration"`.
- Defaults smoke prints `openai | gpt-5.4 gpt-5.4-mini gpt-5.4-nano | openai text-embedding-3-large 1024`.
- Task 3: live `/ask` returns an answer; no persisted override silently re-pins Ollama.
