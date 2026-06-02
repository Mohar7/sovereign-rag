# Corrective RAG (CRAG) with Human-Approved Web Fallback — Design Spec

- **Date:** 2026-06-02
- **Status:** Approved (design); Section 4 visuals pending Claude Design
- **Feature area:** Agentic RAG — self-correcting retrieval in the LangGraph control plane
- **Companion artifact:** [`docs/crag-hitl-design-prompt.md`](../../crag-hitl-design-prompt.md) (Claude Design prompt for all UI surfaces)

---

## 1. Summary

Make the QA graph **self-correcting**. After reranking, a **grade** step judges
whether the local sources are good enough to answer. When they aren't, the agent
rewrites the query, searches the web, and **pauses for human approval** of which
URLs to crawl — the human can **approve** (crawl selected URLs, re-retrieve,
answer) or **decline** (answer from local sources only). This adds a conditional
loop to today's linear graph, revives the human-in-the-loop (HITL) web-fallback
that the docs describe but the live code dropped, and is measurable in the eval
harness via an automated approver.

## 2. Background & current state

The README and `docs/architecture.md` advertise a graph with a conditional
`web_fallback` node and HITL `interrupt()`/`/ask/resume`. **The live code has
none of it** — a refactor (`agent/` → `graphs/rag_qa/`, plus a new `graphs/indexer/`)
left the QA graph linear:

```
START → retrieve_local → rerank → generate → END
```

Confirmed gaps the docs still claim but the code lost:
- No `grade`/`web_fallback` node, no `interrupt()`, no `/ask/resume`.
- `config.py` has **no** `web_fallback_min_chunks` (the README references `WEB_FALLBACK_MIN_CHUNKS`).
- The frontend `Ask` turn has only `pending | ok | error` — no approval state.

Building blocks that **do** still exist and are reused unchanged:
- `providers/reranker.py:rerank()` returns `RetrievedChunk` carrying the
  cross-encoder `score` (`source="reranked"`); `rerank_score_floor` /
  `adaptive_rerank` already threshold on it — the grader's signal is free.
- `ingestion/search.py:search()` → `[{title,url,content}]` and `search_and_crawl()`;
  `ingestion/web.py:crawl_url()`; `retrieval/pipeline.py:RAGPipeline.index_document()`.

This feature therefore makes the docs **true again** rather than inventing a new story.

## 3. Goals / non-goals

**Goals**
- A grading step that classifies local retrieval as Correct / Ambiguous / Incorrect.
- A corrective loop: rewrite → web-search → **HITL approve/decline** → crawl+index → re-retrieve.
- The corrective path is **measurable** (eval A/B: CRAG on vs off).
- Env-toggleable end to end (`enable_corrective_rag`), consistent with the project's "measure each layer" principle.
- Reconcile README / architecture / CLAUDE.md with reality.

**Non-goals (YAGNI for v1)**
- CRAG "knowledge refinement" (decompose-recompose into knowledge strips) — the reranker already filters; revisit later.
- Multi-turn conversational memory (separate, sequenced capability).
- Query decomposition / multi-query fan-out (separate capability).
- More than one correction round (`crag_max_corrections` defaults to 1).
- Autonomous (no-human) web fallback as a *product* path — the product is HITL-only; autonomy exists only as the eval auto-approver.

## 4. Key decisions (resolved forks)

| Fork | Decision | Why |
|---|---|---|
| Capability first | **CRAG self-correcting retrieval** | Highest-impact agentic pattern; revives dead HITL; measurable; lands in LangGraph (stated priority). |
| Grader mechanism | **Hybrid** — score thresholds, LLM only for the middle band | Cheap on easy/empty cases, smart on the uncertain ones; thresholds are sweepable in eval. |
| Corrective action | **HITL only** (always ask the human) | Matches the documented product behavior + screenshots; measurability preserved via an eval-side auto-approver, not a second product path. |
| Loop placement | **Extend the `rag_qa` graph** (not a subgraph, not API orchestration) | One source of truth; loop is visible/replayable in Studio; keeps agentic control inside LangGraph. |
| Human options | **Approve and Decline both first-class** | Per explicit requirement; decline is a normal outcome (answer local-only), not an error. |

## 5. Architecture

### 5.1 Graph topology (`graphs/rag_qa`)

