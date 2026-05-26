#!/usr/bin/env python
"""Structured ingester for PRODUCT.md (DBP BUSINESS knowledge base).

Routes sections through three chunking strategies (prose / FAQ / table)
instead of the generic recursive splitter used by ``RAGPipeline.index_document``.
See ``sovereign_rag.ingestion.product_md`` for the parser/chunker.

Usage::

    uv run python scripts/ingest_product_md.py ~/Downloads/DBP/PRODUCT.md
    uv run python scripts/ingest_product_md.py ~/Downloads/DBP/PRODUCT.md --dry-run
    uv run python scripts/ingest_product_md.py ~/Downloads/DBP/PRODUCT.md \\
        --doc-id dbp-product-md --replace

``--replace`` deletes any previously ingested chunks for the same ``doc_id``
from Milvus + Neo4j before re-indexing (idempotent re-runs). ``--dry-run``
parses and chunks but never touches the stores — useful for sanity-checking
chunk counts without burning embeddings.
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from collections import Counter
from pathlib import Path

from sovereign_rag.ingestion.product_md import chunk_product_md
from sovereign_rag.retrieval.pipeline import RAGPipeline

logger = logging.getLogger("ingest_product_md")


def _parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ingest PRODUCT.md into Milvus + Neo4j")
    parser.add_argument("path", type=Path, help="Path to PRODUCT.md")
    parser.add_argument(
        "--doc-id",
        default="dbp-product-md",
        help="Stable document id (default: dbp-product-md)",
    )
    parser.add_argument(
        "--title",
        default="DBP BUSINESS — PRODUCT.md",
        help="Display title surfaced in citations",
    )
    parser.add_argument(
        "--source-uri",
        default=None,
        help="Source URI (default: file://<absolute path>)",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Delete existing chunks for this doc_id before re-indexing",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse + chunk only; do not embed or index",
    )
    return parser.parse_args()


async def _amain(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )

    if not args.path.exists():
        print(f"error: file not found: {args.path}", file=sys.stderr)
        return 2

    markdown = args.path.read_text(encoding="utf-8")
    source_uri = args.source_uri or f"file://{args.path.resolve()}"

    chunks = chunk_product_md(
        markdown,
        doc_id=args.doc_id,
        source_uri=source_uri,
        document_title=args.title,
    )

    by_type = Counter(str(c.metadata.get("doc_type", "?")) for c in chunks)
    print(f"\nParsed {len(chunks)} chunks from {args.path.name}:")
    for kind, count in sorted(by_type.items()):
        print(f"  {kind:6s} {count}")
    print()
    # Show a couple of samples so the user can eyeball the breadcrumb prefix.
    for sample in (chunks[0], chunks[len(chunks) // 2], chunks[-1]):
        print(f"  sample [{sample.metadata.get('doc_type')}] {sample.metadata.get('h1_path')}")
        print(f"    {sample.raw_text[:160].replace(chr(10), ' ⏎ ')}…")
    print()

    if args.dry_run:
        print("--dry-run: skipping embed + index")
        return 0

    pipe = RAGPipeline()
    try:
        if args.replace:
            print(f"deleting prior chunks for doc_id={args.doc_id} …")
            report = await pipe.delete_document(args.doc_id)
            print(f"  milvus chunks deleted: {report['chunks_deleted']}")
            print(f"  neo4j wiped:          {bool(report['graph_deleted'])}")

        print(f"indexing {len(chunks)} chunks into Milvus + Neo4j …")
        inserted = await pipe.index_chunks(chunks)
        print(f"✓ indexed {inserted} chunks")
    finally:
        await pipe.aclose()
    return 0


def main() -> int:
    args = _parse_args()
    return asyncio.run(_amain(args))


if __name__ == "__main__":
    raise SystemExit(main())
