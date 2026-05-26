"""Structured chunker for DBP BUSINESS PRODUCT.md (Russian banking corpus).

Routes a single Markdown document through three chunking strategies based on
section content, instead of the generic recursive splitter used by
``chunk_document``. This matters because PRODUCT.md mixes:

* prose how-tos (§1, §3-§12 narratives) → header-based chunks
* FAQ blocks (§27, §4.2, §29.11 …)      → one chunk per Q&A pair
* glossary / status / catalog tables    → one chunk per row, denormalized

Every emitted ``Chunk`` carries its ``h1_path`` ("§27.Платежи") prefixed
into ``text`` so hybrid retrieval picks up the section path lexically, and
the same path lives in ``metadata['title']`` so the Citations rail renders
it. ``raw_text`` stays clean for the user-visible snippet.

The module is I/O-free and unit-tested: ``chunk_product_md`` takes a string
and returns a ``list[Chunk]``. The actual indexing is wired in
``scripts/ingest_product_md.py``.
"""

from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass, field
from typing import Literal

from sovereign_rag.documents import Chunk

DocType = Literal["prose", "faq", "table", "mixed"]

# Hard cap so chunk.text stays under MilvusHybridStore._TEXT_MAX_LENGTH (8000).
# Leaves ~2KB headroom for the h1_path prefix + future safety.
_MAX_CHUNK_CHARS = 6000
# Prose splits aim for this size — small enough for tight recall, large
# enough to keep one §N.M leaf intact most of the time.
_TARGET_PROSE_CHARS = 2400

_H2_PATTERN = re.compile(r"^##\s+(?:(\d+(?:\.\d+)?)\.\s+)?(.+)$")
_H3_PATTERN = re.compile(r"^###\s+(?:(\d+(?:\.\d+)?)\.?\s+)?(.+)$")
_FAQ_PATTERN = re.compile(
    r"\*\*В:\s*(.+?)\*\*\s*\n+(?:О:\s*)?(.+?)(?=\n\s*\n\*\*В:|\n\s*\n###|\n\s*\n##|\Z)",
    re.DOTALL,
)
# A markdown table is detected by a row of pipe-separated dashes/colons.
_TABLE_SEPARATOR = re.compile(r"^\|\s*[:\-]+(?:\s*\|\s*[:\-]+)+\s*\|\s*$", re.MULTILINE)


@dataclass(slots=True)
class Section:
    """One H2/H3 leaf in the section tree."""

    level: int  # 2 for ##, 3 for ###
    number: str | None  # "27" or "27.1", may be None for unnumbered headings
    title: str
    body: str
    parent_number: str | None = None
    parent_title: str | None = None

    @property
    def section_id(self) -> str:
        """Best-effort stable id: §27.1 or hash of title."""
        if self.number:
            return f"§{self.number}"
        slug = re.sub(r"[^a-zа-я0-9]+", "-", self.title.lower(), flags=re.UNICODE).strip("-")
        return f"§{slug or 'untitled'}"

    @property
    def h1_path(self) -> str:
        """Render the breadcrumb a chunk will carry into Milvus + citations."""
        if self.level == 3 and self.parent_number and self.parent_title:
            return f"§{self.parent_number}. {self.parent_title} > {self.section_id} {self.title}"
        if self.level == 3 and self.parent_title:
            return f"{self.parent_title} > {self.section_id} {self.title}"
        return f"{self.section_id} {self.title}"


# ---------------------------------------------------------------------------
# parsing
# ---------------------------------------------------------------------------


