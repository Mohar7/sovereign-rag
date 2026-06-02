"""Confirm langchain_core custom events surface in astream_events v2.

This pins the mechanism crawl_index uses to emit per-URL crawl_progress.
If this ever breaks on a dependency bump, the streaming progress UI loses
its per-URL events — so we assert it explicitly.
"""

from __future__ import annotations

from typing import Any

from langchain_core.callbacks.manager import adispatch_custom_event
from langgraph.graph import END, START, StateGraph
from typing_extensions import TypedDict


class _S(TypedDict, total=False):
    x: int


async def test_custom_event_surfaces_in_astream_events_v2() -> None:
    async def emit(state: _S) -> dict[str, Any]:
        await adispatch_custom_event("crawl_progress", {"url": "https://a", "status": "indexed"})
        return {"x": 1}

    g = StateGraph(_S)
    g.add_node("emit", emit)
    g.add_edge(START, "emit")
    g.add_edge("emit", END)
    compiled = g.compile()

    seen: list[dict[str, Any]] = []
    async for ev in compiled.astream_events({"x": 0}, version="v2"):
        if ev.get("event") == "on_custom_event" and ev.get("name") == "crawl_progress":
            seen.append(ev.get("data") or {})

    assert seen == [{"url": "https://a", "status": "indexed"}]
