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

    # ---- Ollama ----
    ollama_base_url: str = "http://localhost:11434"
    llm_model: str = "qwen2.5:7b"
    embed_model: str = "bge-m3"
    # bge-m3 produces 1024-dim dense vectors. If you change embed_model,
    # change this to match — the Milvus collection schema is built from it.
    embed_dim: int = 1024
    llm_temperature: float = 0.0
    # Generous context for contextual-retrieval prefixing of long docs.
    llm_num_ctx: int = 8192

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

    # ---- Retrieval knobs ----
    retrieve_top_k: int = 50  # candidates before rerank
    rerank_top_k: int = 5  # final chunks to the LLM
    rrf_k: int = 60  # Reciprocal Rank Fusion constant
    enable_contextual_retrieval: bool = True
    enable_graph_retrieval: bool = True
    reranker_model: str = "ms-marco-MiniLM-L-12-v2"  # FlashRank default, CPU-friendly

    # ---- Observability ----
    enable_langfuse: bool = False


@lru_cache
def get_settings() -> Settings:
    return Settings()
