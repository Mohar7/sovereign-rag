"""``POST /ask`` and ``POST /ask/stream`` — run the QA graph.

``/ask`` returns the full cited answer as JSON after the graph completes.
``/ask/stream`` returns SSE so the UI can render tokens + per-node progress
as they arrive.

Both routes accept an optional ``overrides`` block that lets the caller
temporarily change the LLM model and retrieval knobs for a single request.
See :class:`AskOverrides` for the semantics + concurrency caveat.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from collections.abc import AsyncIterator, Iterator
from contextlib import contextmanager
from dataclasses import asdict
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from langgraph.types import Command

from sovereign_rag.api.ask.schemas import (
    AskOverrides,
    AskRequest,
    AskResponse,
    CandidateUrl,
    CitationModel,
    GradeModel,
    InterruptModel,
    ResumeRequest,
)
from sovereign_rag.api.dependencies import GraphDep
from sovereign_rag.api.runs import record_run
from sovereign_rag.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["ask"])

# All CRAG pipeline nodes whose on_chain_start/on_chain_end events are
# tracked for per-node timings and surfaced to the client.
_CRAG_NODES = {
    "retrieve_local",
    "rerank",
    "grade",
    "transform_query",
    "web_search",
    "crawl_index",
    "generate",
}


# ─────────────────────────────────────────────────────────────────
# Overrides
# ─────────────────────────────────────────────────────────────────


def _bust_llm_cache() -> None:
    """Clear the llm_factory per-(provider, tier) cache so the next call rebuilds."""
    try:
        from sovereign_rag.shared import llm_factory

        llm_factory._cached.cache_clear()
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("could not clear llm_factory cache: %s", exc)


@contextmanager
def _apply_overrides(overrides: AskOverrides | None) -> Iterator[None]:
    """Temporarily patch Settings for the duration of a request.

    Saves the prior value of every overridden field, applies the new value,
    busts the LLM-factory cache if any LLM-bearing field changed, then
    restores everything in ``finally``.
    """
    if overrides is None:
        yield
        return

    s = get_settings()
    saved: dict[str, Any] = {}
    llm_dirty = False

    if overrides.model is not None:
        # Patch both the shared llm_model and the provider-specific override so
        # the factory picks up the new value regardless of llm_provider.
        saved["llm_model"] = s.llm_model
        saved["openai_chat_model"] = s.openai_chat_model
        s.llm_model = overrides.model
        s.openai_chat_model = overrides.model if s.llm_provider == "openai" else ""
        llm_dirty = True

    if overrides.retrieve_top_k is not None:
        saved["retrieve_top_k"] = s.retrieve_top_k
        s.retrieve_top_k = overrides.retrieve_top_k

    if overrides.rerank_top_k is not None:
        saved["rerank_top_k"] = s.rerank_top_k
        s.rerank_top_k = overrides.rerank_top_k

    if overrides.enable_graph_retrieval is not None:
        saved["enable_graph_retrieval"] = s.enable_graph_retrieval
        s.enable_graph_retrieval = overrides.enable_graph_retrieval

    if llm_dirty:
        _bust_llm_cache()

    try:
        yield
    finally:
        for key, value in saved.items():
            setattr(s, key, value)
        if llm_dirty:
            _bust_llm_cache()


def _build_response(thread_id: str, state: dict[str, Any]) -> AskResponse:
    """Convert a compiled-graph result dict into the API response."""
    citations = state.get("citations") or []
    grade = None
    if state.get("grade"):
        grade = GradeModel(
            label=state["grade"],
            confidence=float(state.get("grade_confidence") or 0.0),
            reason=str(state.get("grade_reason") or ""),
        )
    return AskResponse(
        thread_id=thread_id,
        status="ok",
        answer=state.get("answer"),
        citations=[CitationModel(**asdict(c)) for c in citations],
        retrieved=int(state.get("retrieved", 0)),
        used=int(state.get("used", 0)),
        fallback_used=bool(state.get("fallback_used", False)),
        grade=grade,
    )


def _extract_interrupt(
    state: dict[str, Any],
) -> tuple[InterruptModel, GradeModel | None] | None:
    """If the graph paused, build the InterruptModel (+ grade) from the state.

    ``ainvoke`` surfaces a pending interrupt under ``state["__interrupt__"]`` —
    a tuple of Interrupt objects whose ``.value`` is the payload our
    ``request_approval`` node passed to ``interrupt(...)``. Returns None when
    the state carries no interrupt.
    """
    interrupts = state.get("__interrupt__")
    if not interrupts:
        return None
    payload = getattr(interrupts[0], "value", None)
    if not isinstance(payload, dict):
        return None
    candidates = [
        CandidateUrl(
            url=str(c.get("url", "")),
            title=str(c.get("title", "")),
            snippet=str(c.get("snippet", "")),
            verified=c.get("verified"),
        )
        for c in (payload.get("candidate_urls") or [])
        if isinstance(c, dict) and c.get("url")
    ]
    interrupt = InterruptModel(reason="approve_urls", candidate_urls=candidates)
    grade_raw = payload.get("grade") or {}
    grade = None
    if isinstance(grade_raw, dict) and grade_raw.get("label"):
        grade = GradeModel(
            label=grade_raw["label"],
            confidence=float(grade_raw.get("confidence") or 0.0),
            reason=str(grade_raw.get("reason") or ""),
        )
    return interrupt, grade


def _pending_interrupt(
    snapshot: Any,
) -> tuple[InterruptModel, GradeModel | None] | None:
    """Build the interrupt from a state snapshot's pending tasks, if any.

    On a pause, ``aget_state`` returns a snapshot whose ``.tasks[*].interrupts``
    carry the Interrupt objects (and ``.next`` names the paused node)."""
    if snapshot is None or not getattr(snapshot, "next", None):
        return None
    for task in getattr(snapshot, "tasks", ()) or ():
        for intr in getattr(task, "interrupts", ()) or ():
            payload = getattr(intr, "value", None)
            if isinstance(payload, dict):
                return _extract_interrupt({"__interrupt__": (intr,)})
    return None


@router.post("/ask", response_model=AskResponse)
async def ask(req: AskRequest, graph: GraphDep) -> AskResponse:
    """Run the QA graph and return the cited answer."""
    thread_id = req.thread_id or str(uuid.uuid4())
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    initial = {"question": req.question, "doc_id": req.doc_id}

    started = time.perf_counter()
    settings_at_call = get_settings()
    try:
        with _apply_overrides(req.overrides):
            state = await graph.ainvoke(initial, config=config)
    except Exception as exc:
        logger.exception("graph invocation failed")
        # Persist the failed run so the history page surfaces errors too.
        await record_run(
            thread_id=thread_id,
            question=req.question,
            answer=None,
            retrieved=0,
            used=0,
            citations=[],
            timings={"total": round((time.perf_counter() - started) * 1000)},
            overrides=req.overrides.model_dump(exclude_none=True) if req.overrides else None,
            model=(
                req.overrides.model
                if (req.overrides and req.overrides.model)
                else settings_at_call.llm_model
            ),
            status="error",
            error=f"{type(exc).__name__}: {exc}",
        )
        raise HTTPException(500, f"Graph failed: {exc}") from exc

    paused = _extract_interrupt(state)
    if paused is not None:
        interrupt_model, grade = paused
        # A pause is not a completed run — do not record_run here.
        return AskResponse(
            thread_id=thread_id,
            status="interrupted",
            answer=None,
            interrupt=interrupt_model,
            grade=grade,
        )

    response = _build_response(thread_id, state)
    # Best-effort persistence; errors are swallowed inside record_run.
    await record_run(
        thread_id=response.thread_id,
        question=req.question,
        answer=response.answer,
        retrieved=response.retrieved,
        used=response.used,
        citations=[c.model_dump() for c in response.citations],
        timings={"total": round((time.perf_counter() - started) * 1000)},
        overrides=req.overrides.model_dump(exclude_none=True) if req.overrides else None,
        model=(
            req.overrides.model
            if (req.overrides and req.overrides.model)
            else settings_at_call.llm_model
        ),
        status="ok",
        grade=state.get("grade"),
        grade_confidence=state.get("grade_confidence"),
        fallback_used=bool(state.get("fallback_used", False)),
        decision=None,
        correction_attempts=int(state.get("correction_attempts", 0)),
    )
    return response


# ─────────────────────────────────────────────────────────────────
# SSE streaming
# ─────────────────────────────────────────────────────────────────


def _sse(payload: dict[str, Any]) -> bytes:
    """Format one Server-Sent Event line per the SSE wire spec."""
    return f"data: {json.dumps(payload, default=str)}\n\n".encode()


async def _stream_generator(
    graph: Any,
    initial: Any,
    config: dict[str, Any],
    thread_id: str,
    overrides: AskOverrides | None,
    decision: str | None = None,
) -> AsyncIterator[bytes]:
    """Drive the graph and emit one SSE event per interesting occurrence.

    Event types (all carry ``"type"``):
    - ``open`` — first event, includes ``thread_id``
    - ``node`` — graph node started or finished (for all _CRAG_NODES)
    - ``token`` — LLM stream chunk; ``delta`` is the text piece
    - ``citations`` — emitted when the ``generate`` node returns citations
    - ``grade`` — emitted when the ``grade`` node finishes
    - ``crawl_progress`` — per-URL crawl status from crawl_index
    - ``interrupt`` — graph paused for human approval (no ``done`` follows)
    - ``done`` — final state summary (``answer``, ``citations``, ``retrieved``, ``used``)
    - ``error`` — fatal error; the stream then closes
    """
    yield _sse({"type": "open", "thread_id": thread_id})

    final_state: dict[str, Any] = {}
    # Wall-clock start times per node, populated on the start phase and read
    # back on done. perf_counter is monotonic and microsecond-resolution.
    node_started_at: dict[str, float] = {}
    # Stage durations in milliseconds, surfaced both in per-node `done` events
    # and in the final `done` event so the client can render the pipeline
    # strip without recomputing.
    stage_timings: dict[str, int] = {}
    started_at = time.perf_counter()
    grade_emitted = False  # Fix 5: track whether grade event was already sent
    try:
        with _apply_overrides(overrides):
            async for event in graph.astream_events(initial, config=config, version="v2"):
                kind = event.get("event")
                name = event.get("name", "")

                if kind == "on_chat_model_stream":
                    chunk = event.get("data", {}).get("chunk")
                    delta = getattr(chunk, "content", None) if chunk is not None else None
                    if isinstance(delta, str) and delta:
                        yield _sse({"type": "token", "delta": delta})

                elif kind == "on_chain_start" and name in _CRAG_NODES:
                    node_started_at[name] = time.perf_counter()
                    yield _sse({"type": "node", "name": name, "phase": "start"})

                elif kind == "on_chain_end" and name in _CRAG_NODES:
                    output = event.get("data", {}).get("output") or {}
                    if not isinstance(output, dict):
                        output = {}
                    started = node_started_at.get(name)
                    elapsed_ms = round((time.perf_counter() - started) * 1000) if started else 0
                    stage_timings[name] = elapsed_ms
                    if name == "generate" and "citations" in output:
                        cites = [
                            asdict(c) if hasattr(c, "__dataclass_fields__") else c
                            for c in (output.get("citations") or [])
                        ]
                        yield _sse({"type": "citations", "items": cites})
                    if name == "grade":
                        yield _sse(
                            {
                                "type": "grade",
                                "label": output.get("grade"),
                                "confidence": output.get("grade_confidence"),
                                "reason": output.get("grade_reason"),
                            }
                        )
                        grade_emitted = True  # Fix 5: mark grade as sent
                    yield _sse(
                        {
                            "type": "node",
                            "name": name,
                            "phase": "done",
                            "elapsed_ms": elapsed_ms,
                        },
                    )

                elif kind == "on_custom_event" and name == "agent_step":
                    data = event.get("data") or {}
                    if isinstance(data, dict):
                        yield _sse({**data, "type": "agent_step"})

                elif kind == "on_custom_event" and name == "crawl_progress":
                    data = event.get("data") or {}
                    if isinstance(data, dict):
                        # Fix 6: put data first so a stray "type" key cannot override event type
                        yield _sse({**data, "type": "crawl_progress"})

                elif kind == "on_chain_end" and name == "LangGraph":
                    # Top-level graph finished; capture the final state.
                    output = event.get("data", {}).get("output")
                    if isinstance(output, dict):
                        final_state = output
    except Exception as exc:
        logger.exception("stream failed")
        # Record the failed run so it shows up in /api/runs.
        await record_run(
            thread_id=thread_id,
            question=str(initial.get("question") or "") if isinstance(initial, dict) else "",
            answer=None,
            retrieved=0,
            used=0,
            citations=[],
            timings={**stage_timings, "total": round((time.perf_counter() - started_at) * 1000)},
            overrides=overrides.model_dump(exclude_none=True) if overrides else None,
            model=(overrides.model if overrides and overrides.model else get_settings().llm_model),
            status="error",
            error=f"{type(exc).__name__}: {exc}",
        )
        yield _sse({"type": "error", "message": f"{type(exc).__name__}: {exc}"})
        return

    # Compute snapshot once — used for both interrupt detection and final_state fallback.
    try:
        snapshot = await graph.aget_state(config)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("aget_state failed: %s", exc)
        snapshot = None

    # The graph may have paused at request_approval — the top-level on_chain_end
    # does not fire on an interrupt, so check the snapshot.
    pending = _pending_interrupt(snapshot)
    if pending is not None:
        interrupt_model, grade = pending
        # Fix 5: only emit the snapshot grade if the on_chain_end grade event was
        # NOT already sent (avoids a duplicate grade event on the initial /ask/stream
        # interrupt path where grade fires as an on_chain_end AND again here).
        if grade is not None and not grade_emitted:
            yield _sse(
                {
                    "type": "grade",
                    "label": grade.label,
                    "confidence": grade.confidence,
                    "reason": grade.reason,
                }
            )
        yield _sse(
            {
                "type": "interrupt",
                "thread_id": thread_id,
                "reason": interrupt_model.reason,
                "candidate_urls": [c.model_dump() for c in interrupt_model.candidate_urls],
            }
        )
        return  # a pause is not a completed run — no record_run, no done

    # Fallback: if astream_events didn't surface the top-level output, use snapshot.
    if not final_state:
        final_state = (
            snapshot.values if snapshot is not None and hasattr(snapshot, "values") else {}
        ) or {}

    citations = [
        asdict(c) if hasattr(c, "__dataclass_fields__") else c
        for c in (final_state.get("citations") or [])
    ]
    total_elapsed_ms = round((time.perf_counter() - started_at) * 1000)
    timings_payload = {**stage_timings, "total": total_elapsed_ms}
    # Persist before yielding done so the run is in the audit log by the
    # time the client navigates to /history.
    # Fix 1: read question from final_state first (correct on resume where initial
    # is a Command, not a dict).  Fix 2: pass decision through from the parameter.
    await record_run(
        thread_id=thread_id,
        question=str(
            final_state.get("question")
            or (initial.get("question") if isinstance(initial, dict) else "")
            or ""
        ),
        answer=final_state.get("answer"),
        retrieved=int(final_state.get("retrieved", 0)),
        used=int(final_state.get("used", 0)),
        citations=citations,
        timings=timings_payload,
        overrides=overrides.model_dump(exclude_none=True) if overrides else None,
        model=(overrides.model if overrides and overrides.model else get_settings().llm_model),
        status="ok",
        grade=final_state.get("grade"),
        grade_confidence=final_state.get("grade_confidence"),
        fallback_used=bool(final_state.get("fallback_used", False)),
        decision=decision,
        correction_attempts=int(final_state.get("correction_attempts", 0)),
    )
    yield _sse(
        {
            "type": "done",
            "thread_id": thread_id,
            "answer": final_state.get("answer"),
            "citations": citations,
            "retrieved": int(final_state.get("retrieved", 0)),
            "used": int(final_state.get("used", 0)),
            "timings": timings_payload,
            "fallback_used": bool(final_state.get("fallback_used", False)),
            "grade": final_state.get("grade"),
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
        _stream_generator(graph, initial, config, thread_id, req.overrides),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # bypass nginx buffering when proxied
        },
    )


@router.post("/ask/resume", response_model=AskResponse)
async def ask_resume(req: ResumeRequest, graph: GraphDep) -> AskResponse:
    """Resume a thread paused at the HITL approval interrupt.

    ``approved_urls`` non-empty → approve those (crawl + re-retrieve);
    ``[]`` → decline (answer from the local corpus). With the default
    ``crag_max_corrections=1`` the resumed run completes without pausing again.
    """
    thread_id = req.thread_id
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    started = time.perf_counter()
    try:
        state = await graph.ainvoke(
            Command(resume={"approved_urls": req.approved_urls}), config=config
        )
    except Exception as exc:
        logger.exception("resume failed")
        # Fix 4: record the failed run for history-page parity with /ask error handling.
        await record_run(
            thread_id=thread_id,
            question="",
            answer=None,
            retrieved=0,
            used=0,
            citations=[],
            timings={"total": round((time.perf_counter() - started) * 1000)},
            overrides=None,
            model=get_settings().llm_model,
            status="error",
            error=f"{type(exc).__name__}: {exc}",
            decision="approved" if req.approved_urls else "declined",
        )
        raise HTTPException(500, f"Resume failed: {exc}") from exc

    # A second interrupt is possible only if crag_max_corrections > 1.
    paused = _extract_interrupt(state)
    if paused is not None:
        interrupt_model, grade = paused
        return AskResponse(
            thread_id=thread_id, status="interrupted", interrupt=interrupt_model, grade=grade
        )

    response = _build_response(thread_id, state)
    await record_run(
        thread_id=thread_id,
        question=str(state.get("question") or ""),
        answer=response.answer,
        retrieved=response.retrieved,
        used=response.used,
        citations=[c.model_dump() for c in response.citations],
        timings={"total": round((time.perf_counter() - started) * 1000)},
        overrides=None,
        model=get_settings().llm_model,
        status="ok",
        grade=state.get("grade"),
        grade_confidence=state.get("grade_confidence"),
        fallback_used=bool(state.get("fallback_used", False)),
        decision="approved" if req.approved_urls else "declined",
        correction_attempts=int(state.get("correction_attempts", 0)),
    )
    return response


@router.post("/ask/resume/stream")
async def ask_resume_stream(req: ResumeRequest, graph: GraphDep) -> StreamingResponse:
    """SSE variant of /ask/resume — streams the post-approval tokens + events."""
    thread_id = req.thread_id
    config: dict[str, Any] = {"configurable": {"thread_id": thread_id}}
    resume_input: Any = Command(resume={"approved_urls": req.approved_urls})
    return StreamingResponse(
        _stream_generator(
            graph,
            resume_input,
            config,
            thread_id,
            None,
            "approved" if req.approved_urls else "declined",  # Fix 2: pass decision
        ),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


__all__ = ["_build_response", "router"]
