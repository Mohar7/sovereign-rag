"""SSE generator surfaces the agent's tool steps + completes for the agent graph."""

from __future__ import annotations

import json
from typing import Any

from langchain_core.messages import AIMessage
from langgraph.checkpoint.memory import InMemorySaver

from sovereign_rag.api.ask import router as ask_router
from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa import agent as agent_mod


class _FakeChat:
    def __init__(self, scripted: list[AIMessage]) -> None:
        self._s, self.calls = scripted, 0

    def bind_tools(self, tools: Any) -> _FakeChat:
        return self

    async def ainvoke(self, messages: Any) -> AIMessage:
        m = self._s[min(self.calls, len(self._s) - 1)]
        self.calls += 1
        return m


async def _collect(gen) -> list[dict[str, Any]]:  # type: ignore[no-untyped-def]
    out = []
    async for raw in gen:
        line = raw.decode().strip()
        if line.startswith("data: "):
            out.append(json.loads(line[6:]))
    return out


async def test_stream_agent_emits_agent_step_and_done(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "enable_react_agent", True)

    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        return '{"results": [], "top_score": null}', {"retrieved_pool": {}, "retrieved": 0}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    fake = _FakeChat(
        [
            AIMessage(
                content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}]
            ),
            AIMessage(content="Final answer."),
        ]
    )
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: fake)

    from sovereign_rag.graphs.rag_qa.graph import build_graph

    graph = build_graph(InMemorySaver())
    cfg: dict[str, Any] = {"configurable": {"thread_id": "s1"}}
    events = await _collect(ask_router._stream_generator(graph, {"question": "q"}, cfg, "s1", None))
    types = [e["type"] for e in events]
    assert "open" in types and "done" in types
    steps = [e for e in events if e["type"] == "agent_step"]
    assert steps and steps[0]["tool"] == "SearchCorpus"
    done = next(e for e in events if e["type"] == "done")
    assert done["answer"] == "Final answer."
