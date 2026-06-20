#!/usr/bin/env python
"""Batch ingester for ``docs/context-docs/`` — the mkbank assistant corpus.

Walks the corpus, applies the in-force filter (see
``sovereign_rag.ingestion.context_docs``), parses each file (Docling for
docx/pdf, direct read for md), and indexes it into Milvus **and** the Neo4j KB
with full enrichment (contextual-retrieval prefixing + entity/relationship
extraction).

Idempotent + resumable:

* Stable ``doc_id`` per file. ``--replace`` deletes a doc's prior chunks before
  re-indexing. Without it, docs already recorded in the progress file are
  skipped — so an interrupted run resumes where it stopped.
* ``--dry-run`` prints the kept/dropped manifest (and exact chunk counts for the
  markdown set) without touching the stores or burning embeddings.

Usage::

    uv run python scripts/ingest_context_docs.py --dry-run
    uv run python scripts/ingest_context_docs.py --only products
    uv run python scripts/ingest_context_docs.py            # full run (writes prod)
    uv run python scripts/ingest_context_docs.py --replace  # force re-ingest
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import unicodedata
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sovereign_rag.chunking import chunk_document
from sovereign_rag.documents import SourceDocument, SourceType
from sovereign_rag.ingestion import parse_file
from sovereign_rag.ingestion.context_docs import SourceSpec, discover, source_uri_for
from sovereign_rag.retrieval.pipeline import RAGPipeline

logger = logging.getLogger("ingest_context_docs")

_DEFAULT_ROOT = Path("docs/context-docs")
_DEFAULT_PROGRESS = Path(".ingest-context-progress.json")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Ingest docs/context-docs into Milvus + Neo4j")
    p.add_argument("--root", type=Path, default=_DEFAULT_ROOT, help="Corpus root")
    p.add_argument("--only", choices=["all", "products", "legal"], default="all")
    p.add_argument("--dry-run", action="store_true", help="Manifest only; no writes")
    p.add_argument("--replace", action="store_true", help="Delete prior chunks before indexing")
    p.add_argument(
        "--include-superseded",
        action="store_true",
        help="Keep legal items the in-force filter would drop",
    )
    p.add_argument("--limit", type=int, default=0, help="Index at most N docs (0 = no limit)")
    p.add_argument("--no-context", action="store_true", help="Skip contextual-retrieval prefixing")
    p.add_argument("--no-graph", action="store_true", help="Skip Neo4j KB extraction")
    p.add_argument("--progress-file", type=Path, default=_DEFAULT_PROGRESS)
    return p.parse_args()


def _load_progress(path: Path) -> dict[str, Any]:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            logger.warning("could not read progress file %s; starting fresh", path)
    return {"ingested": {}, "failed": {}}


def _save_progress(path: Path, state: dict[str, Any]) -> None:
    path.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


def _print_manifest(kept: list[SourceSpec], dropped: list[SourceSpec]) -> None:
    by_segment = Counter(s.segment for s in kept)
    print(f"\nKept {len(kept)} docs:")
    for seg, n in sorted(by_segment.items()):
        print(f"  {seg:14s} {n}")
    if dropped:
        by_reason = Counter(str(s.drop_reason) for s in dropped)
        print(f"\nDropped {len(dropped)} legal docs (in-force filter):")
        for reason, n in sorted(by_reason.items()):
            print(f"  {reason:16s} {n}")
        print("\n  (sample of dropped titles)")
        for s in dropped[:8]:
            print(f"    [{s.drop_reason}] {s.title[:90]}")
    print()


async def _build_doc(spec: SourceSpec) -> SourceDocument:
    """Parse one spec into a SourceDocument with corpus metadata applied."""
    if spec.is_markdown:
        text = unicodedata.normalize("NFC", spec.path.read_text(encoding="utf-8"))
        doc = SourceDocument(
            doc_id=spec.doc_id,
            title=spec.title,
            source_uri=source_uri_for(spec.path, text[:600]),
            source_type=SourceType.TEXT,
            markdown=text,
            metadata=dict(spec.metadata),
        )
    else:
        doc = await parse_file(spec.path)  # Docling (docx/pdf) → markdown
        doc.doc_id = spec.doc_id
        doc.title = spec.title
        doc.source_uri = spec.source_uri
        doc.metadata.update(spec.metadata)
    return doc


async def _amain(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)-7s %(name)s: %(message)s"
    )
    if not args.root.exists():
        print(f"error: corpus root not found: {args.root}", file=sys.stderr)
        return 2

    specs = discover(args.root, only=args.only, include_superseded=args.include_superseded)
    kept = [s for s in specs if s.drop_reason is None]
    dropped = [s for s in specs if s.drop_reason is not None]
    _print_manifest(kept, dropped)

    if args.dry_run:
        # Exact chunk count for markdown (cheap, no Docling); docx/pdf reported as-is.
        md_specs = [s for s in kept if s.is_markdown]
        total_md_chunks = 0
        for s in md_specs:
            text = unicodedata.normalize("NFC", s.path.read_text(encoding="utf-8"))
            doc = SourceDocument(
                doc_id=s.doc_id,
                title=s.title,
                source_uri=s.source_uri,
                source_type=SourceType.TEXT,
                markdown=text,
            )
            total_md_chunks += len(chunk_document(doc))
        n_files = len(kept) - len(md_specs)
        print(f"--dry-run: {len(md_specs)} markdown docs → {total_md_chunks} chunks (exact)")
        print(f"           {n_files} docx/pdf docs → chunked on the real run (Docling)")
        print("           each chunk = 1 embed + (context LLM) + (KB extraction LLM)")
        return 0

    if args.limit:
        kept = kept[: args.limit]

    progress = _load_progress(args.progress_file)
    ingested: dict[str, Any] = progress["ingested"]
    failed: dict[str, Any] = progress["failed"]

    pipe = RAGPipeline()
    n_indexed = n_skipped = n_failed = total_chunks = 0
    try:
        for i, spec in enumerate(kept, 1):
            if not args.replace and spec.doc_id in ingested:
                n_skipped += 1
                continue
            label = f"[{i}/{len(kept)}] {spec.segment} {spec.title[:70]}"
            try:
                doc = await _build_doc(spec)
                if args.replace:
                    await pipe.delete_document(spec.doc_id)
                n = await pipe.index_document(
                    doc, with_context=not args.no_context, with_graph=not args.no_graph
                )
                total_chunks += n
                n_indexed += 1
                ingested[spec.doc_id] = {
                    "title": spec.title,
                    "chunks": n,
                    "source_uri": doc.source_uri,
                    "ts": datetime.now(UTC).isoformat(),
                }
                failed.pop(spec.doc_id, None)
                _save_progress(args.progress_file, progress)
                logger.info("✓ %s → %d chunks", label, n)
            except Exception as exc:
                n_failed += 1
                failed[spec.doc_id] = {"title": spec.title, "error": str(exc)}
                _save_progress(args.progress_file, progress)
                logger.exception("✗ %s — %s", label, exc)
    finally:
        await pipe.aclose()

    print(
        f"\nDone: indexed={n_indexed} ({total_chunks} chunks), "
        f"skipped={n_skipped}, failed={n_failed}. Progress → {args.progress_file}"
    )
    return 1 if n_failed else 0


def main() -> int:
    return asyncio.run(_amain(_parse_args()))


if __name__ == "__main__":
    raise SystemExit(main())
