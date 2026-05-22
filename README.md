# sovereign-rag

> **Local-first GraphRAG** — not fully self-hosted: Milvus hybrid retrieval (dense + BM25) plus Neo4j knowledge-graph local-search, then cross-encoder reranking, with Anthropic-style contextual retrieval. Web ingestion via Docling / Crawl4AI / SearXNG.
> **Local development** runs end-to-end on **Ollama** with no paid APIs. **CI integration tier** uses Ollama Cloud + OpenAI embeddings (the Mac Mini runner can't host a local Ollama daemon, and Ollama Cloud has no embeddings endpoint). Details in [Two-tier CI](#two-tier-ci).

[![CI](https://github.com/Mohar7/sovereign-rag/actions/workflows/ci.yml/badge.svg)](https://github.com/Mohar7/sovereign-rag/actions/workflows/ci.yml)
[![Python 3.12](https://img.shields.io/badge/python-3.12-blue.svg)](https://www.python.org/downloads/)
[![Milvus 2.6](https://img.shields.io/badge/Milvus-2.6-00a1ea.svg)](https://milvus.io/)
[![Neo4j 5](https://img.shields.io/badge/Neo4j-5%20Community-008cc1.svg)](https://neo4j.com/)
[![Ollama](https://img.shields.io/badge/LLM-Ollama-black.svg)](https://ollama.com/)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Local-dev (default).** Everything runs on your own machine — the LLM (Ollama), the embeddings (Ollama `bge-m3`), the reranker (`BAAI/bge-reranker-v2-m3` cross-encoder, runs on MPS / CUDA / CPU), the vector DB (Milvus), the graph DB (Neo4j), and web search (SearXNG) are all local or self-hosted. No paid keys required. The defaults in `config.py` reflect this.

**Honest caveat.** The CI integration tier on a self-hosted Mac Mini runner swaps the LLM to **Ollama Cloud** and embeddings to **OpenAI** — the Mac Mini can't reasonably host a local Ollama daemon, and Ollama Cloud doesn't expose an embeddings endpoint. So "sovereign-rag" is the *architecture* and the *local-dev path*; the CI integration job is not. Details in [Two-tier CI](#two-tier-ci).

## Why this exists

"Naive RAG" (embed -> cosine search -> stuff the prompt) loses to current best-practice on real corpora. This project implements the 2025/26 stack a senior reviewer expects, and **measures** each layer:

| Technique | What it buys | Here |
|---|---|---|
| **Hybrid search** (dense + BM25, RRF) | BM25 catches exact tokens (codes, names, IDs) dense embeddings miss | Native in Milvus 2.6 — one `hybrid_search` call, server-side BM25 |
| **Cross-encoder reranking** | Biggest quality-per-line jump; re-scores top-50 -> top-5 | `BAAI/bge-reranker-v2-m3` via sentence-transformers — multilingual, ~568M params, MPS/CUDA/CPU, no API |
| **Contextual Retrieval** (Anthropic, 2024) | Prepends chunk-situating context before indexing; ~-35% retrieval failures | Local LLM generates the prefix |
| **GraphRAG local-search** | Multi-hop questions vector search can't answer | Neo4j entity graph: vector-seed -> 1-hop traverse |
| **Evaluation harness** | Proves the above instead of cargo-culting it | RAGAS (Ollama judge) + retrieval precision@k |

## Architecture

```
  Ingestion ----------------------------------------------------------------+
   Docling (PDF/DOCX->md) . Crawl4AI (web->md) . SearXNG (search) . text     |
                                   |                                         |
                                   v                                         |
   chunk (recursive ~400tok/15%) -> contextualize (Ollama prefix)            |
                                   |                                         |
                +------------------+-------------------+                     |
                v                                      v                     |
   +------------------------+           +---------------------------+        |
   | Milvus 2.6             |           | Neo4j 5 Community          |        |
   |  dense (HNSW/COSINE)   |           |  Chunk + Entity graph      |        |
   |  + sparse BM25 (native)|           |  native vector index       |        |
   |  hybrid_search + RRF   |           |  LLM entity extraction      |        |
   +-----------+------------+           +-------------+--------------+        |
               |  top-50                 local-search |  seeds + 1 hop        |
               +---------------+----------------------+                       |
                               v                                             |
                  dedup -> bge-reranker-v2-m3 cross-encoder rerank -> top-5            |
                               v                                             |
                   Ollama LLM -> cited answer  <-----------------------------+

  Eval: RAGAS (faithfulness / context-precision, Ollama judge) + precision@k
  Obs:  Langfuse (optional)
```

**Stack.** Python 3.12 · LangChain 1.x (splitters/contracts) · **Milvus 2.6** (`pymilvus`, AsyncMilvusClient) · **Neo4j 5 Community** (`neo4j-graphrag`) · **Ollama** (`langchain-ollama`; qwen2.5:7b + bge-m3) · **`BAAI/bge-reranker-v2-m3`** cross-encoder via sentence-transformers · **Docling** (IBM, layout-aware parsing) · **Crawl4AI** + **SearXNG** ingestion · **RAGAS** eval · FastAPI · uv · ruff/mypy/pytest.

## Quick start

```bash
# 1. Models (host Ollama)
ollama serve &
ollama pull qwen2.5:7b
ollama pull bge-m3

# 2. Infra (Milvus + Neo4j + SearXNG)
cp .env.example .env          # set NEO4J_PASSWORD
docker compose up -d          # etcd+minio+milvus, neo4j, searxng

# 3. App
uv sync
uv run uvicorn sovereign_rag.api:app --reload
# http://localhost:8000/docs
```

> This is a heavy stack: Milvus standalone is 3 containers, Neo4j wants ~2 GB, and Docling/Crawl4AI pull torch + Chromium. Intended to run on a workstation or a sandbox VM, not a 1 GB box.

### Use it

```bash
# Index a PDF (Docling)
curl -F "file=@paper.pdf" http://localhost:8000/documents/file

# Index a web page (Crawl4AI)
curl -X POST http://localhost:8000/documents/url \
  -H 'Content-Type: application/json' -d '{"url":"https://example.com/article"}'

# Search the web (SearXNG) + ingest top hits
curl -X POST http://localhost:8000/ingest/search \
  -H 'Content-Type: application/json' -d '{"query":"milvus hybrid search","max_results":3}'

# Ask — hybrid + graph retrieval, reranked, cited
curl -X POST http://localhost:8000/ask \
  -H 'Content-Type: application/json' -d '{"question":"How does BM25 fusion work here?"}'
# -> {"answer":"...[1][2]...","citations":[{chunk_id,title,source_uri,page,score,snippet}],...}
```

## How retrieval works

1. **Index** — a `SourceDocument` (from Docling/Crawl4AI/text) is recursively chunked, each chunk gets an LLM-generated contextual prefix (Anthropic's technique), then it's written to **both** Milvus (dense + BM25) and Neo4j (chunk node + extracted entity graph).
2. **Retrieve** — the query hits Milvus `hybrid_search` (dense ANN + server-side BM25, fused with `RRFRanker`) **and** Neo4j `local_search` (vector-seed chunks -> traverse mentioned entities 1 hop -> append relation facts) concurrently.
3. **Rerank** — the union is deduped by chunk and re-scored by the `BAAI/bge-reranker-v2-m3` cross-encoder; top-5 survive.
4. **Answer** — the local LLM answers using only the numbered passages, citing `[n]` inline; the API returns structured citations.

Every layer is toggle-able via env (`ENABLE_GRAPH_RETRIEVAL`, `ENABLE_CONTEXTUAL_RETRIEVAL`) so you can A/B their contribution in the eval harness.

## Evaluation

```bash
uv run python eval/evaluate.py
```

Loads `eval/qa_pairs.json` (a golden set over a self-contained corpus in `eval/corpus/`), runs retrieval for each question, and reports **retrieval precision@k / recall@k / MRR / NDCG** plus **RAGAS** (faithfulness, answer relevancy, context precision/recall) — with the **Ollama** model as judge, no OpenAI. Without services running it degrades to an offline IR demo over the bundled corpus and says so.

## Project layout

```
src/sovereign_rag/
  documents.py        # SourceDocument / Chunk / RetrievedChunk contracts
  config.py           # pydantic-settings, local-by-default
  providers/
    ollama.py         # ChatOllama + OllamaEmbeddings
    reranker.py       # bge-reranker-v2-m3 via sentence-transformers (MPS/CUDA/CPU)
  chunking.py         # recursive split + contextual-retrieval prefixing
  ingestion/          # docling (pdf) . crawl4ai (web) . searxng (search)
  vectorstore/
    milvus_store.py   # dense + native BM25 hybrid, RRF
  graph/
    neo4j_store.py    # LLM entity extraction + vector-seed graph traverse
  retrieval/
    pipeline.py       # orchestrates index -> retrieve -> rerank -> answer
  api.py              # FastAPI
eval/                 # golden set + RAGAS + IR metrics
tests/                # 94 unit tests (services mocked); integration marked + skipped
```

## Testing

```bash
uv run pytest -m "not integration"   # 94 unit tests, no services, ~5s
uv run ruff check src/ tests/ eval/
uv run mypy src/
```

Tests that need Milvus/Neo4j/Ollama are marked `@pytest.mark.integration` and skipped unless the services are reachable (gated by `RUN_*_IT=1` env flags) — so CI and contributors run the full unit suite offline. Live/integration runs belong on a machine with the full stack up, not on a dev laptop or a GitHub-hosted runner.

### Two-tier CI

| Workflow | Runner | What runs |
|---|---|---|
| `ci.yml` | GitHub-hosted `ubuntu-latest` | ruff + mypy + unit tests (no services) — fast, on every push/PR |
| `integration.yml` | **self-hosted** `[self-hosted, macOS, sovereign]` | brings up the compose stack (Milvus + Neo4j + SearXNG), runs `pytest -m integration` + the live eval harness — on push-to-main / manual dispatch only |

The integration tier needs Docker + browser deps + LLM + embeddings. The Mac Mini runner can't reasonably host a local Ollama daemon, and **Ollama Cloud does not expose an embeddings endpoint** — so the CI tier uses:

- **LLM**: Ollama Cloud `deepseek-v4-pro` (`OLLAMA_API_KEY` secret)
- **Embeddings**: OpenAI `text-embedding-3-large` at 3072-dim (`OPENAI_API_KEY` secret) — `EMBED_PROVIDER=openai` flips the dispatcher
- **Vector store / graph / search**: local containers on the runner (compose stack)

This is the only place the project depends on paid APIs, and it's documented honestly. The defaults in `config.py` and the local-dev path stay 100% local. Per-run cost on the golden set is in cents.

Register the runner with:

```bash
# on the Mac Mini, from the repo's Settings -> Actions -> Runners -> New
./config.sh --url https://github.com/Mohar7/sovereign-rag --token <TOKEN> \
            --labels self-hosted,macOS,sovereign
./svc.sh install && ./svc.sh start    # run as a background service
```

Repo secrets required for the integration job: `OLLAMA_API_KEY`, `OPENAI_API_KEY`.

**Security:** `integration.yml` triggers only on `push` to `main` and `workflow_dispatch` — never on pull requests. A self-hosted runner must not execute untrusted fork code. Keep "Require approval for all outside collaborators" enabled in repo Settings.

## Roadmap

- [ ] **Semantic chunking** — replace fixed recursive splitting with embedding-similarity breakpoint chunking; A/B against recursive in the eval harness.
- [ ] **Camoufox** ingestion tier for anti-bot sites (lazy-imported hook already in `ingestion/web.py`).
- [ ] Community-detection global-search (Leiden) on the graph for "dataset-wide" questions.
- [ ] Parent-document retrieval (small-to-large) on the Milvus side.
- [ ] `eval/evaluate.py` live RAGAS path: calls a `RAGPipeline.ingest_corpus()` that doesn't exist on the pipeline (which exposes `index_document`). The harness silently falls back to its OFFLINE demo. Wire the live path properly.

## License

MIT — see [LICENSE](LICENSE).
