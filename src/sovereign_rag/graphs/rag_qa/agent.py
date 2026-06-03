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

import contextlib
from typing import Any

from langchain_core.callbacks.manager import adispatch_custom_event
from langchain_core.messages import HumanMessage, SystemMessage, ToolMessage
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
    "- A NEW information need → call SearchCorpus with a concise standalone query "
    "(resolve any references from the conversation).\n"
    "- Local results weak or empty and external info is needed → call WebSearch, "
    "then CrawlAndIndex the best URLs (the user must approve them).\n"
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
    # parallel_tool_calls=False is only supported by OpenAI-compatible providers;
    # ChatOllama (the default local-first provider) does not accept that kwarg and
    # would raise. Read-only tools (SearchCorpus/WebSearch) are idempotent so
    # re-executing them on a HITL resume is safe; CrawlAndIndex is interrupt-gated
    # and therefore never double-run regardless of parallel_tool_calls.
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


async def tools_node(state: AgentState) -> dict[str, Any]:
    """Execute every tool call in the controller's last message, append a
    ToolMessage per call, and merge state updates. ``retrieved_pool`` MERGES
    (so multi-hop answers accumulate); other keys overwrite (last write wins)."""
    last = state["scratch"][-1]
    new_messages: list[ToolMessage] = []
    pool: dict[str, Any] = dict(state.get("retrieved_pool") or {})
    extra: dict[str, Any] = {}
    for call in getattr(last, "tool_calls", []):
        with contextlib.suppress(RuntimeError):
            await adispatch_custom_event(
                "agent_step", {"tool": call["name"], "args": call.get("args", {})}
            )
        obs, update = await dispatch_tool(call["name"], call.get("args", {}), dict(state))
        new_messages.append(ToolMessage(content=obs, tool_call_id=call["id"]))
        if "retrieved_pool" in update:
            pool.update(update.pop("retrieved_pool"))
        extra.update(update)
    return {"scratch": [*state["scratch"], *new_messages], "retrieved_pool": pool, **extra}


async def finalize(state: AgentState) -> dict[str, Any]:
    """Produce the answer. If the turn retrieved nothing (a reformat / answered-
    from-context turn), the controller's last reply IS the answer. Otherwise
    regenerate a grounded, cited answer over the FULL passages in retrieved_pool
    (the union of every search this turn)."""
    pool = state.get("retrieved_pool") or {}
    last = state["scratch"][-1]
    last_text = last.content if isinstance(last.content, str) else str(last.content)
    if not pool:
        # Reformat / answered-from-context: the controller produced a direct reply.
        if last_text.strip() and not getattr(last, "tool_calls", None):
            return {"answer": last_text.strip(), "citations": [], "retrieved": 0, "used": 0}
        # Forced finalize at the step cap (pending tool calls / empty content) or a
        # decline with nothing retrieved → answer from the conversation rather than blank.
        llm = get_chat_model(model_tier="default")
        resp = await llm.ainvoke(
            [
                SystemMessage(content=_ANSWER_SYSTEM),
                HumanMessage(
                    content=(
                        f"Conversation so far:\n{_format_history(state.get('history'))}\n\n"
                        "No additional sources were retrieved. Answer the question from the "
                        "conversation if possible; if you cannot, say so briefly.\n\n"
                        f"Question: {state['question']}"
                    )
                ),
            ]
        )
        text = resp.content if isinstance(resp.content, str) else str(resp.content)
        return {
            "answer": text.strip() or "I couldn't find enough information to answer that.",
            "citations": [],
            "retrieved": 0,
            "used": 0,
        }

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


__all__ = [
    "agent",
    "build_agent_graph",
    "finalize",
    "prepare",
    "record_turn",
    "route_agent",
    "tools_node",
]
