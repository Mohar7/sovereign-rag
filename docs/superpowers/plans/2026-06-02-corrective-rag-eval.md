# Corrective RAG — Eval graph-driven mode + auto-approver + A/B (Plan 3 of 5)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make CRAG measurable. Add a graph-driven eval path that runs the real LangGraph QA graph (with a programmatic auto-approver standing in for the human at the `interrupt()`), backed by a recorded web fixture so the corrective path is exercised deterministically offline. Produce a CRAG **on-vs-off A/B report** — IR-metric lift on the questions that needed the web, plus grade distribution and fallback-fired counts — written into `eval/results.json` for the Evals dashboard (Plan 4).

**Architecture:** Today `eval/evaluate.py` drives `RAGPipeline.retrieve()/answer()` directly and never touches the graph, so CRAG is invisible to it. Add `eval/graph_eval.py`: it indexes the corpus into the pipeline singleton, compiles the graph with an `InMemorySaver`, and for each question `ainvoke`s it — then an **auto-approver** loop resumes any `interrupt()` with the top-`web_fallback_crawl_top_k` candidate URLs (`Command(resume={"approved_urls": [...]})`) until the run completes. IR metrics read `final_state["reranked"]`; RAGAS reads `final_state["answer"]` + the reranked contexts. A small `eval/web_fixture.py` patches `nodes.search`/`nodes.crawl_url` with canned SearXNG hits + crawled markdown so `requires_web` golden questions trigger a real, deterministic correction with no network. `eval/evaluate.py` gains a dispatch: `EVAL_USE_GRAPH=1` runs the graph path twice (CRAG off → linear, CRAG on → corrective) and emits an A/B block.

**Tech Stack:** Python 3.12 · LangGraph (`build_graph` + `InMemorySaver`, `Command` from `langgraph.types`) · the existing `eval/retrieval_metrics.py` + `eval/ragas_eval.py` · pytest · uv.

**Scope note:** Plan **3 of 5**. Depends on Plans 1-2 (the graph + the interrupt/resume contract), on branch `feat/corrective-rag-backend`. Out of scope: the Evals UI panel (Plan 4 reads `results.json`), docs (Plan 5). Spec: `docs/superpowers/specs/2026-06-02-corrective-rag-hitl-design.md` §5.5, §9.

**Why the auto-approver, not autonomy:** the product is HITL-only; a batch eval can't have a human in the loop. The graph is unchanged — only the *approver* differs (human in prod, programmatic in eval). This is the "same graph / different approver" decision from the spec (§4) and keeps the measured path identical to the product path.

**Conventions:** Conventional-commit messages, **no `Co-Authored-By` footer**. `uv run pytest -m "not integration"`; `uv run ruff check`; `uv run mypy src/ eval/`. The eval harness must keep its "always exits 0 with a meaningful report" property (offline-safe).

---

## Background: how eval works today (read `eval/evaluate.py`)

- `load_qa_pairs()` → list of `{question, ground_truth, relevant_doc_ids, relevant_substrings}`. `load_corpus()` → `{doc_id: markdown}` over `eval/corpus/*.md` (asyncio docs).
- `_run_live(qa, corpus, k)`: builds `RAGPipeline()`, indexes each corpus doc, then per question `retrieved = await pipeline.retrieve(q)` (post-rerank top-k) → `_retrieval_row(q, retrieved, relevant_substrings, k)`; and (unless `EVAL_SKIP_RAGAS`) `result = await pipeline.answer(q)` → a RAGAS sample. Returns `{mode:"live", k, retrieval:{per_question, aggregate}, ragas}`. Returns `None` if the pipeline import or services are unavailable → caller falls back to `_run_offline`.
- `_run_offline`: a service-free IR demo over the bundled corpus.
- `_retrieval_row(q, retrieved, subs, k)` → `{question, n_retrieved, precision@k, recall@k, mrr, ndcg@k}`. `_aggregate(rows)` → mean per metric. `_print_table` / `_write_results` (`eval/results.json`). `_amain(k)` orchestrates live-then-offline.
- IR metrics (`eval/retrieval_metrics.py`) take `Sequence[RetrievedChunk]` + `relevant_substrings`. RAGAS (`eval/ragas_eval.py`) `run_ragas(samples)` with `{question, answer, contexts, ground_truth}`.

## File structure

