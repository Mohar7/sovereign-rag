"""A paused CRAG run round-trips RetrievedChunk/Citation through a checkpoint
without the 'unregistered type' serializer warning.

Design note — why not ``warnings.simplefilter("error")``
---------------------------------------------------------
The LangGraph serializer emits its unregistered-type notice via
``logger.warning(...)`` (the Python ``logging`` module), **not** via
Python's ``warnings.warn(...)``.  That means ``warnings.catch_warnings()``
/ ``warnings.simplefilter("error")`` cannot intercept it.

We therefore assert the absence of the warning by capturing the
``langgraph.checkpoint.serde.jsonplus`` logger during the round-trip and
asserting zero "unregistered type" messages were emitted.

The fix (``shared/checkpoint_serde.py``) creates a ``JsonPlusSerializer``
with ``Chunk``, ``RetrievedChunk``, and ``Citation`` supplied as an explicit
``allowed_msgpack_modules`` list (not via ``with_msgpack_allowlist()``, which
is a no-op when the base allowlist is ``True``).
``build_graph(checkpointer)`` applies this serde to the checkpointer so
every compile path — both the FastAPI lifespan (``AsyncPostgresSaver``) and
the stubbed-graph test helper (``InMemorySaver``) — gets the allowlist.
"""

from __future__ import annotations

import logging

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from sovereign_rag.shared.checkpoint_serde import make_serde


class _LogCapture(logging.Handler):
    """Capture log records emitted during the round-trip."""

    def __init__(self) -> None:
        super().__init__()
        self.messages: list[str] = []

    def emit(self, record: logging.LogRecord) -> None:
        self.messages.append(self.format(record))


async def test_paused_state_serializes_without_unregistered_warning(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A paused CRAG run round-trips through InMemorySaver without any
    'Deserializing unregistered type' log warning.

    The test uses the same monkeypatched collaborators as the graph-level
    CRAG suite (via ``_build_stubbed_graph``) to ensure the full RAGState
    (including ``candidates: list[RetrievedChunk]``) is written to and read
    back from the checkpoint.
    """
    from langgraph.checkpoint.serde import jsonplus as _j

    from tests.test_rag_qa_graph import _build_stubbed_graph

    # Clear the dedup set so per-type warnings are not silently suppressed
    # if an earlier test already triggered and cached them.

    _j._warned_unregistered_types.clear()

    # Capture log output on the serde logger.
    serde_logger = logging.getLogger("langgraph.checkpoint.serde.jsonplus")
    capture = _LogCapture()
    serde_logger.addHandler(capture)
    original_propagate = serde_logger.propagate
    serde_logger.propagate = False
    try:
        serde = make_serde()
        checkpointer = InMemorySaver(serde=serde)
        graph = _build_stubbed_graph(monkeypatch, checkpointer)
        cfg = {"configurable": {"thread_id": "serde-test-1"}}

        first = await graph.ainvoke({"question": "q"}, cfg)
        assert "__interrupt__" in first, "expected graph to pause at request_approval"

        # Reading state back forces deserialization of the checkpointed RAGState
        # (including the RetrievedChunk list that was in scope when the pause fired).
        snap = await graph.aget_state(cfg)
        assert snap is not None
        assert snap.next  # still paused

        # Verify the deserialized candidates round-tripped correctly.
        from sovereign_rag.documents import RetrievedChunk

        candidates = snap.values.get("candidates") or snap.values.get("reranked") or []
        if candidates:
            assert isinstance(candidates[0], RetrievedChunk)
    finally:
        serde_logger.removeHandler(capture)
        serde_logger.propagate = original_propagate

    unregistered = [m for m in capture.messages if "Deserializing unregistered type" in m]
    assert unregistered == [], (
        "Checkpoint serde emitted 'unregistered type' warnings — "
        "add the type(s) to the allowlist in shared/checkpoint_serde.py:\n"
        + "\n".join(unregistered)
    )
