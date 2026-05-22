"""Ingestion: turn files, web pages, and searches into `SourceDocument`s.

- `pdf.parse_file` — Docling-based PDF/DOCX → markdown.
- `web.crawl_url` — Crawl4AI (async) URL → markdown.
- `search.search` / `search.search_and_crawl` — SearXNG (with ddgs fallback)
  search, optionally crawling the top hits into documents.

Everything here produces `SourceDocument`s (the shared contract); nothing in
this package depends on chunking/retrieval/storage.
"""

from __future__ import annotations

from sovereign_rag.ingestion.pdf import parse_file
from sovereign_rag.ingestion.search import search, search_and_crawl
from sovereign_rag.ingestion.web import crawl_url

__all__ = ["crawl_url", "parse_file", "search", "search_and_crawl"]