```
START
  │
  ▼
retrieve_local  ◄─────────────────────────────────────┐  loop ≤ crag_max_corrections
  │  Milvus hybrid + Neo4j local-search, deduped       │  (default 1)
  ▼                                                    │
rerank          cross-encoder → reranked top-k (+score)│
  │                                                    │
  ▼                                                    │
grade           HYBRID: score thresholds, else LLM     │
  │                                                    │
  ├─ Correct ───────────────────────────► generate ─► END
  │                                                    │
  └─ Ambiguous / Incorrect  (attempts < max)           │
        │                                              │
        ▼                                              │
   transform_query   light-tier LLM → web search query │
        │                                              │
        ▼                                              │
   web_search    SearXNG → candidate_urls; interrupt() │
        │                                              │
        ▼   resume(approved_urls)                      │
   ┌────┴─────────────────────────┐                    │
   │ APPROVE (urls non-empty)      │ DECLINE (urls==[]) │
   ▼                               ▼                    │
   crawl_index → index_document    generate(local)─►END │
   attempts++  ───────────────────────────────────────┘

  attempts == max & still weak ──grade routes──► generate (answers with what it has)
```

**Nodes**

| Node | Status | Responsibility |
|---|---|---|
| `retrieve_local` | unchanged | Milvus hybrid + Neo4j, dedup → `candidates` |
| `rerank` (`do_rerank`) | unchanged | cross-encoder → `reranked` top-k (carries score) |
| `grade` | **new** | Hybrid grader → `grade` + `grade_confidence` + `grade_reason` (§5.2) |
| `transform_query` | **new** | light-tier LLM rewrites question → keyword `search_query` |
| `web_search` | **new** | `search(search_query, max_results=web_fallback_max_urls)` → `candidate_urls`; `interrupt()` |
| `crawl_index` | **new** | approve → `crawl_url` each `approved_url` → `index_document` → `correction_attempts++`; decline → no-op + flags |
| `generate` | minor | unchanged answer path; appends a low-confidence note when corrections were exhausted or declined |

**Routing.** `route_after_grade(state)`: `correct → generate`; `(ambiguous│incorrect) and correction_attempts < crag_max_corrections → transform_query`; else `→ generate`. After `crawl_index`: `approved non-empty → retrieve_local` (loop); `declined → generate`.

**Label semantics.** Ambiguous and Incorrect both route through the same HITL web loop (both need the web). The label drives only (a) the `transform_query` framing and (b) the UI explanation copy. On the second pass, `retrieve_local` now sees the newly-indexed web chunks and `rerank` re-sorts the **local+web union**, so the answer always uses the best reranked set regardless of label.

**Checkpointer.** Interrupts require a checkpointer — already satisfied: prod `build_graph(AsyncPostgresSaver)`, `langgraph dev`/Studio in-memory, eval `MemorySaver`. `make_graph()` stays checkpointer-less for callers that supply their own.

### 5.2 Hybrid grader (`retrieval/grading.py`, pure & unit-testable)

Operates on the **reranked** scores (calibrated cross-encoder signal),
sigmoid-normalized to `[0,1]` for stable, interpretable thresholds:

- `top1 ≥ crag_correct_threshold` (0.70) → **Correct** — skip the LLM, answer now.
- `top1 ≤ crag_incorrect_threshold` (0.30) → **Incorrect** — skip the LLM, correct via web.
- between → one **light-tier LLM** call reads the question + top-k snippets and returns `correct│ambiguous│incorrect` + a one-line reason.

No candidates (empty `reranked`) → Incorrect with confidence 0. This subsumes the
old `web_fallback_min_chunks` pre-gate (not reintroduced). The grader returns a
small dataclass `Grade(label, confidence, reason)`; the node writes it to state.

### 5.3 Interrupt, API, SSE, approve/decline (`api/ask`)

**`web_search` interrupt payload** → `{reason:"approve_urls", question, grade, candidate_urls:[{title,url,snippet}]}`. The resume value flows back via `Command(resume={"approved_urls":[...]})`.

**API**
- `POST /ask` — after `ainvoke`, detect the pending interrupt (via `aget_state(config)`); return `status:"interrupted"` with `interrupt:{reason, candidate_urls}` instead of an answer.
- `POST /ask/resume` **(revived)** — body `{thread_id, approved_urls:[]}`; resumes via `Command(resume=...)`; non-empty = approve, `[]` = **decline**. Returns the completed `AskResponse`.
- `POST /ask/resume/stream` **(new)** — SSE continuation so approval→answer still streams tokens.

**SSE (`/ask/stream` + resume/stream)** — add `grade│transform_query│web_search│crawl_index` to the tracked node set; emit `{type:"grade", label, confidence, reason}` on grade-done and `{type:"interrupt", reason, candidate_urls, thread_id}` at the interrupt (then close; client resumes via `/ask/resume/stream`).

Runs are recorded on **final** completion only (after resume), carrying the CRAG fields (§5.5). An interrupt is a pause, not a completed run.

### 5.4 Frontend (pending Claude Design mocks)

Visuals are out at Claude Design — see [`docs/crag-hitl-design-prompt.md`](../../crag-hitl-design-prompt.md). Surfaces and their port targets (decisions locked; only layout pending):

