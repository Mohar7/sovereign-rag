"""Checkpoint serializer with allowlist for retrieval dataclasses.

LangGraph's default ``JsonPlusSerializer`` uses ormsgpack and will serialize
any dataclass via ``EXT_CONSTRUCTOR_KW_ARGS`` (module, name, kwargs dict),
but on deserialization it emits a ``logger.warning`` for every type not in its
``allowed_msgpack_modules`` allowlist when running in the default permissive
mode (``allowed_msgpack_modules=True``):

    Deserializing unregistered type sovereign_rag.documents.Chunk …
    This will be blocked in a future version.

When CRAG is enabled, ``RAGState`` carries ``candidates: list[RetrievedChunk]``
and ``reranked: list[RetrievedChunk]`` (each containing a ``Chunk``) across
the human-pause checkpoint, plus ``citations: list[Citation]`` in the final
state.  All three types trigger the warning on every ``aget_state`` /
``ainvoke`` resume.

This module provides a pre-built serializer (and factory ``make_serde()``)
that silences the warning by registering these types explicitly.

Implementation note — why NOT ``with_msgpack_allowlist``
---------------------------------------------------------
``JsonPlusSerializer.with_msgpack_allowlist()`` returns ``self`` unchanged
when the base allowlist is ``True`` (the default permissive mode).  We
therefore construct the serializer directly with
``allowed_msgpack_modules=_RETRIEVAL_TYPES``.  In this mode the ext_hook
checks our explicit set first, falls back to ``SAFE_MSGPACK_TYPES`` (the
LangGraph/LangChain built-ins that bypass the gate), and silently returns
the raw dict for any other unregistered type — which is safe because the
only non-primitive, non-safe types that appear in RAGState are the three
below.

Usage
-----
Pass ``serde=make_serde()`` to ``InMemorySaver`` / ``AsyncPostgresSaver``:

    checkpointer = AsyncPostgresSaver(pool, serde=make_serde())
    checkpointer = InMemorySaver(serde=make_serde())

``build_graph`` in ``graphs/rag_qa/graph.py`` calls this automatically when
a checkpointer is supplied via the FastAPI lifespan, and the
``_build_stubbed_graph`` test helper in ``tests/test_rag_qa_graph.py``
accepts a ``checkpointer`` argument so callers can pass a serde-aware saver.
"""

from __future__ import annotations

from langgraph.checkpoint.serde.jsonplus import JsonPlusSerializer

from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.retrieval.pipeline import Citation

# The three dataclasses that appear in RAGState and survive the HITL pause.
# Expressed as (module, qualname) tuples — the exact form ormsgpack stores.
_RETRIEVAL_TYPES: list[tuple[str, str]] = [
    (Chunk.__module__, Chunk.__name__),
    (RetrievedChunk.__module__, RetrievedChunk.__name__),
    (Citation.__module__, Citation.__name__),
]


def make_serde() -> JsonPlusSerializer:
    """Return a ``JsonPlusSerializer`` with retrieval types pre-registered.

    Constructs the serializer with an explicit ``allowed_msgpack_modules``
    list rather than using ``with_msgpack_allowlist`` (which is a no-op when
    the base allowlist is ``True``).  LangGraph's built-in safe types
    (``SAFE_MSGPACK_TYPES``) are always allowed regardless of this list.
    """
    return JsonPlusSerializer(allowed_msgpack_modules=_RETRIEVAL_TYPES)


# Module-level singleton — safe to share across threads (the serializer is
# stateless after construction).
SERDE = make_serde()

__all__ = ["SERDE", "make_serde"]
