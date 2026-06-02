"""CRAG config knob defaults."""

from __future__ import annotations

import pytest

from sovereign_rag.config import Settings


def test_crag_defaults(monkeypatch: pytest.MonkeyPatch) -> None:
    # WEB_FALLBACK_MAX_URLS may be set in the dev environment from a pre-existing
    # .env entry; unset it so we can assert the code default.
    monkeypatch.delenv("WEB_FALLBACK_MAX_URLS", raising=False)
    s = Settings(_env_file=None)  # ignore the local .env; assert code defaults
    assert s.enable_corrective_rag is False
    assert s.crag_correct_threshold == 0.70
    assert s.crag_incorrect_threshold == 0.30
    assert s.crag_max_corrections == 1
    assert s.crag_grader_tier == "light"
    assert s.web_fallback_max_urls == 5
    assert s.web_fallback_crawl_top_k == 3


def test_crag_thresholds_orderable() -> None:
    s = Settings(_env_file=None)
    assert s.crag_incorrect_threshold < s.crag_correct_threshold
