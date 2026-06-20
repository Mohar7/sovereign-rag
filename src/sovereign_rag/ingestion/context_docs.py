"""Discovery + metadata for the ``docs/context-docs`` corpus (mkbank assistant).

Pure, I/O-light helpers for the batch ingester (``scripts/ingest_context_docs``):
walk the corpus tree, assign a business **segment**, derive a stable ``doc_id`` /
``title`` / ``source_uri``, and apply the *in-force* filter that drops
non-normative legal items (annual reports, repeal decrees, parliamentary notes).

Why this lives apart from the script: every decision here is a pure function of a
path (plus, for ``source_uri_for``, the markdown head), so it is unit-testable
without Docling, a network, or the stores. The script owns the actual parsing
and indexing.

macOS note: the filesystem returns filenames in **NFD** (decomposed), so every
filename comparison normalizes to **NFC** first — otherwise Cyrillic patterns
containing e.g. ``ў`` (which decomposes to ``у`` + combining breve) silently fail
to match.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

#: Corpus subdirectory name → business segment id.
SEGMENTS: dict[str, str] = {
    "Микро ва Кичик Бизнес": "micro_small",
    "Ўрта ва Йирик Бизнес": "medium_large",
    "lex.uz": "cb_legal",
}

#: Short human tag prepended to product-doc titles (visible in citations + BM25).
_SEGMENT_TITLE_TAG: dict[str, str] = {
    "micro_small": "[Микро/Кичик]",
    "medium_large": "[Ўрта/Йирик]",
}

#: ``only`` selector → the set of segments it admits.
_ONLY_SEGMENTS: dict[str, frozenset[str]] = {
    "all": frozenset(SEGMENTS.values()),
    "products": frozenset({"micro_small", "medium_large"}),
    "legal": frozenset({"cb_legal"}),
}

# In-force filter for the legal (cb_legal) set. Each rule is (reason, pattern)
# matched against the NFC-normalized filename stem (case-insensitive). Order
# matters only for which reason is reported first.
#
# Deliberately specific: a normative regulation that merely mentions "ҳисобот"
# (e.g. "молиявий ҳисоботларни ... тақдим этиш тартиби тўғрисидаги низом") must
# NOT be dropped — only annual *activity* reports are.
IN_FORCE_DROP_RULES: list[tuple[str, re.Pattern[str]]] = [
    ("repeal_decree", re.compile(r"ўз кучини йўқотган деб топиш", re.IGNORECASE)),
    (
        "annual_report",
        re.compile(
            r"фаолияти тўғрисидаги ҳисобот|юзасидан.{0,8}ҳисобот",
            re.IGNORECASE,
        ),
    ),
    (
        "info_item",
        re.compile(r"борасида амалга оширилаётган ишлар|парламент", re.IGNORECASE),
    ),
]

#: Pull the official source link out of a legal markdown head.
_LEXUZ_LINK = re.compile(r"\((https?://lex\.uz/[^)\s]+)\)")


@dataclass(slots=True)
class SourceSpec:
    """One discovered corpus file and everything derived from its path.

    ``drop_reason`` is ``None`` for files that should be ingested; a short tag
    (e.g. ``"annual_report"``) for legal items the in-force filter excludes.
    Dropped specs are still returned so the dry-run manifest can show them.
    """

    path: Path
    segment: str
    doc_id: str
    title: str
    source_uri: str
    is_markdown: bool
    drop_reason: str | None = None
    metadata: dict[str, str] = field(default_factory=dict)


def _nfc(text: str) -> str:
    """Normalize to NFC so NFD filenames from macOS match NFC patterns."""
    return unicodedata.normalize("NFC", text)


def segment_for(rel_path: Path) -> str | None:
    """Map a path (relative to the corpus root) to a segment id, or ``None``."""
    parts = rel_path.parts
    if not parts:
        return None
    return SEGMENTS.get(_nfc(parts[0]))


def is_combined_file(path: Path) -> bool:
    """True for the concatenated ``Барча_…бирлаштирилган.md`` (skip — it dupes)."""
    return _nfc(path.name).startswith("Барча_")


def doc_id_for(rel_path: Path, segment: str) -> str:
    """Stable, ASCII, ≤64-char id: ``ctx-<segment>-<sha1(nfc(relpath))[:10]>``."""
    digest = hashlib.sha1(
        _nfc(rel_path.as_posix()).encode("utf-8"), usedforsecurity=False
    ).hexdigest()[:10]
    return f"ctx-{segment}-{digest}"


def title_for(path: Path, segment: str) -> str:
    """Human title from the filename stem; product docs get a segment tag."""
    stem = _nfc(path.stem).strip()
    tag = _SEGMENT_TITLE_TAG.get(segment)
    title = f"{tag} {stem}" if tag else stem
    return title[:2000]  # stay well under the Milvus _META_MAX_LENGTH (2048)


def source_uri_for(path: Path, md_head: str | None) -> str:
    """Official ``lex.uz`` link if present in the markdown head, else ``file://``."""
    if md_head:
        m = _LEXUZ_LINK.search(md_head)
        if m:
            return m.group(1)
    return f"file://{path.resolve()}"


def _drop_reason_for(path: Path, segment: str, *, include_superseded: bool) -> str | None:
    """Apply the in-force filter to a legal file; ``None`` means keep."""
    if segment != "cb_legal" or include_superseded:
        return None
    stem = _nfc(path.stem)
    for reason, pattern in IN_FORCE_DROP_RULES:
        if pattern.search(stem):
            return reason
    return None


def discover(
    root: Path,
    *,
    only: str = "all",
    include_superseded: bool = False,
) -> list[SourceSpec]:
    """Walk ``root`` and return one ``SourceSpec`` per ingestable corpus file.

    Skips ``.DS_Store`` and the combined ``Барча_*`` file. Files outside the
    known segment dirs are skipped entirely. The ``only`` selector
    (``all`` | ``products`` | ``legal``) restricts which segments are returned.
    Legal items excluded by the in-force filter are returned with
    ``drop_reason`` set (so the manifest can list them); pass
    ``include_superseded=True`` to keep them.
    """
    admitted = _ONLY_SEGMENTS[only]
    specs: list[SourceSpec] = []
    for path in sorted(root.rglob("*"), key=lambda p: _nfc(p.as_posix())):
        if not path.is_file() or path.name == ".DS_Store" or is_combined_file(path):
            continue
        rel = path.relative_to(root)
        segment = segment_for(rel)
        if segment is None or segment not in admitted:
            continue
        is_md = path.suffix.lower() == ".md"
        specs.append(
            SourceSpec(
                path=path,
                segment=segment,
                doc_id=doc_id_for(rel, segment),
                title=title_for(path, segment),
                # source_uri for md is resolved later (needs the head); seed file://.
                source_uri=f"file://{path.resolve()}",
                is_markdown=is_md,
                drop_reason=_drop_reason_for(path, segment, include_superseded=include_superseded),
                metadata={"segment": segment, "language": "uz"},
            )
        )
    return specs


__all__ = [
    "IN_FORCE_DROP_RULES",
    "SEGMENTS",
    "SourceSpec",
    "discover",
    "doc_id_for",
    "is_combined_file",
    "segment_for",
    "source_uri_for",
    "title_for",
]
