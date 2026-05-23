"""Runtime configuration. Everything is overridable via env / `.env`.

The whole stack is local-by-default: Ollama on :11434, Milvus on :19530,
Neo4j on :7687, SearXNG on :8080. No setting requires a paid API key.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ---- Ollama (LLM; optionally Ollama Cloud) ----
    ollama_base_url: str = "http://localhost:11434"
    # Set for Ollama Cloud (https://ollama.com); sent as a Bearer header.
    ollama_api_key: str = ""
    llm_model: str = "qwen2.5:7b"
    llm_temperature: float = 0.0
    # Generous context for contextual-retrieval prefixing of long docs.
    llm_num_ctx: int = 8192

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
    crawl_timeout_s: float = 30.0

    # ---- LangGraph orchestration ----
    # Postgres URI for the AsyncPostgresSaver checkpoint store. Default
    # matches the `postgres` service in docker-compose.yml (host port 5433,
    # since 5432 is often already in use by other dev stacks).
    langgraph_pg_uri: str = "postgresql://sovereign:sovereign-dev-pw@localhost:5433/sovereign_lg"
    # Web fallback fires when the local hybrid+graph retrieval returns fewer
    # than this many candidates (deduped, pre-rerank). Set 0 to disable.
    web_fallback_min_chunks: int = 3
    # Cap on URLs fetched per web fallback round (latency control).
    web_fallback_max_urls: int = 3

    # ---- Retrieval knobs ----
    retrieve_top_k: int = 50  # candidates before rerank
    rerank_top_k: int = 5  # final chunks to the LLM
    rrf_k: int = 60  # Reciprocal Rank Fusion constant
    enable_contextual_retrieval: bool = True
    enable_graph_retrieval: bool = True
    # Cross-encoder via sentence-transformers. bge-reranker-v2-m3 is multilingual
    # and SOTA among open rerankers; on Mac Mini / Apple Silicon it picks MPS,
    # on CUDA boxes it picks GPU, else CPU.
    reranker_model: str = "BAAI/bge-reranker-v2-m3"
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
