"""Ingest endpoints — index text / file / URL / search hits into the corpus."""

from sovereign_rag.api.ingest.router import root_router, router

__all__ = ["root_router", "router"]