1. **Agentic pipeline strip** — extend `components/ask/pipeline-strip.tsx` `StageName` with the new nodes + a grade outcome chip + the loop-back rendering.
2. **HITL approval card** — new `components/ask/approval-card.tsx`: states `deciding` (approve **and** decline co-equal) / `crawling` / `partial-fail` / `declined`.
3. **`Ask.tsx`** — extend the `Turn` status union with `"awaiting_approval" | "crawling"`; wire `use-ask-stream.ts` to the `interrupt`/`grade` events + `/ask/resume/stream`.
4. **Provenance** — "↻ corrected via web" badge + web-kind citation icon (`citation-chip.tsx` / `sources-rail.tsx`).
5. **Settings** — "Corrective RAG" section (grade-band dual slider, max corrections, max urls, enable switch).
6. **Run History** — `grade` + `fallback` column + filter.
7. **Evals** — "Corrective RAG impact" panel (A/B deltas, grade distribution, fallback count).
8. **i18n** — EN/RU keys into `src/locales/{en,ru}.json`.

### 5.5 Eval, runs, observability

**Eval is the real work here** because `eval/evaluate.py` drives `RAGPipeline.retrieve()/answer()` directly and **never touches the graph** — so CRAG is invisible to it today.

- **Graph-driven mode** — `EVAL_USE_GRAPH=1` drives `make_graph()` + `MemorySaver`; an **auto-approver** resumes each interrupt with the top-`web_fallback_crawl_top_k` candidates (same grader + correction as the product, programmatic approver). IR metrics + RAGAS read from the final graph state (`reranked`, `citations`, `answer`).
- **Exercise the path deterministically** — add a few `requires_web:true` golden questions; back them with a **recorded web fixture** (canned SearXNG hits + canned crawled markdown) so CI stays offline/deterministic. A live mode on the self-hosted runner uses real SearXNG.
- **A/B report** — run `enable_corrective_rag` on vs off; `results.json` gains `grade_distribution`, `fallback_fired`, and precision/recall **lift on the corrected questions**.

**Runs schema** — lazy `ALTER TABLE runs ADD COLUMN IF NOT EXISTS`: `grade TEXT`, `grade_confidence REAL`, `fallback_used BOOL`, `decision TEXT`, `correction_attempts INT`. `record_run`/`list_runs` carry them.

## 6. Data contracts

**`RAGState` (new fields, all optional / `total=False`)**

| Field | Type | Notes |
|---|---|---|
| `grade` | `Literal["correct","ambiguous","incorrect"]` | grader output |
| `grade_confidence` | `float` | normalized 0..1 |
| `grade_reason` | `str` | one line, surfaced to UI |
| `correction_attempts` | `int` | loop guard |
| `search_query` | `str` | rewritten query |
| `candidate_urls` | `list[dict]` | `{title,url,snippet}` |
| `approved_urls` | `list[str]` | resume value; `[]` = decline |
| `web_ingested` | `int` | chunks indexed this correction |
| `fallback_used` | `bool` | web contributed to the answer |
| `declined` | `bool` | human declined the web search |

**API schemas (`api/ask/schemas.py`)** — `AskResponse` gains `status:"ok"|"interrupted"`, `interrupt: InterruptModel | None`, `fallback_used: bool`, `grade: GradeModel | None`. New: `InterruptModel{reason:Literal["approve_urls"], candidate_urls:[CandidateUrl{url,title,snippet}]}`, `ResumeRequest{thread_id, approved_urls:list[str]}`, `GradeModel{label, confidence, reason}`.

**SSE events** — `{type:"grade", label, confidence, reason}`; `{type:"interrupt", reason:"approve_urls", thread_id, candidate_urls}`; node events extended to the four new nodes.

## 7. Config knobs (`config.py`)

| Setting | Default | Purpose |
|---|---|---|
| `enable_corrective_rag` | `True` | master toggle; off → today's linear graph |
| `crag_correct_threshold` | `0.70` | ≥ → Correct (skip LLM) |
| `crag_incorrect_threshold` | `0.30` | ≤ → Incorrect (skip LLM); between → LLM grader |
| `crag_max_corrections` | `1` | corrective rounds before forcing generate |
| `crag_grader_tier` | `"light"` | LLM tier for the middle-band grader |
| `web_fallback_max_urls` | `5` | candidates surfaced for approval |
| `web_fallback_crawl_top_k` | `3` | eval auto-approver pick count |

All are honored end to end (unlike the existing accepted-but-ignored `fusion_strategy=weighted│borda`).

## 8. File-by-file change plan

