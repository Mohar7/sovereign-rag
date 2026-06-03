# ReAct Agentic RAG — Plan 2: Agent loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the Plan-1 tools + state into a runnable ReAct loop — a controller LLM that searches/answers, an HITL `crawl_and_index` tool, a full-passage `finalize`, and a `record_turn` that maintains conversation memory — built as a flag-gated topology in the existing `rag_qa` graph.

**Architecture:** `START → prepare → agent ⇄ tools (loop ≤ react_max_steps) → finalize → record_turn → END`. The `agent` node (kimi-k2, `bind_tools`) reasons over compact observations + windowed history; `tools` executes the Plan-1 executors and stashes full chunks; `finalize` grounds the answer in the full `retrieved_pool` (or, for a no-search reformat turn, uses the agent's direct reply); `record_turn` appends to `history`. `enable_react_agent` selects this topology in `make_graph`/`build_graph`; off → today's CRAG/linear graph (unchanged).

**Tech Stack:** LangGraph `StateGraph`/conditional edges/`interrupt()`, LangChain `bind_tools` + `AIMessage.tool_calls`/`ToolMessage`, pydantic v2 tool schemas, pytest (`asyncio_mode=auto`) with a scripted fake chat model, `uv`, ruff + mypy.

**Spec:** `docs/superpowers/specs/2026-06-03-react-agentic-rag-design.md` · **Prereq:** Plan 1 merged (`agent_state.py`, `tools.py`).

---

## File structure (Plan 2)

- **Modify** `src/sovereign_rag/graphs/rag_qa/tools.py` — add the 3 pydantic **tool schemas** (`SearchCorpus`/`WebSearch`/`CrawlAndIndex`), the HITL `run_crawl_and_index` executor (+ its `_do_crawl` core), and a `dispatch_tool` router. (Stays the tool layer — no graph/LLM.)
- **Create** `src/sovereign_rag/graphs/rag_qa/agent.py` — the loop: `_AGENT_SYSTEM`, `_format_history`, nodes (`prepare`/`agent`/`route_agent`/`tools_node`/`finalize`/`record_turn`), and `build_agent_graph()`. One responsibility: the agent control flow.
- **Modify** `src/sovereign_rag/graphs/rag_qa/graph.py` — `make_graph`/`build_graph` dispatch on `enable_react_agent`.
- **Create** `tests/test_agent_loop.py`; **extend** `tests/test_agent_tools.py` (crawl executor).

---

## Task 1: Tool schemas + dispatch + HITL crawl executor

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/tools.py`
- Test: `tests/test_agent_tools.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_agent_tools.py`:

```python
async def test_do_crawl_indexes_and_reports(monkeypatch: pytest.MonkeyPatch) -> None:
    from sovereign_rag.config import get_settings

    monkeypatch.setattr(get_settings(), "crag_fast_web_index", True)
    monkeypatch.setattr(get_settings(), "crawl_concurrency", 3)
    monkeypatch.setattr(tools, "get_pipeline", lambda: object())

    async def fake_one(pipe, url, hard, *, enrich):  # type: ignore[no-untyped-def]
        assert enrich is False  # fast web index path
        return 4

    monkeypatch.setattr(tools, "_crawl_and_index_one", fake_one)

    obs, update = await tools._do_crawl(["https://a", "https://b"])
    assert "Indexed 8 chunks from 2" in obs
    assert update == {"fallback_used": True, "approved_urls": ["https://a", "https://b"]}


async def test_dispatch_tool_routes_search(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_search_corpus(query, doc_id):  # type: ignore[no-untyped-def]
        return "OBS", {"retrieved": 1}

    monkeypatch.setattr(tools, "run_search_corpus", fake_search_corpus)
    obs, upd = await tools.dispatch_tool("SearchCorpus", {"query": "q"}, {"doc_id": None})
    assert obs == "OBS" and upd == {"retrieved": 1}


async def test_dispatch_tool_unknown() -> None:
    obs, upd = await tools.dispatch_tool("Nope", {}, {})
    assert "Unknown tool" in obs and upd == {}
```

- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/test_agent_tools.py -k "do_crawl or dispatch_tool" -q` → FAIL (`_do_crawl`/`dispatch_tool` missing).

- [ ] **Step 3: Implement** — in `tools.py`, add to the module-scope imports:

```python
from pydantic import BaseModel, Field

from sovereign_rag.graphs.rag_qa.nodes import (
    _CRAWL_HARD_TIMEOUT_MARGIN_S,
    _crawl_and_index_one,
    _parse_resume,
)
```

and append:

```python
# ── Tool schemas (bound to the controller LLM in agent.py) ──────────────


class SearchCorpus(BaseModel):
    """Search the indexed local knowledge base for passages relevant to a
    standalone query. Resolve pronouns/references from the conversation first."""

    query: str = Field(description="Standalone search query.")


class WebSearch(BaseModel):
    """Search the public web for candidate source URLs when the local corpus is
    insufficient. Returns candidates only — it does not read them."""

    query: str = Field(description="Web search query.")


class CrawlAndIndex(BaseModel):
    """Crawl and index specific web URLs (from a prior web_search) into the
    corpus so they become searchable. Requires human approval before crawling."""

    urls: list[str] = Field(description="URLs to crawl and index.")


TOOL_SCHEMAS: list[type[BaseModel]] = [SearchCorpus, WebSearch, CrawlAndIndex]


# ── Crawl tool (HITL) ───────────────────────────────────────────────────


async def _do_crawl(approved: list[str]) -> tuple[str, dict[str, Any]]:
    """Crawl + fast-index approved URLs in parallel (no interrupt here — the
    caller gates approval). Reuses the per-URL helper that bounds each crawl
    with a hard timeout and degrades a bad URL to 'failed'."""
    import asyncio

    s = get_settings()
    pipe = get_pipeline()
    hard = s.crawl_timeout_s + _CRAWL_HARD_TIMEOUT_MARGIN_S
    sem = asyncio.Semaphore(max(1, s.crawl_concurrency))

    async def _one(url: str) -> int:
        async with sem:
            return await _crawl_and_index_one(pipe, url, hard, enrich=not s.crag_fast_web_index)

    counts = await asyncio.gather(*(_one(u) for u in approved))
    total = sum(counts)
    return (
        f"Indexed {total} chunks from {len(approved)} URL(s). Call search_corpus again to use them.",
        {"fallback_used": total > 0, "approved_urls": approved},
    )


async def run_crawl_and_index(
    urls: list[str], question: str, candidates: list[dict[str, str]]
) -> tuple[str, dict[str, Any]]:
    """HITL: pause for human approval of ``urls`` (interrupt), then crawl+index
    on approve. Decline (or empty resume) answers from local context."""
    from langgraph.types import interrupt

    selected = [c for c in candidates if c.get("url") in set(urls)] or [
        {"url": u, "title": "", "snippet": ""} for u in urls
    ]
    decision = interrupt(
        {"reason": "approve_urls", "question": question, "candidate_urls": selected}
    )
    approved = _parse_resume(decision)
    if not approved:
        return (
            "User declined the web fallback; answer from local context.",
            {"declined": True, "fallback_used": False, "approved_urls": []},
        )
    return await _do_crawl(approved)


async def dispatch_tool(
    name: str, args: dict[str, Any], state: dict[str, Any]
) -> tuple[str, dict[str, Any]]:
    """Route an LLM tool call to its executor with the state it needs."""
    if name == "SearchCorpus":
        return await run_search_corpus(args["query"], state.get("doc_id"))
    if name == "WebSearch":
        return await run_web_search(args["query"])
    if name == "CrawlAndIndex":
        return await run_crawl_and_index(
            args["urls"], state.get("question", ""), state.get("candidate_urls", []) or []
        )
    return f"Unknown tool: {name}", {}
```

Extend `__all__` to include the new public names:

```python
__all__ = [
    "CrawlAndIndex",
    "SearchCorpus",
    "TOOL_SCHEMAS",
    "WebSearch",
    "_compact_chunks",
    "dispatch_tool",
    "run_crawl_and_index",
    "run_search_corpus",
    "run_web_search",
    "select_grounding",
]
```

- [ ] **Step 4: Run to verify they pass** — `uv run pytest tests/test_agent_tools.py -q` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/tools.py tests/test_agent_tools.py
git commit -m "feat(agent): tool schemas + dispatch + HITL crawl_and_index executor"
```

---

## Task 2: Loop nodes — `prepare`, `agent`, `route_agent`

**Files:**
- Create: `src/sovereign_rag/graphs/rag_qa/agent.py`
- Test: `tests/test_agent_loop.py`

- [ ] **Step 1: Write the failing test** — create `tests/test_agent_loop.py`:

```python
"""ReAct agent loop — node behavior with a scripted fake chat model."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage

from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa import agent as agent_mod


class _FakeChat:
    """A chat model that returns scripted AIMessages, one per ainvoke call.
    bind_tools is a no-op that returns self (we don't exercise real tool-calling)."""

    def __init__(self, scripted: list[AIMessage]) -> None:
        self._scripted = scripted
        self.calls = 0

    def bind_tools(self, tools: Any) -> "_FakeChat":
        return self

    async def ainvoke(self, messages: Any) -> AIMessage:
        msg = self._scripted[min(self.calls, len(self._scripted) - 1)]
        self.calls += 1
        return msg


async def test_prepare_resets_per_turn() -> None:
    out = await agent_mod.prepare({"question": "hi", "retrieved_pool": {"x": 1}, "steps": 9})
    assert out["steps"] == 0
    assert out["retrieved_pool"] == {}
    assert isinstance(out["scratch"][0], HumanMessage) and out["scratch"][0].content == "hi"


async def test_agent_appends_response_and_increments_steps(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    fake = _FakeChat([AIMessage(content="hello")])
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: fake)
    state = {"question": "q", "scratch": [HumanMessage(content="q")], "steps": 0, "history": []}
    out = await agent_mod.agent(state)
    assert out["steps"] == 1
    assert out["scratch"][-1].content == "hello"


def test_route_agent_tools_vs_finalize(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "react_max_steps", 4)
    tool_msg = AIMessage(content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}])
    assert agent_mod.route_agent({"scratch": [tool_msg], "steps": 1}) == "tools"
    plain = AIMessage(content="done")
    assert agent_mod.route_agent({"scratch": [plain], "steps": 1}) == "finalize"
    # step cap forces finalize even with pending tool calls
    assert agent_mod.route_agent({"scratch": [tool_msg], "steps": 4}) == "finalize"
```

- [ ] **Step 2: Run to verify it fails** — `uv run pytest tests/test_agent_loop.py -q` → FAIL (`agent` module missing).

- [ ] **Step 3: Implement** — create `src/sovereign_rag/graphs/rag_qa/agent.py`:

```python
"""ReAct agent loop for rag_qa (built when ``enable_react_agent=True``).

Topology::

    START → prepare → agent ⇄ tools  (loop ≤ react_max_steps)
                        │
                        └─ no tool call / cap → finalize → record_turn → END

The controller reasons over COMPACT observations + a windowed conversation
history; ``finalize`` grounds the answer in the FULL passages stashed in
``retrieved_pool`` (or, for a no-search reformat turn, uses the controller's
direct reply). See ``docs/superpowers/specs/2026-06-03-react-agentic-rag-design.md``.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langgraph.graph import END, START, StateGraph

from sovereign_rag.config import get_settings
from sovereign_rag.graphs.rag_qa.agent_state import AgentState, HistoryTurn
from sovereign_rag.graphs.rag_qa.tools import (
    TOOL_SCHEMAS,
    dispatch_tool,
    select_grounding,
)
from sovereign_rag.retrieval.pipeline import _ANSWER_SYSTEM, _format_context
from sovereign_rag.shared.llm_factory import get_chat_model

_AGENT_SYSTEM = (
    "You are a retrieval agent for a private knowledge base. Decide how to handle "
    "the user's latest message:\n"
    "- A NEW information need → call search_corpus with a concise standalone query "
    "(resolve any references from the conversation).\n"
    "- Local results weak or empty and external info is needed → call web_search, "
    "then crawl_and_index the best URLs (the user must approve them).\n"
    "- A follow-up that only transforms your PREVIOUS answer (translate, shorten, "
    "rephrase) or is answerable from the conversation → do NOT call a tool; reply "
    "with the answer directly.\n"
    "Keep tool use minimal. When you have enough, reply with your final answer."
)


def _format_history(history: list[HistoryTurn] | None) -> str:
    if not history:
        return "(no prior turns)"
    return "\n".join(f"User: {t['question']}\nAssistant: {t['answer']}" for t in history)


async def prepare(state: AgentState) -> dict[str, Any]:
    """Per-turn reset: seed the scratch with the new user message, clear the
    retrieved pool / step counter / per-turn flags. ``history`` persists."""
    return {
        "scratch": [HumanMessage(content=state["question"])],
        "retrieved_pool": {},
        "steps": 0,
        "fallback_used": False,
        "declined": False,
    }


async def agent(state: AgentState) -> dict[str, Any]:
    """One controller turn: stable system + tool defs first, windowed history +
    scratch last (prefix-cache friendly). Emits tool calls or a final reply."""
    llm = get_chat_model(model_tier="default").bind_tools(TOOL_SCHEMAS)
    system = SystemMessage(
        content=f"{_AGENT_SYSTEM}\n\nConversation so far:\n{_format_history(state.get('history'))}"
    )
    resp = await llm.ainvoke([system, *state["scratch"]])
    return {"scratch": [*state["scratch"], resp], "steps": state.get("steps", 0) + 1}


def route_agent(state: AgentState) -> str:
    """Loop to tools while the controller requests them and we're under the step
    cap; otherwise go answer."""
    last = state["scratch"][-1]
    tool_calls = getattr(last, "tool_calls", None)
    if tool_calls and state.get("steps", 0) < get_settings().react_max_steps:
        return "tools"
    return "finalize"


__all__ = ["agent", "prepare", "route_agent"]
```

- [ ] **Step 4: Run to verify it passes** — `uv run pytest tests/test_agent_loop.py -q` → 3 passed.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/agent.py tests/test_agent_loop.py
git commit -m "feat(agent): prepare/agent/route_agent loop nodes"
```

---

## Task 3: `tools_node` (execute + merge)

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/agent.py`
- Test: `tests/test_agent_loop.py`

- [ ] **Step 1: Write the failing test** — append to `tests/test_agent_loop.py`:

```python
async def test_tools_node_executes_and_merges_pool(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        assert name == "SearchCorpus"
        return "obs-json", {"retrieved_pool": {"c1": "RC1"}, "retrieved": 1}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    tool_msg = AIMessage(
        content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "tc1"}]
    )
    state = {"scratch": [tool_msg], "retrieved_pool": {"c0": "RC0"}, "doc_id": None}
    out = await agent_mod.tools_node(state)
    # observation appended as a ToolMessage with the matching id
    assert isinstance(out["scratch"][-1], ToolMessage)
    assert out["scratch"][-1].tool_call_id == "tc1" and out["scratch"][-1].content == "obs-json"
    # pool merged (not overwritten)
    assert out["retrieved_pool"] == {"c0": "RC0", "c1": "RC1"}
    assert out["retrieved"] == 1
```

- [ ] **Step 2: Run to verify it fails** — `uv run pytest tests/test_agent_loop.py -k tools_node -q` → FAIL (`tools_node` missing).

- [ ] **Step 3: Implement** — in `agent.py`, add `tools_node` and export it:

```python
async def tools_node(state: AgentState) -> dict[str, Any]:
    """Execute every tool call in the controller's last message, append a
    ToolMessage per call, and merge state updates. ``retrieved_pool`` MERGES
    (so multi-hop answers accumulate); other keys overwrite (last write wins)."""
    last = state["scratch"][-1]
    new_messages: list[ToolMessage] = []
    pool: dict[str, Any] = dict(state.get("retrieved_pool") or {})
    extra: dict[str, Any] = {}
    for call in last.tool_calls:
        obs, update = await dispatch_tool(call["name"], call.get("args", {}), dict(state))
        new_messages.append(ToolMessage(content=obs, tool_call_id=call["id"]))
        if "retrieved_pool" in update:
            pool.update(update.pop("retrieved_pool"))
        extra.update(update)
    return {"scratch": [*state["scratch"], *new_messages], "retrieved_pool": pool, **extra}
```

Update `__all__`: `["agent", "prepare", "route_agent", "tools_node"]`.

- [ ] **Step 4: Run to verify it passes** — `uv run pytest tests/test_agent_loop.py -k tools_node -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/agent.py tests/test_agent_loop.py
git commit -m "feat(agent): tools_node — execute tool calls, merge retrieved_pool"
```

---

## Task 4: `finalize` + `record_turn`

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/agent.py`
- Test: `tests/test_agent_loop.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_agent_loop.py`:

```python
from sovereign_rag.documents import Chunk, RetrievedChunk


def _rc(cid: str, score: float) -> RetrievedChunk:
    chunk = Chunk(doc_id="d", text="t", raw_text="body", position=0, chunk_id=cid, metadata={"title": "T"})
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


async def test_finalize_empty_pool_uses_agent_reply() -> None:
    # reformat / answered-from-context: no search ran → use the controller's text
    state = {
        "question": "ответь на русском",
        "scratch": [AIMessage(content="Ответ на русском.")],
        "retrieved_pool": {},
    }
    out = await agent_mod.finalize(state)
    assert out["answer"] == "Ответ на русском."
    assert out["citations"] == [] and out["retrieved"] == 0 and out["used"] == 0


async def test_finalize_grounds_in_full_pool(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "rerank_top_k", 5)
    fake = _FakeChat([AIMessage(content="Grounded answer [1].")])
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: fake)
    state = {
        "question": "what about credits?",
        "scratch": [AIMessage(content="(draft over snippets)")],
        "retrieved_pool": {"c1": _rc("c1", 0.9), "c2": _rc("c2", 0.4)},
        "history": [],
        "fallback_used": False,
    }
    out = await agent_mod.finalize(state)
    assert out["answer"] == "Grounded answer [1]."
    assert out["retrieved"] == 2 and out["used"] == len(out["citations"]) and out["used"] >= 1


async def test_record_turn_appends_history() -> None:
    out = await agent_mod.record_turn({"question": "q1", "answer": "a1"})
    assert out["history"] == [{"question": "q1", "answer": "a1"}]
```

- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/test_agent_loop.py -k "finalize or record_turn" -q` → FAIL.

- [ ] **Step 3: Implement** — in `agent.py`, add and export:

```python
async def finalize(state: AgentState) -> dict[str, Any]:
    """Produce the answer. If the turn retrieved nothing (a reformat / answered-
    from-context turn), the controller's last reply IS the answer. Otherwise
    regenerate a grounded, cited answer over the FULL passages in retrieved_pool
    (the union of every search this turn)."""
    pool = state.get("retrieved_pool") or {}
    if not pool:
        last = state["scratch"][-1]
        text = last.content if isinstance(last.content, str) else str(last.content)
        return {"answer": text.strip(), "citations": [], "retrieved": 0, "used": 0}

    s = get_settings()
    grounding = select_grounding(pool, s.rerank_top_k)
    context_block, citations = _format_context(grounding)
    llm = get_chat_model(model_tier="default")
    resp = await llm.ainvoke(
        [
            SystemMessage(content=_ANSWER_SYSTEM),
            HumanMessage(
                content=(
                    f"Conversation so far:\n{_format_history(state.get('history'))}\n\n"
                    f"Context passages:\n{context_block}\n\nQuestion: {state['question']}"
                )
            ),
        ]
    )
    text = resp.content if isinstance(resp.content, str) else str(resp.content)
    return {
        "answer": text.strip(),
        "citations": citations,
        "retrieved": len(pool),
        "used": len(citations),
        "fallback_used": bool(state.get("fallback_used", False)),
    }


async def record_turn(state: AgentState) -> dict[str, Any]:
    """Append this (question, answer) to the windowed conversation history."""
    return {"history": [{"question": state["question"], "answer": state.get("answer") or ""}]}
```

Update `__all__`: `["agent", "finalize", "prepare", "record_turn", "route_agent", "tools_node"]`.

- [ ] **Step 4: Run to verify they pass** — `uv run pytest tests/test_agent_loop.py -k "finalize or record_turn" -q` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/agent.py tests/test_agent_loop.py
git commit -m "feat(agent): finalize (full-passage grounding) + record_turn memory"
```

---

## Task 5: `build_agent_graph` + topology flag

**Files:**
- Modify: `src/sovereign_rag/graphs/rag_qa/agent.py`, `src/sovereign_rag/graphs/rag_qa/graph.py`
- Test: `tests/test_agent_loop.py`

- [ ] **Step 1: Write the failing tests** — append to `tests/test_agent_loop.py`:

```python
from langgraph.checkpoint.memory import InMemorySaver
from langgraph.types import Command


def _build_stub_agent(monkeypatch, scripted):  # type: ignore[no-untyped-def]
    """Compile the agent graph with a scripted controller + stubbed tools."""
    monkeypatch.setattr(get_settings(), "enable_react_agent", True)
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: _FakeChat(scripted))
    return agent_mod.build_agent_graph().compile(checkpointer=InMemorySaver())


async def test_reformat_turn_calls_no_tools(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # controller answers directly (no tool calls) → finalize uses its reply
    graph = _build_stub_agent(monkeypatch, [AIMessage(content="Перевод готов.")])
    cfg = {"configurable": {"thread_id": "t1"}}
    out = await graph.ainvoke({"question": "ответь на русском"}, cfg)
    assert out["answer"] == "Перевод готов."
    assert out["retrieved"] == 0
    assert out["history"][-1] == {"question": "ответь на русском", "answer": "Перевод готов."}


async def test_new_info_turn_searches_then_grounds(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        return '{"results": [], "top_score": 0.9}', {"retrieved_pool": {"c1": _rc("c1", 0.9)}, "retrieved": 1}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    # step 1: search; step 2: final answer (no tool) → finalize regenerates over pool
    graph = _build_stub_agent(
        monkeypatch,
        [
            AIMessage(content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "credits"}, "id": "1"}]),
            AIMessage(content="(draft)"),
            AIMessage(content="Grounded [1]."),  # finalize's regeneration call
        ],
    )
    out = await graph.ainvoke({"question": "what about credits?"}, {"configurable": {"thread_id": "t2"}})
    assert out["answer"] == "Grounded [1]."
    assert out["retrieved"] == 1 and out["used"] >= 1


async def test_step_cap_forces_finalize(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "react_max_steps", 2)

    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        return "obs", {"retrieved_pool": {}, "retrieved": 0}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    # controller always wants to search; cap must stop it and finalize
    looping = AIMessage(content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}])
    graph = _build_stub_agent(monkeypatch, [looping])
    out = await graph.ainvoke({"question": "q"}, {"configurable": {"thread_id": "t3"}})
    assert "answer" in out  # did not loop forever; finalized after the cap


def test_disabled_flag_builds_existing_graph(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from sovereign_rag.graphs.rag_qa.graph import make_graph  # noqa: F401  (import smoke)

    monkeypatch.setattr(get_settings(), "enable_react_agent", False)
    monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
    import asyncio

    graph = asyncio.get_event_loop().run_until_complete(make_graph())
    names = set(graph.get_graph().nodes)
    assert "prepare" not in names and "retrieve_local" in names
```

(If the last test's event-loop handling is awkward under `asyncio_mode=auto`, make it an `async def` and `await make_graph()` directly.)

- [ ] **Step 2: Run to verify they fail** — `uv run pytest tests/test_agent_loop.py -q` → FAIL (`build_agent_graph` missing).

- [ ] **Step 3: Implement the builder** — in `agent.py`, add and export `build_agent_graph`:

```python
def build_agent_graph() -> StateGraph[AgentState]:
    """START → prepare → agent ⇄ tools (≤ react_max_steps) → finalize → record_turn → END."""
    builder: StateGraph[AgentState] = StateGraph(AgentState)
    builder.add_node("prepare", prepare)
    builder.add_node("agent", agent)
    builder.add_node("tools", tools_node)
    builder.add_node("finalize", finalize)
    builder.add_node("record_turn", record_turn)

    builder.add_edge(START, "prepare")
    builder.add_edge("prepare", "agent")
    builder.add_conditional_edges("agent", route_agent, {"tools": "tools", "finalize": "finalize"})
    builder.add_edge("tools", "agent")
    builder.add_edge("finalize", "record_turn")
    builder.add_edge("record_turn", END)
    return builder
```

Update `__all__`: add `"build_agent_graph"`.

- [ ] **Step 4: Wire the flag in `graph.py`** — replace the bodies of `make_graph` and `build_graph` so they dispatch on `enable_react_agent`:

```python
async def make_graph() -> Any:
    """Compile the rag_qa graph (no checkpointer). Topology is flag-dependent:
    ``enable_react_agent`` → the ReAct agent loop; else linear/CRAG (see
    ``_build_state_graph``)."""
    setup_tracing()
    if get_settings().enable_react_agent:
        from sovereign_rag.graphs.rag_qa.agent import build_agent_graph

        return build_agent_graph().compile()
    return _build_state_graph().compile()


def build_graph(checkpointer: BaseCheckpointSaver[Any] | None = None) -> Any:
    """Compile with a (production) checkpointer. ``enable_react_agent`` selects
    the ReAct agent loop; otherwise the linear/CRAG graph. The retrieval-dataclass
    serde allowlist is attached either way."""
    setup_tracing()
    if checkpointer is not None:
        checkpointer.serde = make_serde()
    if get_settings().enable_react_agent:
        from sovereign_rag.graphs.rag_qa.agent import build_agent_graph

        return build_agent_graph().compile(checkpointer=checkpointer)
    return _build_state_graph().compile(checkpointer=checkpointer)
```

(Leave `_build_state_graph` and the CRAG/linear topology untouched.)

- [ ] **Step 5: Run to verify they pass** — `uv run pytest tests/test_agent_loop.py -q` → all pass.

- [ ] **Step 6: Commit**

```bash
git add src/sovereign_rag/graphs/rag_qa/agent.py src/sovereign_rag/graphs/rag_qa/graph.py tests/test_agent_loop.py
git commit -m "feat(agent): build_agent_graph + enable_react_agent topology switch"
```

---

## Task 6: HITL crawl interrupt/resume (graph-level)

**Files:**
- Test: `tests/test_agent_loop.py`

- [ ] **Step 1: Write the failing test** — append to `tests/test_agent_loop.py`:

```python
async def test_crawl_and_index_interrupts_then_resumes(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # search returns nothing; controller decides to web_search then crawl_and_index;
    # crawl_and_index interrupts for approval; resume approves and crawl runs.
    async def fake_search_corpus(query, doc_id):  # type: ignore[no-untyped-def]
        return '{"results": [], "top_score": null}', {"retrieved_pool": {}, "retrieved": 0}

    async def fake_web_search(query):  # type: ignore[no-untyped-def]
        return '{"candidates": []}', {"candidate_urls": [{"url": "https://x", "title": "X", "snippet": "s"}]}

    async def fake_do_crawl(approved):  # type: ignore[no-untyped-def]
        return f"Indexed 3 chunks from {len(approved)}.", {"fallback_used": True, "approved_urls": approved}

    import sovereign_rag.graphs.rag_qa.tools as tools_mod

    monkeypatch.setattr(tools_mod, "run_search_corpus", fake_search_corpus)
    monkeypatch.setattr(tools_mod, "run_web_search", fake_web_search)
    monkeypatch.setattr(tools_mod, "_do_crawl", fake_do_crawl)

    graph = _build_stub_agent(
        monkeypatch,
        [
            AIMessage(content="", tool_calls=[{"name": "WebSearch", "args": {"query": "x"}, "id": "1"}]),
            AIMessage(content="", tool_calls=[{"name": "CrawlAndIndex", "args": {"urls": ["https://x"]}, "id": "2"}]),
            AIMessage(content="Answer after crawl."),
        ],
    )
    cfg = {"configurable": {"thread_id": "t4"}}
    first = await graph.ainvoke({"question": "obscure thing"}, cfg)
    assert "__interrupt__" in first  # paused at crawl approval
    payload = first["__interrupt__"][0].value
    assert payload["reason"] == "approve_urls" and payload["candidate_urls"][0]["url"] == "https://x"

    final = await graph.ainvoke(Command(resume={"approved_urls": ["https://x"]}), cfg)
    assert "__interrupt__" not in final
    assert final["answer"] == "Answer after crawl."
```

- [ ] **Step 2: Run to verify it fails or passes** — `uv run pytest tests/test_agent_loop.py -k crawl_and_index_interrupts -q`. It should PASS if Tasks 1–5 are correct (the machinery already exists). If it FAILS, the failure pinpoints a real wiring bug in the interrupt path — fix in `tools.run_crawl_and_index` / `tools_node` (do NOT weaken the test). Re-run until PASS.

- [ ] **Step 3: Commit** (test only, locks the HITL contract)

```bash
git add tests/test_agent_loop.py
git commit -m "test(agent): HITL crawl_and_index interrupt + resume"
```

---

## Task 7: Serde check + Plan-2 gate

**Files:** none (verification)

- [ ] **Step 1: Confirm checkpoint serde covers the agent state.** The agent graph compiled with a checkpointer must round-trip `scratch` (BaseMessage — in LangGraph's safe allowlist), `retrieved_pool` values (`RetrievedChunk` — already registered in `src/sovereign_rag/shared/checkpoint_serde.py`), `citations` (`Citation` — registered), and `history` (plain dicts). The Task 6 test already compiles with `InMemorySaver` and round-trips across an interrupt/resume; that exercises serialize/deserialize. No serde change expected. If Task 6 logged an "unregistered type" warning for any agent-state value, add that type to `make_serde()` and note it.

- [ ] **Step 2: Run the full gate**

```bash
uv run ruff check src/ tests/ && \
uv run ruff format --check src/ tests/ && \
uv run mypy src/ && \
uv run pytest -m "not integration" -q
```
Expected: ruff/format clean, mypy `Success`, all tests pass (existing + `test_agent_loop.py`).

- [ ] **Step 3: Commit any gate fixes**

```bash
git add -A && git commit -m "chore(agent): plan-2 gate green (ruff/format/mypy/pytest)"
```

---

## Self-review (done while writing)

- **Spec coverage (Plan 2):** loop nodes `prepare`/`agent`/`tools`/`finalize`/`record_turn` (spec §3) ✓; compact-obs-in / full-passage-finalize (§4) ✓; step cap (§4.3) ✓; windowed history fed to controller + finalize, prefix-cache ordering (§4.4-5) ✓; `crawl_and_index` HITL `interrupt()` reusing `_parse_resume` + the existing approval payload shape so `/ask/resume` + the frontend card work (§3, §6) ✓; grader-as-signal carried in the `search_corpus` observation (Plan 1) ✓; `enable_react_agent` topology switch, CRAG/linear untouched (§7-8) ✓. API/SSE mapping, eval A/B, frontend = Plans 3–5 (deferred by design).
- **Placeholder scan:** none — every step has runnable code/commands. (Task 6 is a pass/diagnose test, with explicit fix-don't-weaken guidance — not a placeholder.)
- **Type consistency:** `dispatch_tool(name, args, state)` matches `tools_node`'s call; `TOOL_SCHEMAS` bound in `agent`; `select_grounding`/`_format_context`/`_ANSWER_SYSTEM` reused with the Plan-1/pipeline signatures; `build_agent_graph` returns `StateGraph[AgentState]`; `make_graph`/`build_graph` dispatch names match. `retrieved_pool` merge in `tools_node` matches the overwrite-channel decision from Plan 1 (`prepare` resets it each turn).
