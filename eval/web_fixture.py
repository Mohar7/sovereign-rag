"""Recorded web fixture for deterministic, offline CRAG eval.

Patches the names ``search`` and ``crawl_url`` that ``graphs/rag_qa/nodes``
imported at module load, so the graph's ``web_search``/``crawl_index`` nodes use
canned SearXNG hits + crawled markdown instead of the network. Keyed by query
(substring match) and by URL (path stem → a markdown file under pages/).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sovereign_rag.documents import SourceDocument, SourceType

_FIX = Path(__file__).resolve().parent / "fixtures" / "web"
_HITS: dict[str, list[dict[str, str]]] = json.loads((_FIX / "hits.json").read_text("utf-8"))


async def fixture_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    """Canned SearXNG: return hits for the first key that is a casefold substring
    of the query (or whose key the query contains)."""
    q = query.casefold()
    for key, hits in _HITS.items():
        if key.casefold() in q or q in key.casefold():
            return hits[:max_results]
    return []


async def fixture_crawl_url(url: str) -> SourceDocument:
    """Canned Crawl4AI: read pages/<url-stem>.md as the page body."""
    stem = url.rstrip("/").rsplit("/", 1)[-1]
    body = (_FIX / "pages" / f"{stem}.md").read_text("utf-8")
    return SourceDocument(
        title=stem,
        source_uri=url,
        source_type=SourceType.WEB,
        markdown=body,
    )


def install() -> tuple[Any, Any]:
    """Patch the node module's search/crawl_url. Returns the originals."""
    from sovereign_rag.graphs.rag_qa import nodes

    orig = (nodes.search, nodes.crawl_url)
    nodes.search = fixture_search  # type: ignore[assignment]
    nodes.crawl_url = fixture_crawl_url  # type: ignore[assignment]
    return orig


def uninstall(orig_search: Any, orig_crawl: Any) -> None:
    """Restore the originals returned by install()."""
    from sovereign_rag.graphs.rag_qa import nodes

    nodes.search = orig_search
    nodes.crawl_url = orig_crawl


__all__ = ["fixture_crawl_url", "fixture_search", "install", "uninstall"]