| File | Responsibility | Action |
|---|---|---|
| `eval/fixtures/web/hits.json` | canned SearXNG results per query | **create** |
| `eval/fixtures/web/pages/*.md` | canned crawled page bodies | **create** |
| `eval/web_fixture.py` | load fixtures; patch `nodes.search`/`nodes.crawl_url` | **create** |
| `eval/qa_pairs.json` | add `requires_web` golden questions | modify |
| `eval/graph_eval.py` | graph-driven eval + auto-approver | **create** |
| `eval/evaluate.py` | dispatch `EVAL_USE_GRAPH`; A/B; report fields | modify |
| `tests/test_web_fixture.py` | fixture loader + patch | **create** |
| `tests/test_graph_eval.py` | auto-approver + graph-driven rows + A/B | **create** |

---

## Task 1: Recorded web fixture (`eval/fixtures/web/` + `eval/web_fixture.py`)

A deterministic stand-in for SearXNG + Crawl4AI: canned search hits per query and canned page markdown per URL, installed by patching the names `crawl_index`/`web_search` import in `graphs/rag_qa/nodes.py`.

**Files:**
- Create: `eval/fixtures/web/hits.json`, `eval/fixtures/web/pages/ferret-activation.md`, `eval/web_fixture.py`
- Test: `tests/test_web_fixture.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_web_fixture.py`:

```python
"""The recorded web fixture patches the graph's search/crawl with canned data."""

from __future__ import annotations

from sovereign_rag.documents import SourceDocument


async def test_fixture_search_returns_canned_hits() -> None:
    from eval.web_fixture import fixture_crawl_url, fixture_search

    hits = await fixture_search("how is FERRET activation codeword provisioned", max_results=5)
    assert hits, "fixture must return hits for a known query"
    assert all({"title", "url", "content"} <= set(h) for h in hits)
    # the canned page is crawlable
    doc = await fixture_crawl_url(hits[0]["url"])
    assert isinstance(doc, SourceDocument)
    assert "activation" in doc.markdown.lower()


async def test_fixture_search_unknown_query_is_empty() -> None:
    from eval.web_fixture import fixture_search

    assert await fixture_search("totally unrelated query xyzzy", max_results=5) == []


def test_install_patches_node_module() -> None:
    from eval import web_fixture
    from sovereign_rag.graphs.rag_qa import nodes

    orig_search, orig_crawl = nodes.search, nodes.crawl_url
    try:
        web_fixture.install()
        assert nodes.search is web_fixture.fixture_search
        assert nodes.crawl_url is web_fixture.fixture_crawl_url
    finally:
        web_fixture.uninstall(orig_search, orig_crawl)
        assert nodes.search is orig_search
        assert nodes.crawl_url is orig_crawl
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_web_fixture.py -v`
Expected: FAIL — `ModuleNotFoundError: No module named 'eval.web_fixture'`.

- [ ] **Step 3: Create the fixture data + loader**

`eval/fixtures/web/hits.json` (query-keyed; matching is substring/case-insensitive on the query):

```json
{
  "ferret activation codeword": [
    {
      "title": "Activation passes — provisioning",
      "url": "https://example.test/ferret-activation",
      "content": "FERRET activation codewords are provisioned out-of-band as short-lived activation passes."
    }
  ]
}
```

`eval/fixtures/web/pages/ferret-activation.md`:

```markdown
# FERRET activation passes

A FERRET activation codeword is provisioned out-of-band: the system issues a
short-lived activation pass bound to a single device. On first use the pass is
combined with the account secret to derive the session key. The codeword itself
is never transmitted in cleartext and is rotated per deployment.
```

`eval/web_fixture.py`:

