# ReAct Agentic RAG — Plan 4: Eval A/B Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Let the graph-eval harness run the **ReAct agent** as a third arm alongside CRAG-on / CRAG-off, so the eval can A/B retrieval quality + cost (tool-call steps) and we can gate enabling the agent in prod on measured lift.

**Architecture:** `run_graph_eval` already toggles a build-time flag (`enable_corrective_rag`) and runs an auto-approver loop over `__interrupt__` — the agent interrupts identically (`crawl_and_index`), so the loop works unchanged. The only differences: set `enable_react_agent` instead, and read the ranked chunks for IR metrics from the agent's `retrieved_pool` (the agent has no `reranked` key). Add an `agent` arm to `run_ab` + the report.

**Tech Stack:** the existing `eval/graph_eval.py` + `eval/evaluate.py`, pytest. **Prereq:** Plans 1–3.

---

## Task 1: `run_graph_eval` supports the agent arm

**Files:** Modify `eval/graph_eval.py`; Test `tests/test_graph_eval.py`.

- [ ] **Step 1: Failing test** — append to `tests/test_graph_eval.py` (mirror the existing stubbed-graph setup in that file — reuse its fixtures/monkeypatches for milvus/rerank/grader/crawl, but set the agent flag and a scripted controller). The test asserts: with `enable_agent=True`, `run_graph_eval` returns one row per question, each row has the IR-metric keys (e.g. `precision@5`, `mrr`) computed from the agent's retrieved chunks, and a `steps` field. (Model the controller via the same fake-chat approach used in `tests/test_agent_loop.py`: one tool call `SearchCorpus` then a final message; stub `dispatch_tool`/`run_search_corpus` so retrieval returns a known chunk that matches `relevant_substrings`.)

  Write the test FIRST, run it, see it fail (`enable_agent` not accepted / ranked chunks empty for agent).

- [ ] **Step 2: Implement** in `eval/graph_eval.py`:

  Change the signature and flag handling of `run_graph_eval`:
  ```python
  async def run_graph_eval(
      qa_pairs: list[dict[str, Any]],
      corpus: dict[str, str],
      k: int,
      *,
      enable_crag: bool = False,
      enable_agent: bool = False,
  ) -> list[dict[str, Any]]:
  ```
  Save + set BOTH flags around the build (restore both in `finally`):
  ```python
      settings = get_settings()
      orig_crag = settings.enable_corrective_rag
      orig_agent = settings.enable_react_agent
      settings.enable_corrective_rag = enable_crag and not enable_agent
      settings.enable_react_agent = enable_agent
  ```
  After the auto-approve loop, extract the ranked chunks from whichever state shape ran, and capture step count:
  ```python
          if enable_agent:
              from sovereign_rag.graphs.rag_qa.tools import select_grounding

              ranked = select_grounding(state.get("retrieved_pool") or {}, k)
          else:
              ranked = state.get("reranked") or []
          row = _row(item["question"], ranked, item.get("relevant_substrings", []), k, state)
          row["requires_web"] = bool(item.get("requires_web", False))
          row["steps"] = int(state.get("steps", 0))
          rows.append(row)
  ```
  In `finally`, restore both: `settings.enable_corrective_rag = orig_crag; settings.enable_react_agent = orig_agent`.

- [ ] **Step 3: Run → PASS.** **Step 4: Commit** — `feat(eval): run_graph_eval agent arm (retrieved_pool IR metrics + steps)` (no Co-Authored-By footer).

---

## Task 2: Three-way A/B + report block

**Files:** Modify `eval/graph_eval.py`, `eval/evaluate.py`; Test `tests/test_graph_eval.py`.

- [ ] **Step 1: Failing test** — append a test asserting `run_ab(...)` now also returns an `agent` arm: `result["per_question_agent"]` exists and `result["summary"]` contains `aggregate_agent` (mean IR metrics) + `agent_mean_steps`.

- [ ] **Step 2: Implement** in `eval/graph_eval.py`:
  - In `run_ab`, after the existing off/on rows, add:
    ```python
    agent_rows = await run_graph_eval(qa_pairs, corpus, k, enable_agent=True)
    ```
    and include `"per_question_agent": agent_rows` in the returned dict.
  - In `summarize_ab(off_rows, on_rows, k, agent_rows=None)`: add an optional `agent_rows` param; when present, add to the returned summary:
    ```python
        if agent_rows is not None:
            result["aggregate_agent"] = {m: _mean(agent_rows, m) for m in metric_keys}
            result["agent_mean_steps"] = round(_mean(agent_rows, "steps"), 2)
            result["agent_fallback_fired"] = sum(1 for r in agent_rows if r.get("fallback_used"))
    ```
    (Build the dict into a local `result` var first if it isn't already, then return it.) Pass `agent_rows` from `run_ab`.

- [ ] **Step 3: Implement** in `eval/evaluate.py`: in the graph-mode report printer (the `crag` block around lines 373–384), if `crag.get("aggregate_agent")` is present, print an `agent` row per metric + `agent_mean_steps` + `agent_fallback_fired`. Keep it a few `print()`s mirroring the existing CRAG-on/off lines. The `results["crag"]` block already carries the summary, so no new top-level key is required.

- [ ] **Step 4: Run → PASS.** **Step 5: Commit** — `feat(eval): three-way A/B (agent arm) + report block`.

---

## Task 3: Gate

- [ ] `uv run ruff check src/ tests/ eval/ && uv run ruff format --check src/ tests/ eval/ && uv run mypy src/ && uv run pytest -m "not integration" -q` → green. Commit any fixes: `chore(eval): plan-4 gate green`.

---

## Self-review
- Spec §9 (eval A/B agent vs CRAG vs linear; auto-approver; cost metric) ✓ — IR metrics from `retrieved_pool` for the agent, `steps` as the cost metric, auto-approver reused. Multi-turn golden cases (reformat/multi-hop) need multi-turn eval support and are deferred (the harness is single-turn IR-metric based). No placeholders. Types: `enable_agent` flag, `agent_rows`/`aggregate_agent`/`agent_mean_steps` names consistent across `run_graph_eval`/`run_ab`/`summarize_ab`/`evaluate.py`.
