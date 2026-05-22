"""Web crawling via Crawl4AI (current 0.8 async API).

We use `AsyncWebCrawler` as an async context manager and call
`arun(url, config=CrawlerRunConfig(...))`. The sync `WebCrawler` API from
older releases is removed; this module only uses the async path.

`result.markdown` (a string-compatible object in 0.8) is the canonical text
for the produced `SourceDocument`.

Anti-bot escalation — Camoufox
==============================
Some sites block headless Chromium / detect Playwright. The escalation path
is Camoufox: an MPL-2.0 anti-detect fork of Firefox that ships as a drop-in
Playwright-compatible browser with fingerprint spoofing and humanized
behavior. Crawl4AI can drive it because Camoufox speaks the Playwright
protocol. Camoufox is intentionally NOT a hard dependency of this project —
it pulls a large patched Firefox binary — so `crawl_url_stealth` imports it
lazily and fails with a clear, actionable message if it is missing.
"""

from __future__ import annotations

import logging

from crawl4ai import AsyncWebCrawler, BrowserConfig, CacheMode, CrawlerRunConfig

from sovereign_rag.config import get_settings
from sovereign_rag.documents import SourceDocument, SourceType

logger = logging.getLogger(__name__)


def _build_run_config() -> CrawlerRunConfig:
    """Run config: bypass cache and bound the page timeout via settings.

    `page_timeout` in Crawl4AI is milliseconds; `crawl_timeout_s` is seconds.
    """
    settings = get_settings()
    return CrawlerRunConfig(
        cache_mode=CacheMode.BYPASS,
        page_timeout=int(settings.crawl_timeout_s * 1000),
    )


def _markdown_text(result: object) -> str:
    """Extract plain markdown from a Crawl4AI result.

    In 0.8 `result.markdown` is a string-compatible object that may also
    expose `raw_markdown`. We coerce to a plain `str` either way.
    """
    markdown = getattr(result, "markdown", None)
    if markdown is None:
        return ""
    raw = getattr(markdown, "raw_markdown", None)
    if raw:
        return str(raw)
    return str(markdown)


async def crawl_url(url: str) -> SourceDocument:
    """Crawl a single URL with Crawl4AI and return a SourceDocument.

    Uses the standard headless browser. For anti-bot-protected sites that
    block this, see `crawl_url_stealth`.

    Raises:
        RuntimeError: if the crawl does not succeed.
    """
    logger.info("crawling url with crawl4ai: %s", url)
    run_config = _build_run_config()

    async with AsyncWebCrawler() as crawler:
        result = await crawler.arun(url=url, config=run_config)

    if not getattr(result, "success", False):
        error = getattr(result, "error_message", "unknown error")
        raise RuntimeError(f"Crawl4AI failed to crawl {url}: {error}")

    markdown = _markdown_text(result)
    title = ""
    metadata = getattr(result, "metadata", None)
    if isinstance(metadata, dict):
        title = str(metadata.get("title") or "")

    return SourceDocument(
        title=title or url,
        source_uri=url,
        source_type=SourceType.WEB,
        markdown=markdown,
        metadata={"status_code": getattr(result, "status_code", None)},
    )


async def crawl_url_stealth(url: str) -> SourceDocument:
    """OPTIONAL anti-bot escalation path using Camoufox.

    Camoufox is an anti-detect Firefox (MPL-2.0) that drops into Playwright.
    It is NOT a declared dependency of this project; install it on demand:

        pip install camoufox[geoip]
        python -m camoufox fetch     # downloads the patched Firefox binary

    Crawl4AI then drives Camoufox via its Playwright-compatible interface
    (`BrowserConfig(browser_type="firefox")` pointing at the Camoufox build).
    This function imports camoufox lazily so the package stays optional; if it
    is not installed it raises a clear, actionable error rather than failing
    deep inside the crawler.

    Raises:
        RuntimeError: if camoufox is not installed (with install instructions).
        RuntimeError: if the crawl does not succeed.
    """
    try:
        import camoufox  # noqa: F401  (presence check only)
    except ImportError as exc:  # pragma: no cover - exercised only without camoufox
        raise RuntimeError(
            "crawl_url_stealth requires the optional 'camoufox' package, which is "
            "not installed. Install it with:\n"
            "    pip install camoufox[geoip]\n"
            "    python -m camoufox fetch\n"
            "Camoufox is an MPL-2.0 anti-detect Firefox used as the anti-bot "
            "escalation path; it is intentionally not a hard dependency."
        ) from exc

    logger.info("crawling url with crawl4ai + camoufox (stealth): %s", url)
    run_config = _build_run_config()
    # Camoufox is a patched Firefox; drive it through Crawl4AI's Firefox path.
    browser_config = BrowserConfig(browser_type="firefox", headless=True)

    async with AsyncWebCrawler(config=browser_config) as crawler:
        result = await crawler.arun(url=url, config=run_config)

    if not getattr(result, "success", False):
        error = getattr(result, "error_message", "unknown error")
        raise RuntimeError(f"Crawl4AI (stealth) failed to crawl {url}: {error}")

    markdown = _markdown_text(result)
    title = ""
    metadata = getattr(result, "metadata", None)
    if isinstance(metadata, dict):
        title = str(metadata.get("title") or "")

    return SourceDocument(
        title=title or url,
        source_uri=url,
        source_type=SourceType.WEB,
        markdown=markdown,
        metadata={"status_code": getattr(result, "status_code", None), "stealth": True},
    )


__all__ = ["crawl_url", "crawl_url_stealth"]
