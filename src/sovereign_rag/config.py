"""Runtime configuration. Everything is overridable via env / `.env`.

The whole stack is local-by-default: Ollama on :11434, Milvus on :19530,
Neo4j on :7687, SearXNG on :8080. No setting requires a paid API key.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- LLM provider selection ----
    # "ollama" (local daemon or Ollama Cloud) or "openai". All ``shared.llm_factory``
    # callers and the legacy ``providers.ollama.get_llm`` route through this.
    llm_provider: str = "ollama"

    # ---- Ollama (LLM; optionally Ollama Cloud) ----
    ollama_base_url: str = "http://localhost:11434"
    # Set for Ollama Cloud (https://ollama.com); sent as a Bearer header.
    ollama_api_key: str = ""
    llm_model: str = "qwen2.5:7b"
    # Smaller tiers for cheap structured-output / fast tasks. Mirrors
    # FB_ASSESSOR's ``default | light | nano`` convention so graph nodes can
    # ask for the right size by intent rather than hardcoding a model name.
    llm_model_light: str = "qwen2.5:3b"
    llm_model_nano: str = "qwen2.5:1.5b"
    llm_temperature: float = 0.0
    # Generous context for contextual-retrieval prefixing of long docs.
    llm_num_ctx: int = 8192

    # ---- OpenAI chat models (used when llm_provider == "openai") ----
    # The ``llm_model*`` envs above carry the model IDs across providers; these
    # exist as explicit overrides when someone wants to set them separately. If
    # blank, the factory falls back to the matching ``llm_model*`` setting.
    openai_chat_model: str = ""  # tier=default
    openai_chat_model_light: str = ""  # tier=light
    openai_chat_model_nano: str = ""  # tier=nano

    # ---- Embeddings ----
    # "ollama" (local bge-m3) or "openai" (Ollama Cloud has no embeddings API).
    embed_provider: str = "ollama"
    embed_model: str = "bge-m3"  # used when embed_provider == "ollama"
    openai_api_key: str = ""
    openai_embed_model: str = "text-embedding-3-large"
    # Dense vector width. The Milvus collection schema is built from this, so it
    # MUST match the active embedder's output (bge-m3 → 1024; OpenAI 3-large → 3072).
    embed_dim: int = 1024

    # ---- Milvus ----
    milvus_uri: str = "http://localhost:19530"
    milvus_collection: str = "sovereign_chunks"

    # ---- Neo4j ----
    neo4j_uri: str = "neo4j://localhost:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "sovereign-dev-pw"
    neo4j_database: str = "neo4j"

    # ---- Web ingestion ----
    searxng_url: str = "http://localhost:8080"
    # Crawl4AI page_timeout (seconds). NOTE: this bounds page *navigation*, not
    # the browser launch/teardown — a hostile site (e.g. LinkedIn) can still
    # wedge past it, so the CRAG crawl_index node wraps each URL in an
    # additional hard wall-clock ceiling on top of this.
    crawl_timeout_s: float = 30.0
    # How many approved URLs the CRAG crawl_index node crawls concurrently.
    # Each crawl launches its own headless browser, so this caps parallel
    # browser instances; one slow/hostile URL can't serialize the rest.
    crawl_concurrency: int = 3

    # ---- LangGraph orchestration ----
    # Postgres URI for the AsyncPostgresSaver checkpoint store. Default
    # matches the `postgres` service in docker-compose.yml (host port 5433,
    # since 5432 is often already in use by other dev stacks).
    langgraph_pg_uri: str = "postgresql://sovereign:sovereign-dev-pw@localhost:5433/sovereign_lg"

    # ---- Retrieval knobs ----
    retrieve_top_k: int = 50  # candidates before rerank
    rerank_top_k: int = 5  # final chunks to the LLM
    rrf_k: int = 60  # Reciprocal Rank Fusion constant
    enable_contextual_retrieval: bool = True
    enable_graph_retrieval: bool = True
    # Per-channel toggles for the hybrid retriever. Disabling either weights
    # its branch to zero in the fusion step.
    dense_enabled: bool = True
    sparse_enabled: bool = True
    # Fusion strategy: "rrf" (default), "weighted" (uses the two weights below),
    # "borda" (rank-only positional voting). Only "rrf" is honored end-to-end
    # today; "weighted"/"borda" are accepted so the UI can persist the user's
    # choice. The pipeline falls back to RRF when an unsupported value is set.
    fusion_strategy: str = "rrf"  # rrf | weighted | borda
    fusion_graph_weight: float = 0.4
    fusion_vector_weight: float = 0.6
    # Graph BFS budget — passed to the Neo4j local_search().
    graph_depth: int = 2  # hops from seed entities
    graph_max_nodes: int = 60
    # Reranker post-filters. ``rerank_score_floor`` drops chunks below the
    # threshold so a weak context never reaches the LLM (0 disables). The
    # ``adaptive_rerank`` flag stops collecting once cumulative score-mass
    # crosses ~0.85 (saves LLM context on easy queries).
    rerank_score_floor: float = 0.0
    adaptive_rerank: bool = False
    # ---- Corrective RAG (CRAG) ----
    # Master toggle. Off by default so merging to main keeps the live /ask on the
    # linear graph until a later plan makes the API interrupt-aware.
    # False → the original linear retrieve→rerank→generate graph is built (no
    # grade/correction nodes). This is a build-time structural flag: changing it
    # requires recompiling the graph (process restart), so it is NOT part of the
    # per-request AskOverrides.
    enable_corrective_rag: bool = False
    # The grade band over the sigmoid-normalized top-1 reranker score (0..1):
    #   score >= correct   → Correct   (answer now, no LLM)
    #   score <= incorrect → Incorrect (correct via web, no LLM)
    #   in between         → one light-tier LLM call decides the label
    # Defaults are placeholders pending an empirical sweep on the golden set
    # (gte-reranker logits aren't centered — see the spec's risks section).
    crag_correct_threshold: float = 0.70
    crag_incorrect_threshold: float = 0.30
    # How many corrective web rounds before the graph answers with what it has.
    crag_max_corrections: int = 1
    # Index web-fallback docs the *fast* way: Milvus-only (dense + BM25), skipping
    # contextual-retrieval prefixing AND graph entity/relation extraction. Both of
    # those run one LLM call per chunk, so a long page takes minutes — far past the
    # crawl ceiling — which left the corrective loop indexing 0 chunks. The crawled
    # doc stays retrievable for the immediate re-retrieval; set False to fully
    # enrich web docs (much slower, not recommended for the interactive loop).
    crag_fast_web_index: bool = True
    # Model tier for the middle-band grader (mirrors llm_factory tiers).
    crag_grader_tier: Literal["default", "light", "nano"] = "light"
    # Candidate URLs surfaced to the human for approval per correction.
    web_fallback_max_urls: int = 5
    # URLs the eval auto-approver picks (Plan 3); unused by the product path.
    web_fallback_crawl_top_k: int = 3
    # Cross-encoder via sentence-transformers. Default: gte-reranker-modernbert-base
    # — 149M params (~3.8x smaller than bge-reranker-v2-m3), Apache 2.0, multilingual
    # via ModernBERT; matches nemotron-rerank-1b on Hit@1 at a fraction of memory.
    # On Mac Mini / Apple Silicon it picks MPS, on CUDA boxes it picks GPU, else CPU.
    # Override to "BAAI/bge-reranker-v2-m3" for the older battle-tested baseline,
    # or to "mixedbread-ai/mxbai-rerank-large-v2" for the stronger multilingual one.
    reranker_model: str = "Alibaba-NLP/gte-reranker-modernbert-base"
    reranker_device: str = "auto"  # auto | mps | cuda | cpu

    # ---- Observability ----
    # LangSmith (zero-code: langchain-core reads LANGSMITH_TRACING /
    # LANGSMITH_API_KEY / LANGSMITH_PROJECT directly from env).
    # Langfuse needs the three env vars below plus enable_langfuse=True.
    enable_langfuse: bool = False
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = "http://localhost:3100"


@lru_cache
def get_settings() -> Settings:
    return Settings()