def parse_sections(markdown: str) -> list[Section]:
    """Walk the document and emit one ``Section`` per leaf heading.

    Rules:

    * H2s without H3 children become a leaf.
    * H2s *with* H3 children are containers — only their H3s are leaves; the
      H2 body (if any) is folded into the first H3, since in practice it is
      a short orienting paragraph that belongs with the first subsection.
    * The "Содержание" (Table of Contents) H2 is skipped — it just repeats
      headings as a link list and would create duplicate-looking chunks.
    """
    lines = markdown.splitlines()
    leaves: list[Section] = []

    # Two-pass walk: first slice into H2 blocks, then recurse into H3s.
    h2_blocks: list[tuple[int, str | None, str, list[str]]] = []
    current: tuple[int, str | None, str, list[str]] | None = None
    for line in lines:
        m = _H2_PATTERN.match(line)
        if m:
            if current is not None:
                h2_blocks.append(current)
            number, title = m.group(1), m.group(2).strip()
            current = (2, number, title, [])
            continue
        if current is not None:
            current[3].append(line)
    if current is not None:
        h2_blocks.append(current)

    for _level, number, title, block_lines in h2_blocks:
        # Skip the table-of-contents block — it carries no information of
        # its own; every entry duplicates a real heading downstream.
        if title.strip().lower() == "содержание":
            continue

        # Split this H2's body into (pre-H3 prose, [H3 sections...])
        pre_h3_lines: list[str] = []
        h3_sections: list[tuple[str | None, str, list[str]]] = []
        cur_h3: tuple[str | None, str, list[str]] | None = None
        for line in block_lines:
            m3 = _H3_PATTERN.match(line)
            if m3:
                if cur_h3 is not None:
                    h3_sections.append(cur_h3)
                cur_h3 = (m3.group(1), m3.group(2).strip(), [])
                continue
            if cur_h3 is None:
                pre_h3_lines.append(line)
            else:
                cur_h3[2].append(line)
        if cur_h3 is not None:
            h3_sections.append(cur_h3)

        pre_h3_body = _normalize_body("\n".join(pre_h3_lines))

        if not h3_sections:
            # H2 is a leaf.
            if pre_h3_body:
                leaves.append(Section(level=2, number=number, title=title, body=pre_h3_body))
            continue

        # H2 is a container. Fold its pre-H3 prose into the first H3 so we
        # don't drop any orienting text. If pre_h3_body is empty, that's a
        # no-op.
        first_h3 = h3_sections[0]
        if pre_h3_body:
            h3_sections[0] = (first_h3[0], first_h3[1], [pre_h3_body, "", *first_h3[2]])

        for h3_number, h3_title, h3_body_lines in h3_sections:
            body = _normalize_body("\n".join(h3_body_lines))
            if not body:
                continue
            leaves.append(
                Section(
                    level=3,
                    number=h3_number,
                    title=h3_title,
                    body=body,
                    parent_number=number,
                    parent_title=title,
                )
            )

    return leaves


def _normalize_body(body: str) -> str:
    """Trim, drop horizontal-rule separators, collapse extreme blank runs."""
    # Strip the `---` thematic-break lines that PRODUCT.md uses between H2s;
    # they'd otherwise leak into the last section of each block.
    cleaned = re.sub(r"^---+\s*$", "", body, flags=re.MULTILINE)
    # Collapse 3+ blank lines to 2 for canonical paragraph boundaries.
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    return cleaned.strip()


# ---------------------------------------------------------------------------
# classification
# ---------------------------------------------------------------------------


def classify_section(section: Section) -> DocType:
    """Pick a chunking strategy based on what the section actually contains."""
    body = section.body
    has_faq = "**В:" in body
    has_table = bool(_TABLE_SEPARATOR.search(body))
    # When a section mixes paragraphs and a table (e.g. §16 status table with
    # surrounding prose) we route through 'mixed' so the table goes row-by-
    # row and the prose around it still becomes a header chunk.
    if has_faq and not has_table:
        return "faq"
    if has_table and not has_faq:
        # Pure table sections (§2 glossary, §8.2-style catalogs).
        rest = _TABLE_SEPARATOR.split(body)
        non_table_prose = sum(len(p.strip()) for p in rest if not _is_pipe_row(p)) - len(body)
        # If the prose around the table is trivial (<200 chars total), treat
        # as pure table. Otherwise it's mixed.
        if non_table_prose < 200:
            return "table"
        return "mixed"
    if has_faq and has_table:
        return "mixed"
    return "prose"


def _is_pipe_row(text: str) -> bool:
    """True if ``text`` looks like a markdown table row."""
    stripped = text.strip()
    return stripped.startswith("|") and stripped.endswith("|")


# ---------------------------------------------------------------------------
# chunking
# ---------------------------------------------------------------------------


@dataclass(slots=True)
class _ChunkPlan:
    """Tiny adaptor between parsed sections and the public ``Chunk`` type."""

    raw_text: str
    h1_path: str
    section: Section
    doc_type: DocType
    position: int
    extra_meta: dict[str, str] = field(default_factory=dict)


def chunk_product_md(
    markdown: str,
    *,
    doc_id: str,
    source_uri: str,
    document_title: str = "DBP BUSINESS — PRODUCT.md",
) -> list[Chunk]:
    """End-to-end: markdown → list[Chunk] ready for ``RAGPipeline.index_chunks``."""
    sections = parse_sections(markdown)
    plans: list[_ChunkPlan] = []
    position = 0
    for section in sections:
        doc_type = classify_section(section)
        if doc_type == "faq":
            for plan in _plan_faq(section, position):
                plans.append(plan)
                position += 1
        elif doc_type == "table":
            for plan in _plan_table(section, position):
                plans.append(plan)
                position += 1
        elif doc_type == "mixed":
            for plan in _plan_mixed(section, position):
                plans.append(plan)
                position += 1
        else:
            for plan in _plan_prose(section, position):
                plans.append(plan)
                position += 1
    return [_plan_to_chunk(p, doc_id=doc_id, source_uri=source_uri, title=document_title) for p in plans]


