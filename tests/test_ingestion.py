"""Tests for the ingestion module.

Strategy:
- SearXNG is exercised by patching `httpx.AsyncClient.get` to return real
  `httpx.Response` objects (respx had matching issues in this repo, so we
  use unittest.mock returning genuine Responses instead).
- The SearXNG -> ddgs fallback is tested by making the SearXNG call raise and
  asserting ddgs is called (ddgs is mocked too — no live network).
- Docling and Crawl4AI live calls are marked `integration` and skipped by
  default; the unit tests mock `DocumentConverter` / `AsyncWebCrawler`.
"""

from __future__ import annotations

import importlib
import os
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion.pdf import parse_file
from sovereign_rag.ingestion.search import search, search_and_crawl

# NOTE: the ingestion package __init__ re-exports `search`/`crawl_url` as names,
# which shadows the submodule attributes. `import sovereign_rag.ingestion.search
# as search_mod` would therefore bind the *function*, not the module. Resolve the
# real module objects via importlib so we can patch their globals.
search_mod = importlib.import_module("sovereign_rag.ingestion.search")
web_mod = importlib.import_module("sovereign_rag.ingestion.web")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _json_response(payload: dict[str, Any], status_code: int = 200) -> httpx.Response:
    """Build a real httpx.Response (so .json()/.raise_for_status() behave)."""
    return httpx.Response(
        status_code=status_code,
        json=payload,
        request=httpx.Request("GET", "http://localhost:8080/search"),
    )


# ---------------------------------------------------------------------------
# search() — SearXNG happy path + normalization
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_search_searxng_normalizes_results() -> None:
    """SearXNG results are normalized to {title, url, content}."""
    payload = {
        "results": [
            {"title": "First", "url": "https://a.example", "content": "alpha"},
            {"title": "Second", "url": "https://b.example", "content": "beta"},
        ]
    }
    with patch.object(
        httpx.AsyncClient, "get", new=AsyncMock(return_value=_json_response(payload))
    ):
        results = await search("query", max_results=5)

    assert results == [
        {"title": "First", "url": "https://a.example", "content": "alpha"},
        {"title": "Second", "url": "https://b.example", "content": "beta"},
    ]


@pytest.mark.unit
async def test_search_searxng_respects_max_results() -> None:
    """max_results truncates the SearXNG result list."""
    payload = {
        "results": [
            {"title": f"r{i}", "url": f"https://{i}.example", "content": f"c{i}"} for i in range(10)
        ]
    }
    with patch.object(
        httpx.AsyncClient, "get", new=AsyncMock(return_value=_json_response(payload))
    ):
        results = await search("query", max_results=3)

    assert len(results) == 3
    assert {r["url"] for r in results} == {
        "https://0.example",
        "https://1.example",
        "https://2.example",
    }


@pytest.mark.unit
async def test_search_skips_results_without_url() -> None:
    """Results missing a url are dropped during normalization."""
    payload = {
        "results": [
            {"title": "no-url", "content": "x"},
            {"title": "ok", "url": "https://ok.example", "content": "y"},
        ]
    }
    with patch.object(
        httpx.AsyncClient, "get", new=AsyncMock(return_value=_json_response(payload))
    ):
        results = await search("query")

    assert results == [{"title": "ok", "url": "https://ok.example", "content": "y"}]


# ---------------------------------------------------------------------------
# search() — fallback to ddgs
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_search_falls_back_to_ddgs_on_searxng_error() -> None:
    """If SearXNG raises, ddgs is used and its title/href/body is normalized."""
    ddgs_raw = [
        {"title": "DDG One", "href": "https://ddg.example/1", "body": "snippet one"},
    ]
    fake_ddgs_cm = MagicMock()
    fake_ddgs_cm.__enter__.return_value.text.return_value = ddgs_raw
    fake_ddgs_cm.__exit__.return_value = False

    with (
        patch.object(
            httpx.AsyncClient,
            "get",
            new=AsyncMock(side_effect=httpx.ConnectError("refused")),
        ),
        patch("ddgs.DDGS", return_value=fake_ddgs_cm) as ddgs_cls,
    ):
        results = await search("query", max_results=4)

    # ddgs was actually invoked as the fallback.
    ddgs_cls.assert_called_once()
    fake_ddgs_cm.__enter__.return_value.text.assert_called_once_with("query", max_results=4)
    assert results == [
        {"title": "DDG One", "url": "https://ddg.example/1", "content": "snippet one"},
    ]


@pytest.mark.unit
async def test_search_falls_back_to_ddgs_on_http_403() -> None:
    """A non-2xx SearXNG response (e.g. JSON not enabled -> 403) triggers ddgs."""
    fake_ddgs_cm = MagicMock()
    fake_ddgs_cm.__enter__.return_value.text.return_value = [
        {"title": "fallback", "href": "https://f.example", "body": "b"}
    ]
    fake_ddgs_cm.__exit__.return_value = False

    forbidden = httpx.Response(
        status_code=403, request=httpx.Request("GET", "http://localhost:8080/search")
    )

    with (
        patch.object(httpx.AsyncClient, "get", new=AsyncMock(return_value=forbidden)),
        patch("ddgs.DDGS", return_value=fake_ddgs_cm),
    ):
        results = await search("query")

    assert results == [{"title": "fallback", "url": "https://f.example", "content": "b"}]


