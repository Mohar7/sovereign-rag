"""``POST /ask`` and ``POST /ask/stream`` — run the QA graph.

``/ask`` returns the full cited answer as JSON after the graph completes.
``/ask/stream`` returns SSE so the UI can render tokens + per-node progress
as they arrive.
"""

from __future__ import annotations

import json
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

from sovereign_rag.api.ask.schemas import AskRequest, AskResponse, CitationModel
from sovereign_rag.api.dependencies import GraphDep

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])


def _build_response(thread_id: str, state: dict[str, Any]) -> AskResponse:
    """Convert a compiled-graph result dict into the API response."""
    citations = state.get("citations") or []
    return AskResponse(
        thread_id=thread_id,
        status="ok",
        answer=state.get("answer"),
        citations=[CitationModel(**asdict(c)) for c in citations],
        retrieved=int(state.get("retrieved", 0)),
        used=int(state.get("used", 0)),
    )


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, graph: GraphDep) -> AskResponse:
    """Run the QA graph and return the cited answer."""
    thread_id = req.thread_id or str(uuid.uuid4())
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    initial = {"question": req.question, "doc_id": req.doc_id}

    try:
        state = await graph.ainvoke(initial, config=config)
    except Exception as exc:
        logger.exception("graph invocation failed")
        raise HTTPException(500, f"Graph failed: {exc}") from exc

    return _build_response(thread_id, state)


# ─────────────────────────────────────────────────────────────────
# SSE streaming
# ─────────────────────────────────────────────────────────────────


def _sse(payload: dict[str, Any]) -> bytes:
    """Format one Server-Sent Event line per the SSE wire spec."""
    return f"data: {json.dumps(payload, default=str)}\n\n".encode()


async def _stream_generator(
    graph: Any, initial: dict[str, Any], config: dict[str, Any], thread_id: str
) -> AsyncIterator[bytes]:
    """Drive the graph and emit one SSE event per interesting occurrence.

    Event types (all carry ``"type"``):
    - ``open`` — first event, includes ``thread_id``
    - ``node`` — graph node started or finished
    - ``token`` — LLM stream chunk; ``delta`` is the text piece
    - ``citations`` — emitted when the ``generate`` node returns citations
    - ``done`` — final state summary (``answer``, ``citations``, ``retrieved``, ``used``)
    - ``error`` — fatal error; the stream then closes
    """
    yield _sse({"type": "open", "thread_id": thread_id})

    final_state: dict[str, Any] = {}
    try:
        async for event in graph.astream_events(initial, config=config, version="v2"):
            kind = event.get("event")
            name = event.get("name", "")

            if kind == "on_chat_model_stream":
                chunk = event.get("data", {}).get("chunk")
                delta = getattr(chunk, "content", None) if chunk is not None else None
                if isinstance(delta, str) and delta:
                    yield _sse({"type": "token", "delta": delta})

            elif kind == "on_chain_start" and name in {
                "retrieve_local",
                "rerank",
                "generate",
            }:
                yield _sse({"type": "node", "name": name, "phase": "start"})

            elif kind == "on_chain_end" and name in {
                "retrieve_local",
                "rerank",
                "generate",
            }:
                output = event.get("data", {}).get("output") or {}
                if not isinstance(output, dict):
                    output = {}
                if name == "generate" and "citations" in output:
                    cites = [
                        asdict(c) if hasattr(c, "__dataclass_fields__") else c
                        for c in (output.get("citations") or [])
                    ]
                    yield _sse({"type": "citations", "items": cites})
                yield _sse({"type": "node", "name": name, "phase": "done"})

            elif kind == "on_chain_end" and name == "LangGraph":
                # Top-level graph finished; capture the final state.
                output = event.get("data", {}).get("output")
                if isinstance(output, dict):
                    final_state = output
    except Exception as exc:
        logger.exception("stream failed")
        yield _sse({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        return

    # Fallback: if astream_events didn't surface the top-level output, fetch
    # the final state ourselves (every node already ran).
    if not final_state:
        try:
            snapshot = await graph.aget_state(config)
            final_state = (
                snapshot.values if snapshot is not None and hasattr(snapshot, "values") else {}
            ) or {}
        except Exception as exc:
            logger.warning("aget_state failed: %s", exc)
            final_state = {}

    citations = [
        asdict(c) if hasattr(c, "__dataclass_fields__") else c
        for c in (final_state.get("citations") or [])
    ]
    yield _sse(
        {
            "type": "done",
            "thread_id": thread_id,
            "answer": final_state.get("answer"),
            "citations": citations,
            "retrieved": int(final_state.get("retrieved", 0)),
            "used": int(final_state.get("used", 0)),
        }
    )


@router.post("/ask/stream")
async def ask_stream(req: AskRequest, graph: GraphDep) -> StreamingResponse:
    """SSE variant of /ask — streams node progress + LLM tokens.

    The wire format is text/event-stream. Each event is one JSON object
    payload (see ``_stream_generator`` for the event schema). The stream
    closes after the ``done`` (or ``error``) event.
    """
    thread_id = req.thread_id or str(uuid.uuid4())
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    initial = {"question": req.question, "doc_id": req.doc_id}

    return StreamingResponse(
        _stream_generator(graph, initial, config, thread_id),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # bypass nginx buffering when proxied
        },
    )


__all__ = ["_build_response", "router"]
