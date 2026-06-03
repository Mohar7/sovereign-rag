# ReAct Agentic RAG — Plan 3: API / SSE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Steps use `- [ ]`.

**Goal:** Surface the agent's tool steps over SSE so the UI can show what the controller is doing, and confirm the agent graph streams + interrupts/resumes correctly through the existing `/ask/stream` + `/ask/resume`.

**Architecture:** The agent graph already runs through the existing API (same output keys: `answer`/`citations`/`retrieved`/`used`/`fallback_used`; same `interrupt()` payload as CRAG, so `_extract_interrupt` + `/ask/resume` work). This plan adds one new SSE event type — `agent_step` — emitted from `tools_node` via a custom event and mapped in `_stream_generator`. Token streaming (from `finalize`'s generate) and `crawl_progress` already work unchanged.

**Tech Stack:** `adispatch_custom_event`, `astream_events(v2)`, FastAPI SSE, pytest.

**Spec:** §3, §7. **Prereq:** Plans 1–2 merged.

---

## Task 1: Emit `agent_step` custom events from `tools_node`

**Files:** Modify `src/sovereign_rag/graphs/rag_qa/agent.py`; Test `tests/test_agent_loop.py`.

- [ ] **Step 1: Failing test** — append to `tests/test_agent_loop.py`:

```python
async def test_tools_node_emits_agent_step_events(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from langchain_core.callbacks.manager import adispatch_custom_event  # noqa: F401
    from langgraph.graph import END, START, StateGraph
    from sovereign_rag.graphs.rag_qa.agent_state import AgentState

    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        return "obs", {"retrieved_pool": {}, "retrieved": 0}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)

    # Drive tools_node inside a tiny graph so custom events surface in astream_events.
    g: StateGraph = StateGraph(AgentState)
    g.add_node("tools", agent_mod.tools_node)
    g.add_edge(START, "tools")
    g.add_edge("tools", END)
    compiled = g.compile()

    tool_msg = AIMessage(
        content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "credits"}, "id": "1"}]
    )
    seen: list[dict[str, Any]] = []
    async for ev in compiled.astream_events(
        {"scratch": [tool_msg], "retrieved_pool": {}}, version="v2"
    ):
        if ev.get("event") == "on_custom_event" and ev.get("name") == "agent_step":
            seen.append(ev.get("data") or {})
    assert seen and seen[0]["tool"] == "SearchCorpus"
```

- [ ] **Step 2: Run → FAIL** (`uv run pytest tests/test_agent_loop.py -k agent_step -q`).

- [ ] **Step 3: Implement** — in `agent.py`, import the dispatcher and emit per tool call. Add to imports:

```python
from langchain_core.callbacks.manager import adispatch_custom_event
```

In `tools_node`, inside the `for call in last.tool_calls:` loop, emit the step BEFORE executing:

```python
    for call in last.tool_calls:
        await adispatch_custom_event(
            "agent_step", {"tool": call["name"], "args": call.get("args", {})}
        )
        obs, update = await dispatch_tool(call["name"], call.get("args", {}), dict(state))
        ...
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(agent): emit agent_step custom events from tools_node"` (no Co-Authored-By footer).

---

## Task 2: Map `agent_step` in the SSE generator

**Files:** Modify `src/sovereign_rag/api/ask/router.py`; Test `tests/test_ask_stream_agent.py` (new).

- [ ] **Step 1: Failing test** — create `tests/test_ask_stream_agent.py`:

```python
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

    def bind_tools(self, tools: Any) -> "_FakeChat":
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
            AIMessage(content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}]),
            AIMessage(content="Final answer."),
        ]
    )
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: fake)

    from sovereign_rag.graphs.rag_qa.graph import build_graph

    graph = build_graph(InMemorySaver())
    cfg: dict[str, Any] = {"configurable": {"thread_id": "s1"}}
    events = await _collect(
        ask_router._stream_generator(graph, {"question": "q"}, cfg, "s1", None)
    )
    types = [e["type"] for e in events]
    assert "open" in types and "done" in types
    steps = [e for e in events if e["type"] == "agent_step"]
    assert steps and steps[0]["tool"] == "SearchCorpus"
    done = next(e for e in events if e["type"] == "done")
    assert done["answer"] == "Final answer."
```

- [ ] **Step 2: Run → FAIL** (no `agent_step` SSE branch yet).

- [ ] **Step 3: Implement** — in `src/sovereign_rag/api/ask/router.py`, in `_stream_generator`, add a branch next to the `crawl_progress` one:

```python
                elif kind == "on_custom_event" and name == "agent_step":
                    data = event.get("data") or {}
                    if isinstance(data, dict):
                        yield _sse({**data, "type": "agent_step"})
```

- [ ] **Step 4: Run → PASS.**

- [ ] **Step 5: Commit** — `git commit -am "feat(api): map agent_step tool events to SSE"`.

---

## Task 3: Frontend stream type (so the event is typed, even if rendered in Plan 5)

**Files:** Modify `frontend/src/hooks/use-ask-stream.ts`.

- [ ] **Step 1: Add the event to the `StreamEvent` union** (after the `crawl_progress` line):

```typescript
  | { type: "agent_step"; tool: string; args?: Record<string, unknown> }
```

- [ ] **Step 2: Add an optional callback** to `UseAskStreamOptions`:

```typescript
  onAgentStep?: (ev: Extract<StreamEvent, { type: "agent_step" }>) => void
```

- [ ] **Step 3: Dispatch it** in the `dispatch` switch:

```typescript
    case "agent_step":
      opts.onAgentStep?.(event)
      return
```

- [ ] **Step 4: Build check** — `cd frontend && npm run build` (tsc passes). Lint baseline unchanged.

- [ ] **Step 5: Commit** — `git commit -am "feat(ui): type the agent_step stream event"`.

---

## Task 4: Gate

- [ ] `uv run ruff check src/ tests/ && uv run ruff format --check src/ tests/ && uv run mypy src/ && uv run pytest -m "not integration" -q` → all green. `cd frontend && npm run build` → passes.
- [ ] Commit any fixes: `chore(agent): plan-3 gate green`.

---

## Self-review

- Spec coverage: agent tool steps surfaced over SSE (§3/§7) ✓; agent path streams tokens + done + interrupt confirmed via `test_ask_stream_agent` and the Plan-2 HITL test ✓. `runs` audit: the agent path records via the existing `record_run` (grade=None/correction_attempts=0 are acceptable; no schema change). Frontend RENDERING of agent_step is Plan 5.
- Placeholder scan: none.
- Type consistency: `agent_step` event shape (`{tool, args}`) matches between `tools_node` emit, the SSE map, and the frontend union.