```python
"""Recorded web fixture for deterministic, offline CRAG eval.

Patches the names ``search`` and ``crawl_url`` that ``graphs/rag_qa/nodes``
imported at module load, so the graph's ``web_search``/``crawl_index`` nodes use
canned SearXNG hits + crawled markdown instead of the network. Keyed by query
(substring match) and by URL (path stem → a markdown file under pages/).
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from sovereign_rag.documents import SourceDocument, SourceType

_FIX = Path(__file__).resolve().parent / "fixtures" / "web"
_HITS: dict[str, list[dict[str, str]]] = json.loads((_FIX / "hits.json").read_text("utf-8"))


async def fixture_search(query: str, max_results: int = 5) -> list[dict[str, str]]:
    """Canned SearXNG: return hits for the first key that is a casefold substring
    of the query (or whose key the query contains)."""
    q = query.casefold()
    for key, hits in _HITS.items():
        if key.casefold() in q or q in key.casefold():
            return hits[:max_results]
    return []


async def fixture_crawl_url(url: str) -> SourceDocument:
    """Canned Crawl4AI: read pages/<url-stem>.md as the page body."""
    stem = url.rstrip("/").rsplit("/", 1)[-1]
    body = (_FIX / "pages" / f"{stem}.md").read_text("utf-8")
    return SourceDocument(
        title=stem,
        source_uri=url,
        source_type=SourceType.WEB,
        markdown=body,
    )


def install() -> tuple[Any, Any]:
    """Patch the node module's search/crawl_url. Returns the originals."""
    from sovereign_rag.graphs.rag_qa import nodes

    orig = (nodes.search, nodes.crawl_url)
    nodes.search = fixture_search  # type: ignore[assignment]
    nodes.crawl_url = fixture_crawl_url  # type: ignore[assignment]
    return orig


def uninstall(orig_search: Any, orig_crawl: Any) -> None:
    """Restore the originals returned by install()."""
    from sovereign_rag.graphs.rag_qa import nodes

    nodes.search = orig_search
    nodes.crawl_url = orig_crawl


__all__ = ["fixture_crawl_url", "fixture_search", "install", "uninstall"]
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_web_fixture.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add eval/fixtures/ eval/web_fixture.py tests/test_web_fixture.py
git commit -m "feat(eval): recorded web fixture for deterministic CRAG eval"
```

---

## Task 2: `requires_web` golden questions

Add questions whose `relevant_substrings` appear ONLY in the fixture page (not the asyncio corpus), so local retrieval grades weak and the corrective path must fire to answer them.

**Files:**
- Modify: `eval/qa_pairs.json`
- Test: `tests/test_graph_eval.py` (created in Task 4 will assert these trigger fallback)

- [ ] **Step 1: Add the questions**