@pytest.mark.unit
async def test_search_falls_back_when_searxng_returns_empty() -> None:
    """An empty SearXNG result set falls through to ddgs."""
    fake_ddgs_cm = MagicMock()
    fake_ddgs_cm.__enter__.return_value.text.return_value = [
        {"title": "t", "href": "https://x.example", "body": "b"}
    ]
    fake_ddgs_cm.__exit__.return_value = False

    with (
        patch.object(
            httpx.AsyncClient, "get", new=AsyncMock(return_value=_json_response({"results": []}))
        ),
        patch("ddgs.DDGS", return_value=fake_ddgs_cm) as ddgs_cls,
    ):
        results = await search("query")

    ddgs_cls.assert_called_once()
    assert results[0]["url"] == "https://x.example"


# ---------------------------------------------------------------------------
# search_and_crawl()
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_search_and_crawl_tags_search_and_skips_failures() -> None:
    """Crawls each hit; tags SEARCH; skips URLs whose crawl raises."""
    hits = [
        {"title": "Good", "url": "https://good.example", "content": "good snippet"},
        {"title": "Bad", "url": "https://bad.example", "content": "bad snippet"},
    ]

    async def fake_crawl(url: str) -> SourceDocument:
        if url == "https://bad.example":
            raise RuntimeError("boom")
        return SourceDocument(
            title="Good Page",
            source_uri=url,
            source_type=SourceType.WEB,
            markdown="# good",
        )

    with (
        patch.object(search_mod, "search", new=AsyncMock(return_value=hits)),
        patch.object(search_mod, "crawl_url", new=AsyncMock(side_effect=fake_crawl)),
    ):
        docs = await search_and_crawl("query", max_results=2)

    assert len(docs) == 1
    doc = docs[0]
    assert doc.source_type is SourceType.SEARCH
    assert doc.source_uri == "https://good.example"
    assert doc.metadata["search_query"] == "query"
    assert doc.metadata["search_snippet"] == "good snippet"


@pytest.mark.unit
async def test_search_and_crawl_backfills_title_from_hit() -> None:
    """A crawled doc with no title inherits the search hit's title."""
    hits = [{"title": "Hit Title", "url": "https://t.example", "content": "snip"}]

    async def fake_crawl(url: str) -> SourceDocument:
        return SourceDocument(
            title="",
            source_uri=url,
            source_type=SourceType.WEB,
            markdown="body",
        )

    with (
        patch.object(search_mod, "search", new=AsyncMock(return_value=hits)),
        patch.object(search_mod, "crawl_url", new=AsyncMock(side_effect=fake_crawl)),
    ):
        docs = await search_and_crawl("query", max_results=1)

    assert docs[0].title == "Hit Title"


# ---------------------------------------------------------------------------
# parse_file() — Docling mocked
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_parse_file_maps_to_source_document(tmp_path: Path) -> None:
    """parse_file maps a mocked Docling conversion to a SourceDocument."""
    from docling.datamodel.base_models import ConversionStatus

    pdf_path = tmp_path / "report.pdf"
    pdf_path.write_bytes(b"%PDF-1.4 fake")

    fake_document = MagicMock()
    fake_document.export_to_markdown.return_value = "# Report\n\nbody text"
    fake_document.name = "Report"
    fake_document.origin = SimpleNamespace(filename="report.pdf")

    fake_result = SimpleNamespace(status=ConversionStatus.SUCCESS, document=fake_document)
    fake_converter = MagicMock()
    fake_converter.convert.return_value = fake_result

    with patch("sovereign_rag.ingestion.pdf.DocumentConverter", return_value=fake_converter):
        doc = await parse_file(pdf_path)

    assert isinstance(doc, SourceDocument)
    assert doc.markdown == "# Report\n\nbody text"
    assert doc.source_type is SourceType.PDF
    assert doc.title == "Report"
    assert doc.source_uri == str(pdf_path)
    fake_converter.convert.assert_called_once()


@pytest.mark.unit
async def test_parse_file_docx_source_type(tmp_path: Path) -> None:
    """A .docx file is tagged SourceType.DOCX and falls back to filename title."""
    from docling.datamodel.base_models import ConversionStatus

    docx_path = tmp_path / "memo.docx"
    docx_path.write_bytes(b"PK fake docx")

    fake_document = MagicMock()
    fake_document.export_to_markdown.return_value = "memo body"
    fake_document.name = None
    fake_document.origin = None

    fake_result = SimpleNamespace(status=ConversionStatus.SUCCESS, document=fake_document)
    fake_converter = MagicMock()
    fake_converter.convert.return_value = fake_result

    with patch("sovereign_rag.ingestion.pdf.DocumentConverter", return_value=fake_converter):
        doc = await parse_file(docx_path)

    assert doc.source_type is SourceType.DOCX
    assert doc.title == "memo"  # file stem fallback


