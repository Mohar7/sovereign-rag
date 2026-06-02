"""The recorded web fixture patches the graph's search/crawl with canned data."""

from __future__ import annotations

from sovereign_rag.documents import SourceDocument


async def test_fixture_search_returns_canned_hits() -> None:
    from eval.web_fixture import fixture_crawl_url, fixture_search

    hits = await fixture_search("how is FERRET activation codeword provisioned", max_results=5)
    assert hits, "fixture must return hits for a known query"
    assert all({"title", "url", "content"} <= set(h) for h in hits)
    # the canned page is crawlable
    doc = await fixture_crawl_url(hits[0]["url"])
    assert isinstance(doc, SourceDocument)
    assert "activation" in doc.markdown.lower()


async def test_fixture_search_unknown_query_is_empty() -> None:
    from eval.web_fixture import fixture_search

    assert await fixture_search("totally unrelated query xyzzy", max_results=5) == []


def test_install_patches_node_module() -> None:
    from eval import web_fixture
    from sovereign_rag.graphs.rag_qa import nodes

    orig_search, orig_crawl = nodes.search, nodes.crawl_url
    try:
        web_fixture.install()
        assert nodes.search is web_fixture.fixture_search
        assert nodes.crawl_url is web_fixture.fixture_crawl_url
    finally:
        web_fixture.uninstall(orig_search, orig_crawl)
        assert nodes.search is orig_search
        assert nodes.crawl_url is orig_crawl