Append two objects to the `eval/qa_pairs.json` array (note the new `requires_web` flag; existing entries don't have it and default to false in code):

```json
  {
    "question": "How is FERRET's activation codeword provisioned?",
    "ground_truth": "It is provisioned out-of-band as a short-lived activation pass bound to a single device; on first use the pass is combined with the account secret to derive the session key.",
    "relevant_doc_ids": ["ferret-activation"],
    "relevant_substrings": ["short-lived activation pass", "combined with the account secret"],
    "requires_web": true
  },
  {
    "question": "Is a FERRET activation codeword transmitted in cleartext?",
    "ground_truth": "No. The codeword is never transmitted in cleartext and is rotated per deployment.",
    "relevant_doc_ids": ["ferret-activation"],
    "relevant_substrings": ["never transmitted in cleartext", "rotated per deployment"],
    "requires_web": true
  }
```

- [ ] **Step 2: Verify it loads + the substrings are NOT in the local corpus**

Run:
```bash
uv run python -c "
import json, pathlib
qa = json.loads(pathlib.Path('eval/qa_pairs.json').read_text())
web = [q for q in qa if q.get('requires_web')]
print('requires_web count:', len(web))
corpus = ' '.join(p.read_text() for p in pathlib.Path('eval/corpus').glob('*.md')).casefold()
for q in web:
    for s in q['relevant_substrings']:
        assert s.casefold() not in corpus, f'leak: {s!r} is in the local corpus'
print('ok: web substrings absent from local corpus')
"
```
Expected: `requires_web count: 2` then `ok: web substrings absent from local corpus`. (If a substring leaks into the corpus, reword it — the question must be unanswerable locally.)

- [ ] **Step 3: Commit**

```bash
git add eval/qa_pairs.json
git commit -m "feat(eval): add requires_web golden questions (answerable only via fallback)"
```

---

## Task 3: Graph-driven eval + auto-approver (`eval/graph_eval.py`)

**Files:**
- Create: `eval/graph_eval.py`
- Test: `tests/test_graph_eval.py`

- [ ] **Step 1: Write the failing test**

Create `tests/test_graph_eval.py`:

```python
"""Graph-driven eval: auto-approver resumes interrupts; rows carry grade+fallback.

Offline: the web fixture supplies canned hits/pages, and a tiny in-memory
'pipeline' stands in for Milvus/Neo4j so no services are needed. The grader is
stubbed to grade the local corpus weak on requires_web questions.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from eval import graph_eval
from sovereign_rag.documents import Chunk, RetrievedChunk


def _rc(text: str, score: float) -> RetrievedChunk:
    return RetrievedChunk(
        chunk=Chunk(doc_id="d", text=text, raw_text=text, position=0), score=score, source="reranked"
    )


@pytest.fixture
def stub_eval_graph(monkeypatch: pytest.MonkeyPatch) -> None:
    """Stub the data plane + grader so the graph runs offline, and make the
    requires_web question grade weak first then strong after the fixture crawl."""
    from sovereign_rag.graphs.rag_qa import nodes
    from sovereign_rag.retrieval.grading import Grade

    # pipeline singleton: a mock whose retrieve/index are no-ops; the reranked
    # set comes from the rerank stub below.
    pipe = MagicMock()
    pipe._milvus = MagicMock()
    pipe._milvus.hybrid_search = AsyncMock(return_value=[_rc("local async note", 0.4)])
    pipe._graph = None
    pipe.index_document = AsyncMock(return_value=3)
    pipe.aclose = AsyncMock()
    monkeypatch.setattr(nodes, "get_pipeline", lambda: pipe)
    monkeypatch.setattr(graph_eval, "_make_pipeline", lambda: pipe)

    # After a web crawl, retrieval includes the fixture chunk; model that by
    # flipping the rerank output once crawl_index has run (tracked via a flag).
    state_box = {"crawled": False}

    def fake_rerank(q: str, c: list[RetrievedChunk], top_k: int | None = None) -> list[RetrievedChunk]:
        if state_box["crawled"]:
            return [_rc("short-lived activation pass; combined with the account secret", 0.9)]
        return [_rc("local async note", 0.4)]

    monkeypatch.setattr(nodes, "rerank", fake_rerank)

    real_crawl_index = nodes.crawl_index

    async def tracking_crawl_index(state: Any) -> Any:
        state_box["crawled"] = True
        return await real_crawl_index(state)

    monkeypatch.setattr(nodes, "crawl_index", tracking_crawl_index)

    async def fake_grade(question, reranked, settings, **kw):  # type: ignore[no-untyped-def]
        top = reranked[0].score if reranked else 0.0
        return Grade("correct" if top >= 0.7 else "incorrect", top, "stub")

    monkeypatch.setattr(nodes, "grade_candidates", fake_grade)

    fake_llm = AsyncMock()
    fake_llm.ainvoke.return_value = MagicMock(content="answer [1]")
    monkeypatch.setattr(nodes, "get_chat_model", lambda **_: fake_llm)


async def test_auto_approver_resumes_and_answers(stub_eval_graph: None) -> None:
    from eval.web_fixture import install, uninstall

    orig = install()
    try:
        qa = [{"question": "How is FERRET's activation codeword provisioned?",
               "ground_truth": "...", "relevant_substrings": ["short-lived activation pass"],
               "requires_web": True}]
        rows = await graph_eval.run_graph_eval(qa, corpus={}, k=5, enable_crag=True)
    finally:
        uninstall(*orig)

    assert len(rows) == 1
    row = rows[0]
    assert row["fallback_used"] is True          # auto-approver crawled the fixture
    assert row["grade"] == "correct"             # post-crawl grade
    assert row["precision@5"] > 0                # the fixture chunk matches the substring


async def test_crag_off_no_fallback(stub_eval_graph: None) -> None:
    qa = [{"question": "How is FERRET's activation codeword provisioned?",
           "ground_truth": "...", "relevant_substrings": ["short-lived activation pass"],
           "requires_web": True}]
    rows = await graph_eval.run_graph_eval(qa, corpus={}, k=5, enable_crag=False)
    assert rows[0]["fallback_used"] is False     # linear graph never interrupts
    assert rows[0]["precision@5"] == 0           # local corpus can't answer it
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_graph_eval.py -v`
Expected: FAIL — `AttributeError: module 'eval.graph_eval' has no attribute 'run_graph_eval'`.

- [ ] **Step 3: Implement**

Create `eval/graph_eval.py`:

```python
"""Graph-driven evaluation: run the real CRAG graph with an auto-approver.

Drives the compiled rag_qa graph per question. When the graph pauses at the
HITL interrupt, an auto-approver resumes it with the top
``web_fallback_crawl_top_k`` candidate URLs — the same correction the product
runs, with a programmatic approver instead of a human. IR metrics read the
final ``reranked`` set; the grade + fallback flags come from the final state.
"""

from __future__ import annotations

import uuid
from typing import Any

from sovereign_rag.documents import RetrievedChunk, SourceDocument, SourceType

from eval.retrieval_metrics import mrr, ndcg_at_k, precision_at_k, recall_at_k

_AUTO_APPROVE_GUARD = 5  # never loop forever even if max_corrections is misconfigured


def _make_pipeline() -> Any:
    """Construct the real RAGPipeline (overridden in tests)."""
    from sovereign_rag.retrieval.pipeline import RAGPipeline

    return RAGPipeline()


def _row(question: str, reranked: list[RetrievedChunk], subs: list[str], k: int,
         state: dict[str, Any]) -> dict[str, Any]:
    return {
        "question": question,
        "n_retrieved": len(reranked),
        f"precision@{k}": precision_at_k(reranked, subs, k),
        f"recall@{k}": recall_at_k(reranked, subs, k),
        "mrr": mrr(reranked, subs),
        f"ndcg@{k}": ndcg_at_k(reranked, subs, k),
        "grade": state.get("grade"),
        "grade_confidence": state.get("grade_confidence"),
        "fallback_used": bool(state.get("fallback_used", False)),
        "requires_web": False,  # filled by the caller from the qa item
    }


async def run_graph_eval(
    qa_pairs: list[dict[str, Any]],
    corpus: dict[str, str],
    k: int,
    *,
    enable_crag: bool,
) -> list[dict[str, Any]]:
    """Index the corpus, compile the graph, and evaluate each question through it.

    ``enable_crag`` is set on Settings before the graph is built (it is a
    build-time structural flag). Returns one row per question with IR metrics +
    grade + fallback flags.
    """
    from langgraph.checkpoint.memory import InMemorySaver
    from langgraph.types import Command

    from sovereign_rag.config import get_settings
    from sovereign_rag.graphs.rag_qa.graph import build_graph
    from sovereign_rag.shared.pipeline_deps import set_pipeline

    settings = get_settings()
    settings.enable_corrective_rag = enable_crag

    pipeline = _make_pipeline()
    set_pipeline(pipeline)
    for doc_id, text in corpus.items():
        await pipeline.index_document(
            SourceDocument(
                title=doc_id,
                source_uri=f"corpus://{doc_id}",
                source_type=SourceType.TEXT,
                markdown=text,
            )
        )

    graph = build_graph(InMemorySaver())
    rows: list[dict[str, Any]] = []
    for item in qa_pairs:
        cfg = {"configurable": {"thread_id": str(uuid.uuid4())}}
        state = await graph.ainvoke({"question": item["question"]}, config=cfg)

        guard = 0
        while "__interrupt__" in state and guard < _AUTO_APPROVE_GUARD:
            payload = getattr(state["__interrupt__"][0], "value", {}) or {}
            candidates = payload.get("candidate_urls", []) if isinstance(payload, dict) else []
            approved = [c["url"] for c in candidates[: settings.web_fallback_crawl_top_k] if c.get("url")]
            state = await graph.ainvoke(Command(resume={"approved_urls": approved}), config=cfg)
            guard += 1

        reranked = state.get("reranked") or []
        row = _row(item["question"], reranked, item.get("relevant_substrings", []), k, state)
        row["requires_web"] = bool(item.get("requires_web", False))
        rows.append(row)

    close = getattr(pipeline, "aclose", None)
    if close is not None:
        await close()
    return rows


__all__ = ["run_graph_eval"]
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_graph_eval.py -v`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
git add eval/graph_eval.py tests/test_graph_eval.py
git commit -m "feat(eval): graph-driven eval with auto-approver for the HITL interrupt"
```

---

## Task 4: A/B aggregation + report (`eval/graph_eval.py` + `eval/evaluate.py`)

Run the graph path twice (CRAG off vs on) and compute the lift, grade distribution, and fallback count.

**Files:**
- Modify: `eval/graph_eval.py` (add `run_ab`), `eval/evaluate.py` (dispatch + report)
- Test: `tests/test_graph_eval.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_graph_eval.py`:

```python
class TestAB:
    def test_grade_distribution_and_lift(self) -> None:
        off = [
            {"question": "q1", "precision@5": 0.0, "recall@5": 0.0, "mrr": 0.0, "ndcg@5": 0.0,
             "grade": None, "fallback_used": False, "requires_web": True},
        ]
        on = [
            {"question": "q1", "precision@5": 1.0, "recall@5": 1.0, "mrr": 1.0, "ndcg@5": 1.0,
             "grade": "correct", "fallback_used": True, "requires_web": True},
        ]
        ab = graph_eval.summarize_ab(off, on, k=5)
        assert ab["fallback_fired"] == 1
        assert ab["grade_distribution"] == {"correct": 1, "ambiguous": 0, "incorrect": 0}
        # lift on the requires_web slice
        assert ab["lift_on_corrected"]["precision@5"] == pytest.approx(1.0)
        assert ab["aggregate_off"]["precision@5"] == pytest.approx(0.0)
        assert ab["aggregate_on"]["precision@5"] == pytest.approx(1.0)
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_graph_eval.py::TestAB -v`
Expected: FAIL — `AttributeError: ... has no attribute 'summarize_ab'`.

- [ ] **Step 3: Implement**

Add to `eval/graph_eval.py`:

```python
def _mean(rows: list[dict[str, Any]], key: str) -> float:
    vals = [float(r[key]) for r in rows if key in r and isinstance(r[key], int | float)]
    return sum(vals) / len(vals) if vals else 0.0


def summarize_ab(off_rows: list[dict[str, Any]], on_rows: list[dict[str, Any]], k: int) -> dict[str, Any]:
    """Compare CRAG-off vs CRAG-on rows (same question order).

    Reports the overall mean per IR metric for each arm, the lift on the
    ``requires_web`` slice (where correction should help), the grade
    distribution (CRAG-on), and how many questions fired the fallback.
    """
    metric_keys = [f"precision@{k}", f"recall@{k}", "mrr", f"ndcg@{k}"]
    aggregate_off = {m: _mean(off_rows, m) for m in metric_keys}
    aggregate_on = {m: _mean(on_rows, m) for m in metric_keys}

    web_off = [r for r in off_rows if r.get("requires_web")]
    web_on = [r for r in on_rows if r.get("requires_web")]
    lift = {m: round(_mean(web_on, m) - _mean(web_off, m), 4) for m in metric_keys}

    dist = {"correct": 0, "ambiguous": 0, "incorrect": 0}
    for r in on_rows:
        g = r.get("grade")
        if g in dist:
            dist[g] += 1

    return {
        "k": k,
        "aggregate_off": aggregate_off,
        "aggregate_on": aggregate_on,
        "lift_on_corrected": lift,
        "grade_distribution": dist,
        "fallback_fired": sum(1 for r in on_rows if r.get("fallback_used")),
        "n_questions": len(on_rows),
        "n_requires_web": len(web_on),
    }


async def run_ab(qa_pairs: list[dict[str, Any]], corpus: dict[str, str], k: int) -> dict[str, Any]:
    """Run the graph eval CRAG-off then CRAG-on and summarize the A/B."""
    off_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=False)
    on_rows = await run_graph_eval(qa_pairs, corpus, k, enable_crag=True)
    return {
        "summary": summarize_ab(off_rows, on_rows, k),
        "per_question_off": off_rows,
        "per_question_on": on_rows,
    }
