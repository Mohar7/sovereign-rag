"""Chunking + Anthropic-style Contextual Retrieval.

Two steps:
1. `chunk_document` — recursive character splitting (~400 tokens, 15%
   overlap, the current best-practice default).
2. `contextualize` — for each chunk, ask the local LLM for a 1-2 sentence
   prefix situating the chunk within the whole document, then prepend it.
   This is Anthropic's Contextual Retrieval (Sept 2024): it measurably
   reduces retrieval failures because a chunk like "revenue grew 3%" gains
   "This is from ACME's Q2 2024 report..." before being embedded/BM25'd.

`Chunk.text` carries the contextualized text (what we index); `raw_text`
stays clean (what we cite back to the user).
"""

from __future__ import annotations

import asyncio
import logging

from langchain_text_splitters import RecursiveCharacterTextSplitter

from sovereign_rag.documents import Chunk, SourceDocument
from sovereign_rag.providers.ollama import get_llm

logger = logging.getLogger(__name__)

# ~400 tokens ≈ 1600 chars; 15% overlap. Tunable per corpus.
_DEFAULT_CHUNK_CHARS = 1600
_DEFAULT_OVERLAP_CHARS = 240

_CONTEXT_PROMPT = """\
<document>
{document}
</document>

Here is a chunk we want to situate within the whole document:
<chunk>
{chunk}
</chunk>

Give a short (1-2 sentence) context to situate this chunk within the
overall document, to improve search retrieval of the chunk. Answer ONLY
with the succinct context and nothing else.\
"""


def chunk_document(
    doc: SourceDocument,
    chunk_chars: int = _DEFAULT_CHUNK_CHARS,
    overlap_chars: int = _DEFAULT_OVERLAP_CHARS,
) -> list[Chunk]:
    """Split a SourceDocument into Chunks (no contextual prefix yet)."""
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=chunk_chars,
        chunk_overlap=overlap_chars,
        separators=["\n\n", "\n", ". ", " ", ""],
    )
    pieces = splitter.split_text(doc.markdown)
    return [
        Chunk(
            doc_id=doc.doc_id,
            text=piece,
            raw_text=piece,
            position=i,
            page=doc.metadata.get("page"),
            metadata={"title": doc.title, "source_uri": doc.source_uri},
        )
        for i, piece in enumerate(pieces)
    ]


async def contextualize(doc: SourceDocument, chunks: list[Chunk]) -> list[Chunk]:
    """Prepend an LLM-generated context prefix to each chunk's `text`.

    Runs the prefix generations concurrently (bounded) against Ollama. On
    any failure we fall back to the un-prefixed chunk so ingestion never
    hard-fails on a flaky model call.
    """
    llm = get_llm()
    # Truncate the document we feed as context to keep prompts within num_ctx.
    doc_context = doc.markdown[:6000]
    semaphore = asyncio.Semaphore(4)

    async def _one(chunk: Chunk) -> Chunk:
        async with semaphore:
            prompt = _CONTEXT_PROMPT.format(document=doc_context, chunk=chunk.raw_text)
            try:
                resp = await llm.ainvoke(prompt)
                prefix = (
                    resp.content if isinstance(resp.content, str) else str(resp.content)
                ).strip()
            except Exception:
                logger.warning("contextualize failed for chunk %s", chunk.chunk_id, exc_info=True)
                return chunk
            if prefix:
                chunk.text = f"{prefix}\n\n{chunk.raw_text}"
            return chunk

    return await asyncio.gather(*[_one(c) for c in chunks])


__all__ = ["chunk_document", "contextualize"]
