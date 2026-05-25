"""FastAPI surface in front of the LangGraph QA orchestrator.

The API is organized by domain (per ``fastapi-best-practices``): each
subpackage owns its router, schemas, and (when warranted) service helpers.
``main.py`` constructs the FastAPI app, opens the LangGraph checkpointer in
the lifespan, and mounts every domain's router under the right prefix.

``sovereign_rag.api:app`` is the entry point that uvicorn / gunicorn / the
docker container point at — exported here so the import path stays stable
through the file → package migration.
"""

from sovereign_rag.api.main import app

__all__ = ["app"]