```

Add `run_ab`, `summarize_ab` to `__all__`.

Then wire dispatch into `eval/evaluate.py`. In `_amain`, before the live/offline path, add a graph-mode branch:

```python
async def _amain(k: int = _K) -> dict[str, Any]:
    qa_pairs = load_qa_pairs()
    corpus = load_corpus()

    if os.environ.get("EVAL_USE_GRAPH", "").lower() in ("1", "true", "yes"):
        report = await _run_graph_mode(qa_pairs, corpus, k)
    else:
        report = await _run_live(qa_pairs, corpus, k)
        if report is None:
            report = _run_offline(qa_pairs, corpus, k)

    _print_table(report)
    _write_results(report)
    return report
```

And add `_run_graph_mode` to `eval/evaluate.py`:

```python
async def _run_graph_mode(
    qa_pairs: list[dict[str, Any]], corpus: dict[str, str], k: int
) -> dict[str, Any]:
    """Graph-driven CRAG A/B mode (EVAL_USE_GRAPH=1).

    Installs the recorded web fixture (deterministic, offline) unless
    EVAL_WEB_LIVE=1, runs the CRAG-off vs CRAG-on A/B through the real graph,
    and shapes the result into the standard report plus a ``crag`` block the
    Evals dashboard reads.
    """
    from eval.graph_eval import run_ab

    use_live_web = os.environ.get("EVAL_WEB_LIVE", "").lower() in ("1", "true", "yes")
    orig = None
    if not use_live_web:
        from eval import web_fixture

        orig = web_fixture.install()
    try:
        ab = await run_ab(qa_pairs, corpus, k)
    finally:
        if orig is not None:
            from eval import web_fixture

            web_fixture.uninstall(*orig)

    on_rows = ab["per_question_on"]
    return {
        "mode": "graph",
        "k": k,
        "retrieval": {
            "per_question": on_rows,  # the CRAG-on arm is the headline
            "aggregate": ab["summary"]["aggregate_on"],
        },
        "ragas": {"available": False, "scores": {}, "reason": "graph mode: IR + CRAG A/B only"},
        "crag": ab["summary"],
    }
