# sovereign-rag — Claude project notes

Local-first GraphRAG: Milvus hybrid retrieval (dense + BM25 + RRF) ‖ Neo4j knowledge-graph local-search → cross-encoder reranking → LangGraph orchestration with HITL on web fallback. **Corrective RAG (CRAG)** self-correcting loop is implemented and ships default-OFF (`ENABLE_CORRECTIVE_RAG=true` to enable).

## Wiki Knowledge Base
Path: ~/Projects/llm-wiki

When you need context not already in this project:
1. Read `wiki/hot.md` first (recent context, ~500 words)
2. If not enough, read `wiki/index.md`
3. For codebase context, read `wiki/modules/sovereign_rag.graphs.rag_qa.md` (and siblings as they are added)
4. For RAG / LangGraph concepts, read `wiki/concepts/*.md`
5. Only then read individual wiki pages

Do NOT read the wiki for general Python questions, LangChain syntax, or anything already in this project's `src/` or `README.md`.

## Project conventions
- Python 3.12. `uv` for deps. `ruff` + `mypy --strict` + `pytest`.
- Tests marked `@pytest.mark.integration` are skipped unless services are up (gated by `RUN_*_IT=1`).
- Two-tier CI: GitHub-hosted runs unit tests; self-hosted Mac Mini runs integration + eval (uses Ollama Cloud + OpenAI embeddings — the only paid-API dependency).
- Data plane uses **raw** `pymilvus` and `neo4j-graphrag` — not LangChain wrappers, which hide Milvus native BM25 hybrid and Neo4j GraphRAG local-search.
- LangGraph for control plane only. Compile with `AsyncPostgresSaver` in prod; CLI dev-server attaches in-memory checkpointer.
- Every retrieval layer is env-toggleable so the eval harness can A/B each.

## Entry points
- API: `src/sovereign_rag/api/main.py` (FastAPI)
- Graphs: `src/sovereign_rag/graphs/rag_qa/graph.py:make_graph` + `src/sovereign_rag/graphs/indexer/graph.py:make_graph` (both exposed via `langgraph.json` as `rag_qa` + `indexer`)
- Eval: `eval/evaluate.py`

## Quick commands
```bash
uv sync                                  # install deps (run this after the recent move from ~/github-audit/)
uv run uvicorn sovereign_rag.api.main:app --reload
uv run langgraph dev                     # Studio UI
uv run pytest -m "not integration"       # unit tests, ~5s
uv run ruff check src/ tests/ eval/
uv run mypy src/
```