**Backend**
- `config.py` — add the 7 knobs above.
- `retrieval/grading.py` — **new**: `Grade` dataclass + `grade_candidates(question, reranked, settings, llm)` (pure; LLM injected for testability).
- `graphs/rag_qa/state.py` — add the new `RAGState` fields.
- `graphs/rag_qa/nodes.py` — add `grade`, `transform_query`, `web_search` (with `interrupt`), `crawl_index`; minor `generate` note.
- `graphs/rag_qa/graph.py` — `_build_state_graph()` adds the nodes + `route_after_grade` conditional + the crawl_index→retrieve_local loop and decline→generate edge.
- `api/ask/schemas.py` — `status`/`interrupt`/`fallback_used`/`grade`; `InterruptModel`, `CandidateUrl`, `ResumeRequest`, `GradeModel`.
- `api/ask/router.py` — interrupt detection in `/ask`; `/ask/resume` + `/ask/resume/stream`; SSE `grade`/`interrupt` events; pass CRAG fields to `record_run`.
- `api/runs/service.py` — `ALTER TABLE` columns; extend `record_run`/`list_runs`.

**Eval**
- `eval/evaluate.py` — `EVAL_USE_GRAPH` graph-driven mode + auto-approver + A/B report fields.
- `eval/qa_pairs.json` — a few `requires_web:true` items.
- `eval/fixtures/web/` — **new**: recorded SearXNG hits + crawled markdown.

**Frontend** — per §5.4 (after mocks).

**Docs** — per §11.

## 9. Eval & measurement plan

- IR metrics (precision/recall/MRR/nDCG@k) + RAGAS read from final graph state, graph-driven mode.
- A/B: `enable_corrective_rag` on vs off over the golden set (incl. the `requires_web` items).
- Report adds `grade_distribution`, `fallback_fired`, and lift on corrected questions; surfaced in the Evals "Corrective RAG impact" panel.
- CI: deterministic via the recorded web fixture; self-hosted runner may run a live variant.

## 10. Testing plan

- **Unit** — grader thresholds + LLM-band (mocked LLM): correct/ambiguous/incorrect boundaries + empty-candidates; `route_after_grade`; `web_search` interrupt payload shape; `crawl_index` approve-vs-decline routing; loop guard at `crag_max_corrections`.
- **API** — `/ask` returns `interrupted` shape; `/ask/resume` approve → completes with `fallback_used=True`; `/ask/resume` decline (`[]`) → answers local-only, `declined=True`; SSE emits `grade` + `interrupt`.
- **Integration (gated `RUN_*_IT=1`)** — real services: thin-corpus question → grade weak → resume approve → improved answer; runs row carries CRAG fields.
- **Eval** — graph-driven harness over the web fixture produces the A/B report.
- **Frontend** — approval card approve/decline interactions; pipeline-strip loop render; provenance badge.

## 11. Docs reconciliation

- `README.md` + `docs/architecture.md` — show the `grade` node + corrective loop; restore the `/ask/resume` examples; document the new config knobs; the Mermaid/ASCII diagrams gain `grade` and the loop-back.
- `CLAUDE.md` — fix stale `src/sovereign_rag/agent/` references → `graphs/rag_qa/` (+ note `graphs/indexer/`); update the graph entry-point description.
- `docs/ui-design-brief.md` §7 — align the interrupt data shape with the implemented `AskResponse`/`ResumeRequest`.

## 12. Rollout / sequencing

1. Backend graph + grader + config (Sections 1–2) behind `enable_corrective_rag`.
2. API interrupt + resume + SSE (Section 3).
3. Eval graph-mode + fixture + A/B (Section 5 backend); prove lift.
4. Runs schema + History/Evals data.
5. Frontend (Section 4) once mocks return.
6. Docs reconciliation.

Each step is independently shippable; `enable_corrective_rag=False` keeps prod on today's linear graph until the loop is proven.

## 13. Open questions / risks

- **Score calibration** — gte-reranker logits aren't centered; the sigmoid + default thresholds (0.70/0.30) need a quick empirical sweep on the golden set to land sane defaults.
- **Crawl latency in HITL** — crawling several URLs can take seconds; the `crawling` UI state + per-URL progress (and partial-fail handling) must keep the wait legible.
- **Fixture drift** — recorded web fixtures can rot; keep them tiny and regenerate from the live runner periodically.

## 14. Decision log

- Direction: **Agentic RAG** → capability: **CRAG self-correcting retrieval**.
- Grader: **Hybrid** (thresholds + LLM middle band) on normalized rerank scores.
- Correction: **HITL only**; eval uses a programmatic auto-approver (same graph, different approver).
- Placement: **extend `rag_qa`**, grader as a shared pure function.
- Human options: **approve and decline both first-class**; decline = answer local-only.