```

(Imports: `_run_graph_mode` uses `os` — already imported in `evaluate.py`. `Any`/`dict` typing — `from typing import Any` is already imported.)

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_graph_eval.py -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
git add eval/graph_eval.py eval/evaluate.py tests/test_graph_eval.py
git commit -m "feat(eval): CRAG on/off A/B summary + EVAL_USE_GRAPH dispatch"
```

---

## Task 5: Report the CRAG A/B in the printed table + results.json

**Files:**
- Modify: `eval/evaluate.py` (`_print_table`)
- Test: `tests/test_graph_eval.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_graph_eval.py`:

```python
class TestReport:
    def test_print_table_renders_crag_block(self, capsys: pytest.CaptureFixture[str]) -> None:
        from eval.evaluate import _print_table

        report = {
            "mode": "graph",
            "k": 5,
            "retrieval": {"per_question": [], "aggregate": {"precision@5": 0.86}},
            "ragas": {"available": False, "scores": {}, "reason": "graph mode"},
            "crag": {
                "k": 5,
                "aggregate_off": {"precision@5": 0.71},
                "aggregate_on": {"precision@5": 0.86},
                "lift_on_corrected": {"precision@5": 0.15},
                "grade_distribution": {"correct": 9, "ambiguous": 3, "incorrect": 2},
                "fallback_fired": 3,
                "n_questions": 14,
                "n_requires_web": 2,
            },
        }
        _print_table(report)
        out = capsys.readouterr().out
        assert "CORRECTIVE RAG" in out.upper()
        assert "fallback" in out.lower()
        assert "0.15" in out  # the lift
```