def _plan_prose(section: Section, start_position: int) -> list[_ChunkPlan]:
    """Header-based chunking; split oversized leaves at paragraph boundaries."""
    pieces = _split_prose(section.body, _TARGET_PROSE_CHARS, _MAX_CHUNK_CHARS)
    return [
        _ChunkPlan(
            raw_text=piece,
            h1_path=section.h1_path,
            section=section,
            doc_type="prose",
            position=start_position + i,
        )
        for i, piece in enumerate(pieces)
    ]


def _plan_faq(section: Section, start_position: int) -> list[_ChunkPlan]:
    """Atomic Q&A — every (question, answer) pair becomes its own chunk."""
    out: list[_ChunkPlan] = []
    for i, (question, answer) in enumerate(_extract_faq_pairs(section.body)):
        body = f"**В:** {question.strip()}\n**О:** {answer.strip()}"
        out.append(
            _ChunkPlan(
                raw_text=body,
                h1_path=section.h1_path,
                section=section,
                doc_type="faq",
                position=start_position + i,
                extra_meta={"question": question.strip()[:240]},
            )
        )
    return out


def _plan_table(section: Section, start_position: int) -> list[_ChunkPlan]:
    """Row-by-row, denormalized with the column headers prepended."""
    out: list[_ChunkPlan] = []
    i = 0
    for table in _extract_tables(section.body):
        for row in _denormalize_rows(table):
            out.append(
                _ChunkPlan(
                    raw_text=row,
                    h1_path=section.h1_path,
                    section=section,
                    doc_type="table",
                    position=start_position + i,
                )
            )
            i += 1
    return out


def _plan_mixed(section: Section, start_position: int) -> list[_ChunkPlan]:
    """Pull tables out as rows; treat surrounding prose as header chunks."""
    out: list[_ChunkPlan] = []
    pos = start_position

    pre_prose, tables, post_prose, faqs = _split_mixed(section.body)
    for piece in _split_prose(pre_prose, _TARGET_PROSE_CHARS, _MAX_CHUNK_CHARS):
        out.append(_ChunkPlan(piece, section.h1_path, section, "prose", pos))
        pos += 1
    for table in tables:
        for row in _denormalize_rows(table):
            out.append(_ChunkPlan(row, section.h1_path, section, "table", pos))
            pos += 1
    for piece in _split_prose(post_prose, _TARGET_PROSE_CHARS, _MAX_CHUNK_CHARS):
        out.append(_ChunkPlan(piece, section.h1_path, section, "prose", pos))
        pos += 1
    for question, answer in faqs:
        body = f"**В:** {question.strip()}\n**О:** {answer.strip()}"
        out.append(
            _ChunkPlan(
                body,
                section.h1_path,
                section,
                "faq",
                pos,
                extra_meta={"question": question.strip()[:240]},
            )
        )
        pos += 1
    return out


def _plan_to_chunk(
    plan: _ChunkPlan, *, doc_id: str, source_uri: str, title: str
) -> Chunk:
    """Build the public ``Chunk`` — text carries the breadcrumb prefix.

    ``chunk_id`` is deterministic per ``doc_id`` + position + content hash,
    so re-running the ingester against the same doc produces stable ids and
    the Milvus MERGE is a true upsert.
    """
    text = f"[{plan.h1_path}]\n\n{plan.raw_text}"
    body_hash = hashlib.sha1(plan.raw_text.encode("utf-8"), usedforsecurity=False).hexdigest()[:10]
    chunk_id = f"{doc_id}:{plan.position:04d}:{body_hash}"
    section_anchor = plan.section.section_id.lstrip("§")
    meta: dict[str, object] = {
        "title": title,
        "source_uri": f"{source_uri}#{section_anchor}",
        "section_id": plan.section.section_id,
        "h1_path": plan.h1_path,
        "doc_type": plan.doc_type,
    }
    meta.update(plan.extra_meta)
    return Chunk(
        doc_id=doc_id,
        text=text,
        raw_text=plan.raw_text,
        position=plan.position,
        page=None,
        chunk_id=chunk_id,
        metadata=meta,
    )


# ---------------------------------------------------------------------------
# helpers — split / extract
# ---------------------------------------------------------------------------


