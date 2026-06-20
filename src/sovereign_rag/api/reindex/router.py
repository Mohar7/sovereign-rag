"""``/api/reindex/status`` + ``/api/embed-models``.

Read-only surfaces for the admin Embeddings UI: the catalog of selectable
embedding models (with their derived dimensions) and the live progress of an
in-flight corpus re-embed.
"""

from __future__ import annotations

from fastapi import APIRouter

from sovereign_rag.embeddings_registry import EMBED_MODELS

router = APIRouter(prefix="/api", tags=["reindex"])


@router.get("/reindex/status")
async def reindex_status() -> dict[str, object]:
    # Lazy import: main.py imports this router at app construction, while
    # sovereign_rag.reindex imports the settings service (which transitively
    # pulls main) — a top-level import here would close that cycle.
    from sovereign_rag.reindex import get_reindex_state

    s = get_reindex_state()
    return {"status": s.status, "total": s.total, "doneCount": s.done_count, "error": s.error}


@router.get("/embed-models")
async def embed_models() -> list[dict[str, object]]:
    return [
        {"id": m.id, "provider": m.provider, "dim": m.dim, "label": m.label} for m in EMBED_MODELS
    ]


__all__ = ["router"]
