"""Web search via self-hosted SearXNG, with a ddgs fallback.

Primary path: query the local SearXNG JSON API
(`GET {searxng_url}/search?q=...&format=json`) over httpx async.

GOTCHA — SearXNG JSON format must be enabled
============================================
A default SearXNG install only serves HTML and returns HTTP 403 for
`format=json`. To use this module you must enable JSON in `settings.yml`:

    search:
      formats:
        - html
        - json

Without that, every request raises and we transparently fall back to ddgs.

Fallback path: `ddgs` (the maintained successor to duckduckgo-search). Its
API is synchronous, so we run `DDGS().text(...)` in a worker thread via
`asyncio.to_thread`. ddgs returns dicts keyed `title` / `href` / `body`,
which we normalize to our `{title, url, content}` shape.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx

from sovereign_rag.config import get_settings
from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion.web import crawl_url

logger = logging.getLogger(__name__)


def _normalize_searxng(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Map SearXNG result objects to {title, url, content}."""
    normalized: list[dict[str, str]] = []
    for item in results:
        url = item.get("url", "")
        if not url:
            continue
        normalized.append(
            {
                "title": str(item.get("title", "")),
                "url": str(url),
                "content": str(item.get("content", "")),
            }
        )
    return normalized


def _normalize_ddgs(results: list[dict[str, Any]]) -> list[dict[str, str]]:
    """Map ddgs result dicts (title/href/body) to {title, url, content}."""
    normalized: list[dict[str, str]] = []
    for item in results:
        url = item.get("href") or item.get("url") or ""
        if not url:
            continue
        normalized.append(
            {
                "title": str(item.get("title", "")),
                "url": str(url),
                "content": str(item.get("body") or item.get("content") or ""),
            }
        )
    return normalized


def _ddgs_text(query: str, max_results: int) -> list[dict[str, Any]]:
    """Synchronous ddgs call, run off the event loop via to_thread."""
    from ddgs import DDGS

    with DDGS() as ddgs:
        return ddgs.text(query, max_results=max_results)


async def _search_ddgs(query: str, max_results: int) -> list[dict[str, str]]:
    """Fallback search using ddgs (sync API dispatched to a thread)."""
    logger.info("falling back to ddgs for query: %s", query)
    raw = await asyncio.to_thread(_ddgs_text, query, max_results)
    return _normalize_ddgs(raw)


async def search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    """Search the web, preferring self-hosted SearXNG, falling back to ddgs.

    Each result dict has keys: `title`, `url`, `content`. If SearXNG is
    unreachable or returns a non-2xx/invalid response, we fall back to ddgs.
    """
    settings = get_settings()
    url = f"{settings.searxng_url.rstrip('/')}/search"
    params = {"q": query, "format": "json"}

    try:
        async with httpx.AsyncClient(timeout=settings.crawl_timeout_s) as client:
            response = await client.get(url, params=params)
        response.raise_for_status()
        payload = response.json()
        results = payload.get("results", []) if isinstance(payload, dict) else []
        normalized = _normalize_searxng(results)[:max_results]
        if normalized:
            return normalized
        logger.warning("SearXNG returned no usable results; falling back to ddgs")
    except Exception:
        logger.warning(
            "SearXNG search failed (is JSON format enabled in settings.yml?); falling back to ddgs",
            exc_info=True,
        )

    return await _search_ddgs(query, max_results)


async def search_and_crawl(query: str, max_results: int = 3) -> list[SourceDocument]:
    """Search, then crawl each top result into a SourceDocument.

    Results are tagged `SourceType.SEARCH`. Individual crawl failures are
    logged and skipped so one bad URL never sinks the whole batch.
    """
    hits = await search(query, max_results=max_results)
    documents: list[SourceDocument] = []

    for hit in hits:
        target = hit["url"]
        try:
            doc = await crawl_url(target)
        except Exception:
            logger.warning("skipping URL that failed to crawl: %s", target, exc_info=True)
            continue
        # Re-tag as a search-sourced document and preserve the search snippet.
        doc.source_type = SourceType.SEARCH
        doc.metadata.setdefault("search_query", query)
        doc.metadata.setdefault("search_snippet", hit.get("content", ""))
        if not doc.title:
            doc.title = hit.get("title", "") or target
        documents.append(doc)

    return documents


__all__ = ["search", "search_and_crawl"]