- [ ] **Step 2: Run to verify it fails**

Run: `uv run pytest tests/test_graph_eval.py::TestReport -v`
Expected: FAIL — the CRAG block isn't printed.

- [ ] **Step 3: Implement**

In `eval/evaluate.py` `_print_table`, after the RAGAS block, add a CRAG section:

```python
    crag = report.get("crag")
    if crag:
        print("  CORRECTIVE RAG (A/B — CRAG off → on):")
        for metric, on_val in crag["aggregate_on"].items():
            off_val = crag["aggregate_off"].get(metric, 0.0)
            lift = crag["lift_on_corrected"].get(metric, 0.0)
            print(f"    {metric:<14} {off_val:.3f} -> {on_val:.3f}   (lift@web {lift:+.3f})")
        dist = crag["grade_distribution"]
        print(
            f"    grades         {dist['correct']}✓ / {dist['ambiguous']}~ / {dist['incorrect']}✗"
        )
        print(f"    fallback fired {crag['fallback_fired']} / {crag['n_questions']} questions")
        print("=" * 72)
```

- [ ] **Step 4: Run to verify it passes**

Run: `uv run pytest tests/test_graph_eval.py::TestReport -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add eval/evaluate.py tests/test_graph_eval.py
git commit -m "feat(eval): print CRAG A/B impact block + persist crag summary to results.json"
```

---

## Task 6: End-to-end graph-mode smoke (fixture-backed, offline) + full green

Prove the whole `EVAL_USE_GRAPH=1` path runs offline against the fixture and produces a `crag` block where the `requires_web` questions improve from off→on.

**Files:**
- Modify: `tests/test_graph_eval.py`

- [ ] **Step 1: Write the failing test**

