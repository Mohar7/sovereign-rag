# sovereign-rag — Architecture

A local-first GraphRAG system: a **LangGraph control plane** orchestrates a
**hybrid data plane** (Milvus dense+BM25 with RRF fusion ‖ Neo4j knowledge-graph
local-search), cross-encoder reranking, and an LLM that answers with inline
citations — with human-in-the-loop (HITL) on web fallback and Postgres-backed
thread persistence.

> GitHub renders the Mermaid below inline. A rendered image is also at
> [`architecture.png`](architecture.png) / [`architecture.svg`](architecture.svg).

```mermaid
flowchart TB
  CLIENT["WEB UI &nbsp; React 19 / shadcn-ui / Tailwind v4 / TanStack / i18next EN-RU / light-dark<br/>Ask · Library · Ingest · Threads · Graph · Evals · History · Settings"]
  CLIENT -->|"fetch + SSE token stream"| API
  API["FastAPI &nbsp; api/main.py :8000<br/>routers: ask · ingest · library · threads · runs · graph · evals · settings · health · admin"]
  API -->|"/ask · /ask/stream"| RL
  API -->|"/ingest · /documents/*"| SRC

  subgraph CTRL["CONTROL PLANE &nbsp; LangGraph StateGraph (graphs/rag_qa)"]
    direction LR
    RL["retrieve_local"] --> COND{"local hits &lt; min?"}
    COND -->|no| RR["rerank"]
    COND -->|"yes, once"| WF["web_fallback<br/>interrupt() · HITL approval"]
    WF -->|"approved URLs · /ask/resume"| RL
    RR --> GEN["generate<br/>cited answer [n]"]
  end

  subgraph DATA["DATA PLANE &nbsp; raw async clients (no LangChain wrappers)"]
    MILVUS[("Milvus 2.6<br/>dense HNSW + native BM25<br/>hybrid_search + RRF")]
    NEO4J[("Neo4j 5<br/>Chunk + Entity graph<br/>vector-seed → 1-hop")]
  end

  subgraph ING["INGESTION &nbsp; chunk → contextualize → index"]
    SRC["Docling (PDF/DOCX) · Crawl4AI (web)<br/>SearXNG (search) · pasted text"]
  end

  RL --> MILVUS & NEO4J
  WF --> SRC
  SRC --> MILVUS & NEO4J

  subgraph PROV["MODEL PROVIDERS"]
    LLM["LLM · Ollama Cloud<br/>minimax-m3"]
    RER["Reranker<br/>bge-reranker-v2-m3"]
    EMB["Embeddings · OpenAI<br/>text-embedding-3-large (3072-d)"]
  end

  GEN --> LLM
  RR --> RER
  MILVUS -.embed.-> EMB
  NEO4J -.entity extraction.-> LLM

  subgraph PG["POSTGRES 16 &nbsp; shared psycopg AsyncConnectionPool"]
    CKPT[("LangGraph checkpoints<br/>thread state + HITL resume")]
    RUNS[("runs · /ask audit log")]
    CTX[("thread_context · pins")]
  end

  CTRL -->|"AsyncPostgresSaver (pooled)"| CKPT
  API --> RUNS & CTX

  EVAL["EVAL HARNESS · RAGAS + precision@k / nDCG · eval/evaluate.py"] -.A/B each layer.-> DATA
  DEPLOY["DEPLOY · Mac Mini / Tailscale · launchd: api:8000 · langgraph:2024 · vite:5173 · auto-deploy on push to main"]
  API -.deployed as.-> DEPLOY
```

## Layers

| Layer | What it is |
|---|---|
| **Web UI** | React 19 + shadcn/ui (Tailwind v4) + TanStack Router/Query/Table/Form + i18next (EN/RU), light/dark. Talks to FastAPI over `fetch`, with SSE for streamed answers. |
| **API** | FastAPI (`api/main.py`, :8000) with domain routers. A lifespan opens the Postgres pool + the compiled graph. |
| **Control plane** | LangGraph `StateGraph` (`graphs/rag_qa`): `retrieve_local` → conditional `web_fallback` (HITL `interrupt()`) → `rerank` → `generate`. Checkpointed in Postgres via a **pooled** `AsyncPostgresSaver`, so threads + interrupts survive restarts. |
| **Data plane** | Raw async clients (not LangChain wrappers): **Milvus 2.6** dense HNSW + native BM25, fused with RRF; **Neo4j 5** chunk+entity graph, vector-seed then 1-hop traverse. |
| **Ingestion** | Docling (PDF/DOCX) · Crawl4AI (web) · SearXNG (search) · text → recursive chunk → contextual prefix → index into both stores. |
| **Providers** | LLM: Ollama Cloud `minimax-m3`. Embeddings: OpenAI `text-embedding-3-large` (3072-d). Reranker: `BAAI/bge-reranker-v2-m3` cross-encoder (MPS/CUDA/CPU). |
| **Persistence** | Postgres 16 (one shared psycopg pool): LangGraph checkpoints, the `runs` audit log, and `thread_context` pins/exclusions. |
| **Eval & deploy** | RAGAS + precision@k/nDCG harness (`eval/`); deployed on a Mac Mini (Tailscale) as launchd services, auto-deployed on push to `main`. |
