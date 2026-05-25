"""File parsing via Docling (IBM) — layout-aware PDF/DOCX → markdown.

Docling 2.x's `DocumentConverter().convert(path)` returns a `ConversionResult`
whose `.document` is a `DoclingDocument`. We export that to markdown via
`document.export_to_markdown()` — the canonical text for a `SourceDocument`.

Docling is synchronous and CPU-heavy (layout models, OCR), so the actual
conversion runs in `asyncio.to_thread` to keep the event loop free.
"""

from __future__ import annotations

import asyncio
import logging
from pathlib import Path

from docling.datamodel.base_models import ConversionStatus
from docling.datamodel.document import ConversionResult
from docling.document_converter import DocumentConverter

from sovereign_rag.documents import SourceDocument, SourceType

logger = logging.getLogger(__name__)

# Map file extensions to the SourceType we tag the document with.
_EXT_TO_SOURCE_TYPE: dict[str, SourceType] = {
    ".pdf": SourceType.PDF,
    ".docx": SourceType.DOCX,
}


def _source_type_for(path: Path) -> SourceType:
    """Pick a SourceType from the file extension, defaulting to TEXT."""
    return _EXT_TO_SOURCE_TYPE.get(path.suffix.lower(), SourceType.TEXT)


def _title_for(result: ConversionResult, path: Path) -> str:
    """Best-effort title: doc name, then origin filename, then file stem."""
    doc = result.document
    name = getattr(doc, "name", None)
    if name:
        return str(name)
    origin = getattr(doc, "origin", None)
    if origin is not None and getattr(origin, "filename", None):
        return str(origin.filename)
    return path.stem


def _convert(path: Path) -> ConversionResult:
    """Synchronous Docling conversion. Runs off the event loop via to_thread."""
    converter = DocumentConverter()
    return converter.convert(path)


async def parse_file(path: str | Path) -> SourceDocument:
    """Parse a PDF/DOCX (or other Docling-supported file) into a SourceDocument.

    The Docling conversion is synchronous and CPU-bound, so it is dispatched
    to a worker thread. The resulting markdown is the canonical document text.

    Raises:
        FileNotFoundError: if the path does not exist.
        RuntimeError: if Docling fails to convert the document.
    """
    file_path = Path(path)
    # Path.exists() is a sync stat() call — fast enough not to need offloading,
    # but ruff's ASYNC240 wants any disk touch off the event loop. Wrap it.
    if not await asyncio.to_thread(file_path.exists):
        raise FileNotFoundError(f"File not found: {file_path}")

    logger.info("parsing file with docling: %s", file_path)
    result = await asyncio.to_thread(_convert, file_path)

    if result.status not in (ConversionStatus.SUCCESS, ConversionStatus.PARTIAL_SUCCESS):
        raise RuntimeError(f"Docling failed to convert {file_path}: status={result.status}")

    markdown = result.document.export_to_markdown()
    source_type = _source_type_for(file_path)
    title = _title_for(result, file_path)

    return SourceDocument(
        title=title,
        source_uri=str(file_path),
        source_type=source_type,
        markdown=markdown,
        metadata={"docling_status": str(result.status)},
    )


__all__ = ["parse_file"]
