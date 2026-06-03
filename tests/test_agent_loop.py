"""ReAct agent loop — node behavior with a scripted fake chat model."""

from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage, HumanMessage, ToolMessage
from langgraph.checkpoint.memory import InMemorySaver

from sovereign_rag.config import get_settings
from sovereign_rag.documents import Chunk, RetrievedChunk
from sovereign_rag.graphs.rag_qa import agent as agent_mod


class _FakeChat:
    """A chat model that returns scripted AIMessages, one per ainvoke call.
    bind_tools is a no-op that returns self (we don't exercise real tool-calling)."""

    def __init__(self, scripted: list[AIMessage]) -> None:
        self._scripted = scripted
        self.calls = 0

    def bind_tools(self, tools: Any) -> _FakeChat:
        return self

    async def ainvoke(self, messages: Any) -> AIMessage:
        msg = self._scripted[min(self.calls, len(self._scripted) - 1)]
        self.calls += 1
        return msg


def _rc(cid: str, score: float) -> RetrievedChunk:
    chunk = Chunk(
        doc_id="d", text="t", raw_text="body", position=0, chunk_id=cid, metadata={"title": "T"}
    )
    return RetrievedChunk(chunk=chunk, score=score, source="reranked")


def _build_stub_agent(monkeypatch, scripted):  # type: ignore[no-untyped-def]
    """Compile the agent graph with a scripted controller + stubbed tools."""
    monkeypatch.setattr(get_settings(), "enable_react_agent", True)
    fake = _FakeChat(scripted)  # one shared instance so the call counter advances across nodes
    monkeypatch.setattr(agent_mod, "get_chat_model", lambda **_: fake)
    return agent_mod.build_agent_graph().compile(checkpointer=InMemorySaver())


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
    tool_msg = AIMessage(
        content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}]
    )
    assert agent_mod.route_agent({"scratch": [tool_msg], "steps": 1}) == "tools"
    plain = AIMessage(content="done")
    assert agent_mod.route_agent({"scratch": [plain], "steps": 1}) == "finalize"
    # step cap forces finalize even with pending tool calls
    assert agent_mod.route_agent({"scratch": [tool_msg], "steps": 4}) == "finalize"


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
        return '{"results": [], "top_score": 0.9}', {
            "retrieved_pool": {"c1": _rc("c1", 0.9)},
            "retrieved": 1,
        }

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    # step 1: search; step 2: final answer (no tool) → finalize regenerates over pool
    graph = _build_stub_agent(
        monkeypatch,
        [
            AIMessage(
                content="",
                tool_calls=[{"name": "SearchCorpus", "args": {"query": "credits"}, "id": "1"}],
            ),
            AIMessage(content="(draft)"),
            AIMessage(content="Grounded [1]."),  # finalize's regeneration call
        ],
    )
    out = await graph.ainvoke(
        {"question": "what about credits?"}, {"configurable": {"thread_id": "t2"}}
    )
    assert out["answer"] == "Grounded [1]."
    assert out["retrieved"] == 1 and out["used"] >= 1


async def test_step_cap_forces_finalize(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setattr(get_settings(), "react_max_steps", 2)

    async def fake_dispatch(name, args, state):  # type: ignore[no-untyped-def]
        return "obs", {"retrieved_pool": {}, "retrieved": 0}

    monkeypatch.setattr(agent_mod, "dispatch_tool", fake_dispatch)
    # controller always wants to search (tool-call AIMessage with empty content);
    # cap forces finalize while last message is still a tool call → new fallback
    # generation path must return a non-blank answer.
    looping = AIMessage(
        content="", tool_calls=[{"name": "SearchCorpus", "args": {"query": "x"}, "id": "1"}]
    )
    # The scripted list: [looping, looping, "Capped answer."]
    # agent() calls: step-1 → looping, step-2 → looping (cap hit after step-2,
    # route → finalize). finalize's fallback calls ainvoke once → "Capped answer."
    graph = _build_stub_agent(monkeypatch, [looping, looping, AIMessage(content="Capped answer.")])
    out = await graph.ainvoke({"question": "q"}, {"configurable": {"thread_id": "t3"}})
    assert out["answer"] == "Capped answer."


async def test_disabled_flag_builds_existing_graph(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    from sovereign_rag.graphs.rag_qa.graph import make_graph

    monkeypatch.setattr(get_settings(), "enable_react_agent", False)
    monkeypatch.setattr(get_settings(), "enable_corrective_rag", False)
    graph = await make_graph()
    names = set(graph.get_graph().nodes)
    assert "prepare" not in names and "retrieve_local" in names


async def test_crawl_and_index_interrupts_then_resumes(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    # search returns nothing; controller decides to web_search then crawl_and_index;
    # crawl_and_index interrupts for approval; resume approves and crawl runs.
    async def fake_search_corpus(query, doc_id):  # type: ignore[no-untyped-def]
        return '{"results": [], "top_score": null}', {"retrieved_pool": {}, "retrieved": 0}

    async def fake_web_search(query):  # type: ignore[no-untyped-def]
        return '{"candidates": []}', {
            "candidate_urls": [{"url": "https://x", "title": "X", "snippet": "s"}]
        }

    async def fake_do_crawl(approved):  # type: ignore[no-untyped-def]
        return f"Indexed 3 chunks from {len(approved)}.", {
            "fallback_used": True,
            "approved_urls": approved,
        }

    import sovereign_rag.graphs.rag_qa.tools as tools_mod

    monkeypatch.setattr(tools_mod, "run_search_corpus", fake_search_corpus)
    monkeypatch.setattr(tools_mod, "run_web_search", fake_web_search)
    monkeypatch.setattr(tools_mod, "_do_crawl", fake_do_crawl)

    graph = _build_stub_agent(
        monkeypatch,
        [
            AIMessage(
                content="", tool_calls=[{"name": "WebSearch", "args": {"query": "x"}, "id": "1"}]
            ),
            AIMessage(
                content="",
                tool_calls=[{"name": "CrawlAndIndex", "args": {"urls": ["https://x"]}, "id": "2"}],
            ),
            AIMessage(content="Answer after crawl."),
        ],
    )
    cfg = {"configurable": {"thread_id": "t4"}}
    first = await graph.ainvoke({"question": "obscure thing"}, cfg)
    assert "__interrupt__" in first  # paused at crawl approval
    payload = first["__interrupt__"][0].value
    assert (
        payload["reason"] == "approve_urls" and payload["candidate_urls"][0]["url"] == "https://x"
    )

    from langgraph.types import Command

    final = await graph.ainvoke(Command(resume={"approved_urls": ["https://x"]}), cfg)
    assert "__interrupt__" not in final
    assert final["answer"] == "Answer after crawl."


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