@pytest.mark.unit
async def test_parse_file_missing_raises() -> None:
    """A non-existent path raises FileNotFoundError before touching Docling."""
    with pytest.raises(FileNotFoundError):
        await parse_file("/no/such/file.pdf")


@pytest.mark.unit
async def test_parse_file_failed_status_raises(tmp_path: Path) -> None:
    """A non-success Docling status raises RuntimeError."""
    from docling.datamodel.base_models import ConversionStatus

    pdf_path = tmp_path / "broken.pdf"
    pdf_path.write_bytes(b"%PDF junk")

    fake_result = SimpleNamespace(status=ConversionStatus.FAILURE, document=MagicMock())
    fake_converter = MagicMock()
    fake_converter.convert.return_value = fake_result

    with (
        patch("sovereign_rag.ingestion.pdf.DocumentConverter", return_value=fake_converter),
        pytest.raises(RuntimeError),
    ):
        await parse_file(pdf_path)


# ---------------------------------------------------------------------------
# crawl_url() — Crawl4AI mocked
# ---------------------------------------------------------------------------


@pytest.mark.unit
async def test_crawl_url_maps_to_source_document() -> None:
    """crawl_url maps a mocked Crawl4AI result to a WEB SourceDocument."""
    fake_result = SimpleNamespace(
        success=True,
        markdown="# Crawled\n\ncontent",
        metadata={"title": "Crawled Page"},
        status_code=200,
        error_message=None,
    )

    fake_crawler = MagicMock()
    fake_crawler.__aenter__ = AsyncMock(return_value=fake_crawler)
    fake_crawler.__aexit__ = AsyncMock(return_value=False)
    fake_crawler.arun = AsyncMock(return_value=fake_result)

    with patch.object(web_mod, "AsyncWebCrawler", return_value=fake_crawler):
        doc = await web_mod.crawl_url("https://example.com")

    assert doc.source_type is SourceType.WEB
    assert doc.markdown == "# Crawled\n\ncontent"
    assert doc.title == "Crawled Page"
    assert doc.source_uri == "https://example.com"
    fake_crawler.arun.assert_awaited_once()


@pytest.mark.unit
async def test_crawl_url_raises_on_failure() -> None:
    """A failed crawl (success=False) raises RuntimeError."""
    fake_result = SimpleNamespace(
        success=False, markdown=None, metadata={}, status_code=503, error_message="blocked"
    )

    fake_crawler = MagicMock()
    fake_crawler.__aenter__ = AsyncMock(return_value=fake_crawler)
    fake_crawler.__aexit__ = AsyncMock(return_value=False)
    fake_crawler.arun = AsyncMock(return_value=fake_result)

    with (
        patch.object(web_mod, "AsyncWebCrawler", return_value=fake_crawler),
        pytest.raises(RuntimeError),
    ):
        await web_mod.crawl_url("https://blocked.example")


@pytest.mark.unit
async def test_crawl_url_stealth_without_camoufox_raises() -> None:
    """crawl_url_stealth raises a clear error when camoufox is not installed."""
    import builtins

    real_import = builtins.__import__

    def fake_import(name: str, *args: Any, **kwargs: Any) -> Any:
        if name == "camoufox":
            raise ImportError("No module named 'camoufox'")
        return real_import(name, *args, **kwargs)

    with (
        patch.object(builtins, "__import__", side_effect=fake_import),
        pytest.raises(RuntimeError, match="camoufox"),
    ):
        await web_mod.crawl_url_stealth("https://example.com")


# ---------------------------------------------------------------------------
# Integration tests (skipped by default — need real files/network/browsers)
#
# These hit the real Crawl4AI browser / Docling models. Following the repo
# convention (cf. RUN_NEO4J_IT in test_neo4j_store.py) they are opt-in via an
# env var so a bare `pytest` never tries to launch Playwright.
# ---------------------------------------------------------------------------

_RUN_LIVE = os.getenv("RUN_INGESTION_IT") == "1"
_skip_live = pytest.mark.skipif(
    not _RUN_LIVE, reason="needs browser/models (set RUN_INGESTION_IT=1)"
)


@pytest.mark.integration
@_skip_live
async def test_crawl_url_live() -> None:  # pragma: no cover - needs a browser
    doc = await web_mod.crawl_url("https://example.com")
    assert doc.markdown
    assert doc.source_type is SourceType.WEB


@pytest.mark.integration
@_skip_live
async def test_parse_file_live(tmp_path: Path) -> None:  # pragma: no cover - needs real file
    pytest.skip("requires a real PDF fixture and Docling models")