Append to `tests/test_graph_eval.py` (reuses `stub_eval_graph` so it's offline, and drives the real `_run_graph_mode` with the fixture installed):

```python
class TestGraphModeSmoke:
    async def test_run_graph_mode_offline_produces_crag_block(
        self, stub_eval_graph: None, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from eval.evaluate import _run_graph_mode

        qa = [
            {"question": "How is FERRET's activation codeword provisioned?",
             "ground_truth": "...", "relevant_substrings": ["short-lived activation pass"],
             "requires_web": True},
        ]
        report = await _run_graph_mode(qa, corpus={}, k=5)
        assert report["mode"] == "graph"
        crag = report["crag"]
        assert crag["fallback_fired"] == 1
        # off can't answer it (0), on can (>0) → positive lift on the web slice
        assert crag["lift_on_corrected"]["precision@5"] > 0
```

- [ ] **Step 2: Run to verify it passes**

Run: `uv run pytest tests/test_graph_eval.py -v`
Expected: PASS. (The `stub_eval_graph` fixture stubs the data plane; `_run_graph_mode` installs the web fixture itself, and the `tracking_crawl_index` flips the rerank stub so the post-crawl grade is strong.)

- [ ] **Step 3: Full green + the real CLI smoke**

Run:
```bash
uv run pytest -m "not integration" -q
uv run ruff check src/ tests/ eval/
uv run mypy src/ eval/
# real CLI offline smoke (no services; uses the fixture). Should exit 0 and print the CRAG block:
EVAL_USE_GRAPH=1 EVAL_SKIP_RAGAS=1 uv run python -m eval.evaluate
```
Expected: suite green; the CLI prints the CORRECTIVE RAG A/B block and writes `eval/results.json` with a `crag` key. (If the real graph can't run fully offline — e.g. the grader's middle-band LLM is reached — note it; the fixture + stubbed grader path is what CI relies on. The CLI smoke here exercises the real grader, which on `requires_web` questions should grade `incorrect` by score alone (no LLM) since the local corpus has no match → the threshold short-circuit keeps it offline.)

- [ ] **Step 4: Commit**

```bash
git add tests/test_graph_eval.py
git commit -m "test(eval): offline graph-mode smoke proves CRAG lift on requires_web questions"
```

---

## Self-review (against the spec)

**Spec coverage (Plan 3 scope = §5.5 eval + §9 measurement plan):**
- §5.5 "graph-driven mode (`EVAL_USE_GRAPH=1`) drives `make_graph()`+`MemorySaver` with an auto-approver" → Tasks 3-4 (uses `build_graph(InMemorySaver())`, which also wires the Plan-2 serde; equivalent and slightly better than `make_graph` since it persists across the interrupt). ✅
- §5.5 "IR metrics + RAGAS read from final graph state (`reranked`, `answer`)" → Task 3 IR from `reranked`; RAGAS is left off in graph mode (the A/B is IR-focused; RAGAS stays available in the existing live mode). Documented. ✅ (If RAGAS-in-graph-mode is wanted, it's a small follow-up: build samples from `final_state["answer"]` + reranked contexts and call `run_ragas`.)
- §5.5 "`requires_web` golden questions + recorded web fixture (offline/deterministic); live mode on the runner uses real SearXNG" → Tasks 1-2 + the `EVAL_WEB_LIVE` env in Task 4. ✅
- §5.5 / §9 "A/B report: on vs off; `grade_distribution`, `fallback_fired`, lift on corrected questions" → Tasks 4-5. ✅

**Deferred:** the Evals UI "Corrective RAG impact" panel reads `results.json["crag"]` (Plan 4). RAGAS-in-graph-mode (optional follow-up). Enabling CRAG in prod after the lift is shown is an ops decision.

**Placeholder scan:** Task 6 step 3's CLI-smoke note flags the one environment-dependent behavior (whether the real grader stays offline on `requires_web` questions — it should, via the score short-circuit, since the local corpus yields a low top-1). Every code step has complete code.

**Type consistency:** `run_graph_eval(qa_pairs, corpus, k, *, enable_crag) -> list[row]` (Task 3) is consumed by `run_ab` (Task 4); `summarize_ab(off, on, k)` (Task 4) is rendered by `_print_table`'s `crag` block (Task 5) and asserted in tests. Row keys (`precision@{k}`, `grade`, `fallback_used`, `requires_web`) are consistent across `_row`, `summarize_ab`, and the report.

## Risks / decisions

- **`build_graph(InMemorySaver())` vs `make_graph()`:** the spec said `make_graph()`+`MemorySaver`, but `make_graph()` compiles WITHOUT a checkpointer and interrupts need one. `build_graph(checkpointer)` is the correct factory (it also applies the Plan-2 serde). Same topology; this is a faithful refinement.
- **Settings mutation across arms:** `run_graph_eval` sets `settings.enable_corrective_rag` per arm (build-time flag). `run_ab` runs off then on sequentially (not concurrently) so the shared singleton isn't raced. Documented; matches the single-process eval model.
- **Offline determinism:** the fixture keeps CI network-free; the stubbed-grader test path covers the wiring; the real-grader CLI smoke relies on the score short-circuit grading `requires_web` questions `incorrect` without an LLM. If a future corpus change makes a `requires_web` question score in the LLM band, the CLI smoke would need Ollama — keep those questions clearly unanswerable locally.

## Execution handoff

Subagent-driven, on `feat/corrective-rag-backend`. Suggested units: **(A)** Tasks 1-2 (fixture + golden questions), **(B)** Tasks 3-4 (graph-driver + auto-approver + A/B), **(C)** Tasks 5-6 (report + smoke + full green). After Plan 3: Plan 4 (frontend — the Evals panel reads `results.json["crag"]`), then Plan 5 (docs). Once the A/B shows a real lift, enabling CRAG in prod (`ENABLE_CORRECTIVE_RAG=true` on the Mac Mini) becomes a justified ops decision.
