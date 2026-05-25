"""Smoke test: invoke rag_qa graph from this Mac against remote services.

Loads .env from the project root and invokes `rag_qa.make_graph()` with a
test question. Hits remote Ollama / Milvus / Neo4j / OpenAI embeddings via
tailscale. LangSmith traces land in project `sovereign-rag`.

Run::

    uv run python scripts/smoke_rag_qa_local.py
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

from dotenv import load_dotenv

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(ROOT, ".env"), override=True)
sys.path.insert(0, os.path.join(ROOT, "src"))

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("urllib3").setLevel(logging.WARNING)


def _env_summary() -> None:
    keys = [
        "LANGSMITH_TRACING", "LANGSMITH_PROJECT",
        "OLLAMA_BASE_URL", "LLM_MODEL",
        "EMBED_PROVIDER", "EMBED_DIM",
        "MILVUS_URI", "MILVUS_COLLECTION",
        "NEO4J_URI",
        "ENABLE_LANGFUSE", "LANGFUSE_BASE_URL",
    ]
    print("=== env ===")
    for k in keys:
        print(f"{k}: {os.environ.get(k, '<unset>')}")
    print()


async def main() -> None:
    _env_summary()

    from sovereign_rag.graphs.rag_qa import make_graph

    graph = await make_graph()
    print(f"compiled: {type(graph).__name__}")
    print(f"nodes: {list(graph.get_graph().nodes.keys())}\n")

    question = "What is sovereign-rag?"
    print(f"invoking with: {question!r}")
    config = {"configurable": {"thread_id": "local-smoke-1"}}
    result = await graph.ainvoke({"question": question}, config=config)

    print("\n=== result ===")
    print(f"retrieved: {result.get('retrieved')}")
    print(f"used:      {result.get('used')}")
    print(f"citations: {len(result.get('citations') or [])}")
    answer = result.get("answer", "")
    print(f"answer:\n  {answer[:400]}{'...' if len(answer) > 400 else ''}")


if __name__ == "__main__":
    asyncio.run(main())
