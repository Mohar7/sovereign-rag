"""Hermetic tests for context-docs discovery + the in-force filter.

No network, no Docling, no stores — every assertion is a pure function of a
temp directory tree.
"""

from __future__ import annotations

import unicodedata
from pathlib import Path

from sovereign_rag.ingestion.context_docs import (
    SEGMENTS,
    discover,
    doc_id_for,
    is_combined_file,
    segment_for,
    source_uri_for,
    title_for,
)

# Real segment dir names (kept in one place so the test reads like the corpus).
_MICRO = "Микро ва Кичик Бизнес"
_LEGAL = "lex.uz"


def _make_corpus(root: Path) -> None:
    """Build a tiny but representative copy of the real corpus layout."""
    (root / _MICRO).mkdir(parents=True)
    (root / _LEGAL).mkdir(parents=True)
    # product docs
    (root / _MICRO / "Kreditlar МикроКичик.docx").write_text("x", encoding="utf-8")
    (root / _MICRO / "tarifff.pdf").write_text("x", encoding="utf-8")
    # legal: a normative regulation (keep)
    (root / _LEGAL / "2209 14.03.2011 нобанк кредит ташкилотлари текшириш тартиби.md").write_text(
        "[PDF манба](https://lex.uz/files/1758328.pdf)\n\n# НИЗОМ", encoding="utf-8"
    )
    # legal: annual activity report (drop)
    (
        root
        / _LEGAL
        / "504-I 27.06.2008 банкининг 2007 йилдаги фаолияти тўғрисидаги ҳисоботи ҳақида.md"
    ).write_text("report", encoding="utf-8")
    # legal: repeal decree (drop)
    (
        root
        / _LEGAL
        / "3385 09.09.2022 айрим ҳужжатларни ўз кучини йўқотган деб топиш тўғрисида.md"
    ).write_text("repeal", encoding="utf-8")
    # legal: normative reg that merely mentions ҳисобот (keep — not an annual report)
    (
        root
        / _LEGAL
        / "2322-2 05.04.2018 молиявий ҳисоботларни тақдим этиш тартиби тўғрисидаги низом.md"
    ).write_text("[манба](https://lex.uz/docs/999)\n\nнизом", encoding="utf-8")
    # noise that must be ignored
    (root / _LEGAL / ".DS_Store").write_text("noise", encoding="utf-8")
    (root / _LEGAL / "Барча_ҳужжатлар_бирлаштирилган.md").write_text("combined", encoding="utf-8")


def test_segments_map_to_ids() -> None:
    assert SEGMENTS["lex.uz"] == "cb_legal"
    assert segment_for(Path(_MICRO) / "x.docx") == "micro_small"
    assert segment_for(Path("unknown") / "x.md") is None


def test_is_combined_file_handles_nfd() -> None:
    # macOS hands back NFD; the check must still catch the combined file.
    nfd_name = unicodedata.normalize("NFD", "Барча_ҳужжатлар.md")
    assert is_combined_file(Path("lex.uz") / nfd_name)
    assert not is_combined_file(Path("lex.uz") / "2209 низом.md")


def test_doc_id_is_ascii_stable_and_short() -> None:
    rel = Path(_LEGAL) / "2209 низом.md"
    first = doc_id_for(rel, "cb_legal")
    assert first == doc_id_for(rel, "cb_legal")  # stable
    assert first.isascii()
    assert len(first) <= 64
    assert first.startswith("ctx-cb_legal-")


def test_doc_id_stable_across_nfc_nfd() -> None:
    nfc = Path(_LEGAL) / unicodedata.normalize("NFC", "тартиб низом.md")
    nfd = Path(_LEGAL) / unicodedata.normalize("NFD", "тартиб низом.md")
    assert doc_id_for(nfc, "cb_legal") == doc_id_for(nfd, "cb_legal")


def test_title_tags_products_only() -> None:
    assert title_for(Path(_MICRO) / "Kreditlar.docx", "micro_small").startswith("[Микро/Кичик] ")
    assert title_for(Path(_LEGAL) / "2209 низом.md", "cb_legal") == "2209 низом"


def test_source_uri_prefers_lexuz_link() -> None:
    head = "[PDF манба](https://lex.uz/files/1758328.pdf)\n\n# НИЗОМ"
    assert source_uri_for(Path("/x/a.md"), head) == "https://lex.uz/files/1758328.pdf"


def test_source_uri_falls_back_to_file(tmp_path: Path) -> None:
    p = tmp_path / "a.md"
    p.write_text("no link here", encoding="utf-8")
    assert source_uri_for(p, "no link here").startswith("file://")


def test_discover_skips_noise_and_combined(tmp_path: Path) -> None:
    _make_corpus(tmp_path)
    names = {s.path.name for s in discover(tmp_path)}
    assert not any(".DS_Store" in n for n in names)
    assert not any(n.startswith("Барча_") for n in names)


def test_in_force_filter_drops_reports_and_repeals(tmp_path: Path) -> None:
    _make_corpus(tmp_path)
    specs = discover(tmp_path)
    by_reason = {s.title: s.drop_reason for s in specs if s.segment == "cb_legal"}
    dropped = {t: r for t, r in by_reason.items() if r is not None}
    kept = {t for t, r in by_reason.items() if r is None}

    assert any(r == "annual_report" for r in dropped.values())
    assert any(r == "repeal_decree" for r in dropped.values())
    # The two genuinely normative regs survive (incl. the one mentioning ҳисобот).
    assert any("2209" in t for t in kept)
    assert any("2322-2" in t for t in kept)


def test_include_superseded_keeps_everything(tmp_path: Path) -> None:
    _make_corpus(tmp_path)
    specs = discover(tmp_path, include_superseded=True)
    assert all(s.drop_reason is None for s in specs)


def test_only_products_excludes_legal(tmp_path: Path) -> None:
    _make_corpus(tmp_path)
    specs = discover(tmp_path, only="products")
    assert {s.segment for s in specs} == {"micro_small"}