def _split_prose(body: str, target: int, hard_max: int) -> list[str]:
    """Split prose by blank lines, packing pieces up to ``target`` chars.

    A single paragraph longer than ``hard_max`` is force-split at sentence
    boundaries, then at character boundaries as a last resort. The Milvus
    VARCHAR ceiling (``_TEXT_MAX_LENGTH = 8000``) is non-negotiable.
    """
    body = body.strip()
    if not body:
        return []
    if len(body) <= target:
        return [body]

    paragraphs = re.split(r"\n\s*\n", body)
    out: list[str] = []
    buf: list[str] = []
    buf_len = 0
    for para in paragraphs:
        plen = len(para)
        if plen > hard_max:
            if buf:
                out.append("\n\n".join(buf))
                buf, buf_len = [], 0
            out.extend(_force_split(para, hard_max))
            continue
        if buf_len + plen + 2 > target and buf:
            out.append("\n\n".join(buf))
            buf, buf_len = [], 0
        buf.append(para)
        buf_len += plen + 2
    if buf:
        out.append("\n\n".join(buf))
    return [piece.strip() for piece in out if piece.strip()]


def _force_split(text: str, hard_max: int) -> list[str]:
    """Break a too-long paragraph at the last sentence end below ``hard_max``."""
    out: list[str] = []
    remaining = text
    while len(remaining) > hard_max:
        cut = remaining.rfind(". ", 0, hard_max)
        if cut == -1:
            cut = remaining.rfind(" ", 0, hard_max)
        if cut == -1:
            cut = hard_max
        out.append(remaining[: cut + 1].strip())
        remaining = remaining[cut + 1 :]
    if remaining.strip():
        out.append(remaining.strip())
    return out


def _extract_faq_pairs(body: str) -> list[tuple[str, str]]:
    """Yield (question, answer) tuples in source order."""
    return [(m.group(1), m.group(2)) for m in _FAQ_PATTERN.finditer(body)]


def _extract_tables(body: str) -> list[list[list[str]]]:
    """Return each markdown table as a list-of-rows-of-cells.

    Row 0 is the header; the separator row is dropped.
    """
    tables: list[list[list[str]]] = []
    current: list[list[str]] = []
    in_table = False
    for raw_line in body.splitlines():
        line = raw_line.rstrip()
        if _TABLE_SEPARATOR.match(line):
            in_table = True
            continue
        if line.startswith("|") and line.endswith("|"):
            cells = [c.strip() for c in line.strip("|").split("|")]
            current.append(cells)
            continue
        if in_table and current:
            tables.append(current)
            current = []
            in_table = False
        else:
            current = []
    if in_table and current:
        tables.append(current)
    return [t for t in tables if len(t) >= 2]


def _denormalize_rows(table: list[list[str]]) -> list[str]:
    """Render each data row as ``Header: cell``-style key/value lines."""
    if len(table) < 2:
        return []
    headers = [_strip_md(h) for h in table[0]]
    out: list[str] = []
    for row in table[1:]:
        cells = [_strip_md(c) for c in row]
        # Pad short rows so we never IndexError on ragged input.
        cells += [""] * max(0, len(headers) - len(cells))
        lines = [
            f"{header}: {cell}" for header, cell in zip(headers, cells, strict=False) if cell
        ]
        if lines:
            out.append("\n".join(lines))
    return out


def _strip_md(cell: str) -> str:
    """Strip leading/trailing ``**`` and backticks from a table cell."""
    text = cell.strip()
    text = re.sub(r"^\*\*(.+?)\*\*$", r"\1", text)
    text = text.strip("`")
    return text.strip()


def _split_mixed(
    body: str,
) -> tuple[str, list[list[list[str]]], str, list[tuple[str, str]]]:
    """Tear a mixed section apart for ``_plan_mixed``.

    Returns (pre-table prose, tables, post-table prose, faq pairs). Tables
    and FAQ blocks are pulled out structurally; prose either side keeps its
    original order.
    """
    tables = _extract_tables(body)
    faqs = _extract_faq_pairs(body)
    # Cheap strip: blank out table rows and FAQ blocks, then anything left
    # is the prose. We keep the order by splitting on the first table.
    no_tables = re.sub(r"(?m)^\|.*$\n?", "", body)
    no_tables = re.sub(_TABLE_SEPARATOR, "", no_tables)
    no_faqs = _FAQ_PATTERN.sub("", no_tables)
    prose = re.sub(r"\n{3,}", "\n\n", no_faqs).strip()
    # We don't try to slice pre/post — for our corpus, mixed sections always
    # have prose-before-table, so we put everything into pre_prose.
    return prose, tables, "", faqs


__all__ = [
    "DocType",
    "Section",
    "chunk_product_md",
    "classify_section",
    "parse_sections",
]
