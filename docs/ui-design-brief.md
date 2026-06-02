# sovereign-rag — Web UI Design Brief

A complete brief for designing the front-end on top of the sovereign-rag
back-end. Self-contained: a designer can produce final mocks from this
document without reading the codebase.

---

## 1. What this product is

**sovereign-rag** is a self-hosted **GraphRAG** system. You feed it documents
(PDF, web pages, raw text, web-search results), it indexes them across a
vector DB and a knowledge graph, then answers your questions with **inline
citations** back to the exact chunks it used.

What sets it apart from a generic ChatGPT-over-PDFs:

- **Hybrid retrieval** — dense embeddings **plus** keyword (BM25), fused by
  Reciprocal Rank Fusion, so exact tokens (codes, names, identifiers) aren't
  lost.
- **Knowledge graph** — every document yields entities and relations; the
  retriever traverses them for multi-hop questions vector search can't reach.
- **Cross-encoder reranking** — the top-50 retrieved chunks are re-scored by a
  multilingual cross-encoder before they reach the LLM.
- **Human-in-the-loop web fallback** — when the local corpus is thin on a
  question, the system searches the web, **pauses for your approval** on which
  URLs to crawl, then continues with the new evidence.
- **Stateful threads** — every conversation is checkpointed; you can close the
  tab, come back tomorrow, and resume from the same step (including pending
  approvals).

The back-end is already done and battle-tested. **This brief is for the UI on
top of it.**

---

## 2. Why a UI

Today the system is reachable only through `curl` against a FastAPI
service and the LangGraph Studio dev tool. That works for an engineer
debugging the retrieval graph; it doesn't work for:

- A researcher who wants to drop a PDF in and ask questions about it.
- A reviewer (recruiter / lead) who wants to *see* the system work in
  60 seconds without setting up Docker.
- The author (Muhriddin) wanting a public-facing demo to pin on his
  portfolio and link from his resume.

The UI's job is to turn the FastAPI surface into a **product** —
something a non-engineer can use in a browser, that looks like a
deliberate piece of work, not a Swagger page.

---

## 3. Users & jobs-to-be-done

Two roles, both on the **same UI** (no admin/user split):

### 3.1 Researcher (primary)

Comes with a question and some sources. Wants:

1. **Drop a source in** — a PDF, a URL, a search query, or pasted text — and
   wait briefly while the system indexes it.
2. **Ask** the system a question over what's been indexed.
3. **See where the answer came from** — click a citation, see the chunk, see
   the document, see the score.
4. **Approve a web search** when local sources don't suffice, instead of
   getting a "I don't know" or a hallucination.
5. **Come back to a past thread** and continue it.

### 3.2 Power user / author of the system

Same flows, plus:

1. **Inspect the corpus** — what's been indexed, when, how many chunks.
2. **Inspect a single retrieval** — which chunks Milvus returned, which the
   graph returned, what the reranker did to the order.
3. **Toggle knobs** — enable/disable graph retrieval, enable/disable
   contextual prefixing, change rerank top-k, swap the LLM.

---

## 4. Information architecture

Five top-level destinations, left rail or top tabs:

| # | Section | What it's for |
|---|---|---|
| 1 | **Ask**       | The default landing. Question input + live answer + citations. |
| 2 | **Library**   | Browse indexed documents; open one, see its chunks, see its entities. |
| 3 | **Ingest**    | Add new sources. Three tabs: **File** / **URL** / **Web search**. |
| 4 | **Threads**   | Past conversations. Resume one, fork one, delete one. |
| 5 | **Settings**  | Model picker, retrieval knobs, runtime status (health of Milvus / Neo4j / Postgres / SearXNG / Ollama). |

Optional / advanced (behind a "Show advanced" toggle in **Settings**):

- **Graph** — a small graph visualization of the Neo4j entity store.
- **Retrieval inspector** — the per-question debug panel (Milvus vs graph
  candidates, rerank deltas, fallback fired?).

---

## 5. Screens — detailed

### 5.1 Ask (the centerpiece)

#### Layout

Three-column when wide, single-column on narrow:

```
┌──────────────┬───────────────────────────────────────────┬───────────────┐
│              │                                           │               │
│  Threads     │  Conversation                             │  Sources      │
│  (rail)      │                                           │  (rail)       │
│              │                                           │               │
│  • thread A  │  You: Which protocols mention RRF?        │  [1] Milvus   │
│  • thread B  │                                           │      docs.md  │
│  • thread C  │  sovereign: Reciprocal Rank Fusion is     │      page 4   │
│              │             implemented in Milvus 2.6's   │      0.99     │
│              │             native hybrid_search [1][2]   │               │
│  + new       │             — it combines dense ANN with  │  [2] paper.pdf│
│              │             native BM25 ranks. [3]        │      page 12  │
│              │                                           │      0.96     │
│              │  ┌─ Ask anything ─────────────────────┐  │  [3] crawl … │
│              │  │ Type your question here…          │  │               │
│              │  └─────────────────────────────────┬──┘  │               │
│              │                                    │     │               │
└──────────────┴────────────────────────────────────┴─────┴───────────────┘
```

#### Behaviour

1. **Input** — single text field, send on `Enter`, `Shift+Enter` for newline.
   Send button is a subtle icon (paper-plane / arrow-up). No model picker
   here — that's in Settings; the active model is shown as a small chip near
   the send button (e.g. `kimi-k2.6 ▾`).
2. **Streaming** — answers are streamed token by token (SSE). The citation
   chips `[1] [2]` appear inline as the LLM writes them. They're styled as
   small **rounded chips** with numeric label, not as raw `[1]`.
3. **Citation chips**:
   - Hover → tooltip with chunk title + first 120 chars.
   - Click → opens (or scrolls to) the corresponding card in the **Sources**
     right rail. The card highlights briefly.
4. **Sources rail (right)** — one card per cited chunk, in citation order:
   - Citation number badge.
   - Document **title**.
   - Source **uri** (truncated, with a copy button).
   - **Score** — rendered as a tiny bar (0–1).
   - First ~240 chars of the chunk text (the `snippet`).
   - "Open document" link → goes to Library entry.
5. **Threads rail (left)** — past Q&A threads. The active one is highlighted.
   `+ new` mints a new `thread_id`. Threads remember their full state via
   the Postgres checkpointer.

#### Special state: **Human-in-the-loop interrupt**

When the question doesn't have enough local support, the server returns
`status: "interrupted"` with a list of `candidate_urls`. The UI must render
this **inline in the conversation** as an **approval card**:

```
┌─ Need more sources? ───────────────────────────────────────┐
│ I couldn't find enough about "FERRET activation codeword" │
│ in your indexed sources. I can search the web and ingest   │
│ the pages you approve below.                               │
│                                                            │
│ ☐  1Password — Secret Key                                  │
│    https://support.1password.com/secret-key/               │
│                                                            │
│ ☑  Anthropic — Activation passes                           │
│    https://anthropic.com/research/activations              │
│                                                            │
│ ☐  Reddit thread (unverified)                              │
│    https://reddit.com/r/.../comments/.../                  │
│                                                            │
│  [ Skip ]                       [ Crawl & continue → ]    │
└────────────────────────────────────────────────────────────┘
```

- Each row has the URL, the page title (from SearXNG result), and a
  snippet. User toggles checkboxes.
- "**Crawl & continue**" → calls `POST /ask/resume` with the checked
  URLs.
- "**Skip**" → calls `POST /ask/resume` with `approved_urls: []` (the
  server then answers from the local corpus only, or says it doesn't
  know).
- While crawling, replace the card with a small **progress strip** ("crawl-
  ing 2 of 3…  reranking… answering…").

#### Empty / error states

- **No conversation yet** — friendly empty state: "Drop a PDF into Ingest,
  or ask something general." with shortcut buttons.
- **Pipeline not initialised** — server returns 503; show a banner: "Back-
  end starting — Milvus is warming up" with a retry button.
- **Crawl failed** — inline error in the approval card: "1 of 2 URLs
  failed to crawl. Answer was generated from the rest."

---

### 5.2 Library

A grid (default) or list (toggle) of indexed documents.

Each **document card** shows:

- Icon by source type (📄 PDF / 🌐 web / 📝 text / 🔍 search-result).
- **Title** (1–2 lines, truncated).
- **Source URI** (small, monospace, truncated).
- **Chunks indexed** badge (e.g. "23 chunks").
- **Indexed at** (relative time — "5 min ago").
- A subtle "delete" action behind a hover-menu.

Click a card → **document detail panel** slides in from the right:

- Full source URI, copy button.
- All chunks listed (collapsible accordions), each with:
  - position in document
  - first 200 chars
  - links to "find similar chunks" and "view in graph"
- **Entities** extracted from this document, grouped by type
  (`Person`, `Organization`, `Concept`, …) — chips.
- **Related documents** — other documents that share entities with this
  one (via the Neo4j graph).

Filters at the top: source type, indexed-after date, full-text search of
titles.

---

### 5.3 Ingest

Three tabs across the top:

```
┌─ File ─┐  ┌─ URL ─┐  ┌─ Web search ─┐
```

#### Tab: File

- Drag-and-drop zone (full-width, dashed border).
- File-picker fallback button.
- After upload: a progress strip with **four stages**:

```
parsing  →  chunking  →  contextualising  →  indexing
  ●            ●               ◔                ○
```

- Stage timings update live. On done, navigates to the Library entry
  for the new document (or shows a "View in Library" success toast).

#### Tab: URL

- Single input: `https://…`
- "Crawl & index" button.
- Same progress strip as File.

#### Tab: Web search

- Search query input.
- `max_results` slider (1–10).
- Hit "Search" → renders the SearXNG hits as a checklist (same UX as the
  HITL approval card), user picks which to index.
- "Crawl & index selected" → progress strip per URL, plus an overall counter.

---

### 5.4 Threads

A list view of conversations. Each row:

- Thread title (auto-derived from first question; user-editable).
- Last activity (relative time).
- Count of questions in the thread.
- Status badge if the thread is **paused at an interrupt** — coloured chip
  saying "needs your approval".
- Click → opens that thread in **Ask**.

Bulk-select + delete. Search by title or full-text-of-questions.

---

### 5.5 Settings

Single page, sectioned:

#### Models

- **LLM** — dropdown of available Ollama Cloud models (`kimi-k2.6`,
  `kimi-k2.5`, `kimi-k2-thinking`, `kimi-k2:1t`, `deepseek-v4-pro`).
  Shown with their context-window and "is selected" indicator.
- **Embeddings** — radio: `bge-m3 (local)` / `text-embedding-3-large
  (OpenAI, 3072-d)`.
- **Reranker** — text field for HF model id (default
  `BAAI/bge-reranker-v2-m3`). Device: `auto | mps | cuda | cpu` radio.

#### Retrieval knobs

- `retrieve_top_k` (slider, 10–200, default 50).
- `rerank_top_k` (slider, 1–20, default 5).
- `web_fallback_min_chunks` (slider, 0–20, default 3 — "0 disables web
  fallback").
- `web_fallback_max_urls` (slider, 1–10, default 3).
- Toggles: `enable_graph_retrieval`, `enable_contextual_retrieval`.

#### Runtime health

Six pill-shaped status indicators in a row, polled every 5 s:

```
  ●  Milvus       ●  Neo4j       ●  Postgres
  ●  SearXNG      ●  Ollama      ●  OpenAI
```

Green = healthy, amber = degraded, red = unreachable. Click a pill → small
diagnostic popover (last-checked-at, response time, endpoint URL).

#### Advanced (collapsed by default)

- Open the LangGraph Studio link (`http://localhost:2024`) in a new tab.
- "Show retrieval inspector after every answer" toggle.
- Wipe-everything button (with double confirm).

---

### 5.6 Retrieval inspector (advanced)

A side panel toggleable from the Ask screen header. Shows, per answer:

- **Question** + **detected entities** (chip row).
- **Milvus candidates** (top 10), each with dense score / BM25 score / fused
  RRF score.
- **Graph candidates** (top 10), each with vector-seed score and the entity
  facts that came along.
- **Post-dedup** list (the union).
- **Post-rerank top-5** — these are what reached the LLM. Cross-encoder
  score on each.
- A delta indicator showing position movement (e.g. "↑3" if rerank promoted
  a chunk three positions).

---

## 6. Component inventory

The designer will reuse these across screens. Each gets one spec card:

1. **CitationChip** — small numeric pill with hover preview + click to open
   side rail.
2. **SourceCard** — the right-rail item with title / uri / score / snippet.
3. **ApprovalCard** — the HITL inline card with URL checkboxes.
4. **IngestProgressStrip** — four-stage horizontal stepper with timings.
5. **HealthPill** — coloured pill with service name + last-checked time.
6. **ScoreBar** — tiny horizontal bar 0–1, used in lots of places.
7. **ChunkAccordion** — expandable chunk preview with copy / open-in-graph.
8. **ThreadRow** — row in the threads list.
9. **DocumentCard** — card in the Library grid.
10. **ModelChip** — current-model indicator near the input, expands to picker.
11. **KnobRow** — slider + label + value + reset-to-default button.
12. **EntityChip** — small pill per extracted entity, coloured by type.

---

## 7. Data shapes (the UI consumes these)

```ts
// /ask response — status "ok" (completed) or "interrupted" (CRAG paused)
type AskResponse = {
  thread_id: string;
  status: "ok" | "interrupted";
  answer: string | null;     // null when status === "interrupted"
  citations: Citation[];
  retrieved: number;         // candidates before rerank
  used: number;              // citations actually surfaced
  fallback_used: boolean;    // did web fallback fire & contribute?
  grade: GradeModel | null;  // set on both ok and interrupted (when CRAG ran)
  interrupt: InterruptModel | null; // set when status === "interrupted"
};

type GradeModel = {
  label: "correct" | "ambiguous" | "incorrect";
  confidence: number;        // 0..1 sigmoid-normalized top-1 reranker score
  reason: string;            // one-line explanation surfaced to the UI
};

type InterruptModel = {
  reason: "approve_urls";    // stable enum
  candidate_urls: CandidateUrl[];
};

type CandidateUrl = {
  url: string;
  title: string;
  snippet: string;
  verified?: boolean | null; // optional trust hint; null/undefined = unknown;
                             // false = render "unverified" badge (e.g. reddit.com)
};

type Citation = {
  chunk_id: string;
  doc_id: string;
  title: string;
  source_uri: string;
  page: number | null;
  score: number;             // 0..1 — reranker score
  snippet: string;           // first ~240 chars of chunk.raw_text
};

// /ask/resume body — non-empty approved_urls = approve (crawl); [] = decline
type ResumeRequest = {
  thread_id: string;
  approved_urls: string[];   // [] = decline (answer from local corpus only)
};

// Document Library entry
type Document = {
  doc_id: string;
  title: string;
  source_uri: string;
  source_type: "pdf" | "docx" | "web" | "search" | "text";
  chunks_indexed: number;
  indexed_at: string;        // ISO-8601
};

type Chunk = {
  chunk_id: string;
  doc_id: string;
  position: number;
  page: number | null;
  text: string;              // contextualised (with the prefix prepended)
  raw_text: string;          // original — what we show humans
};

type Entity = {
  id: string;
  name: string;
  type: "Person" | "Organization" | "Concept" | "Location" | "Other";
  description: string;
  mentions_count: number;
};

type Thread = {
  thread_id: string;
  title: string;             // auto from first question, user-editable
  last_activity: string;     // ISO-8601
  question_count: number;
  paused_at_interrupt: boolean;
};
```

---

## 8. API the UI will call

Already implemented on the back-end:

| Method | Path                  | Purpose                                       |
|--------|-----------------------|-----------------------------------------------|
| POST   | `/documents/text`     | Ingest raw text. Body: `{title, text, source_uri?}`. |
| POST   | `/documents/file`     | Multipart file upload (PDF / DOCX → Docling). |
| POST   | `/documents/url`      | Crawl a single URL. Body: `{url}`.            |
| POST   | `/ingest/search`      | Web search + crawl top-N. Body: `{query, max_results}`. |
| POST   | `/ask`                | Run the QA graph. Body: `{question, doc_id?, thread_id?}`. May return an HITL interrupt. |
| POST   | `/ask/resume`         | Resume a paused thread. Body: `{thread_id, approved_urls}`. |
| GET    | `/health`             | Liveness probe.                               |

To be added for the UI (designer can assume they exist):

| Method | Path                          | Purpose                                  |
|--------|-------------------------------|------------------------------------------|
| GET    | `/documents`                  | List documents (paginated). Filters: source_type, indexed_after, q (title search). |
| GET    | `/documents/{doc_id}`         | Document detail + chunks + entities.     |
| DELETE | `/documents/{doc_id}`         | Remove document (and its chunks / nodes). |
| GET    | `/threads`                    | List threads (paginated).                |
| GET    | `/threads/{thread_id}`        | Full conversation + state.               |
| DELETE | `/threads/{thread_id}`        | Delete thread + checkpoint.              |
| PATCH  | `/threads/{thread_id}`        | Rename, etc.                             |
| GET    | `/health/detailed`            | Per-service status, response times.      |
| GET    | `/entities?doc_id=…`          | List entities for a document.            |
| GET    | `/graph?entity_id=…&hops=1`   | 1-hop neighbourhood for graph view.      |
| GET    | `/settings`                   | Current retrieval knobs / model.         |
| PATCH  | `/settings`                   | Update knobs / model (rest of session).  |
| GET    | `/ask/{thread_id}/stream`     | Server-Sent Events stream of intermediate state. |

---

## 9. Streaming & async patterns the design must accommodate

1. **Streaming answer tokens.** The Ask screen streams the LLM output via SSE.
   The citation chips arrive embedded in the stream — design for the chip
   appearing as the cursor reaches `[1]`, not at end-of-stream.
2. **Async ingest.** File upload returns immediately with a `doc_id`; the UI
   polls (or subscribes) for stage transitions: `parsing → chunking →
   contextualising → indexing → done`. Total time varies from ~2 s
   (raw text) to ~5 min (a 50-page PDF with contextual prefixing).
3. **HITL pause.** A `/ask` call can return `status: "interrupted"` after
   seconds, not done — the conversation is **paused**, not failed. The
   design needs a state visually distinct from "loading" and from "done".
4. **Interrupted threads outlive the tab.** Postgres checkpoint = if the
   user closes the browser at the approval step and comes back the next day,
   the thread is still in **Threads** list with the "needs your approval"
   badge.
5. **Cancellation.** The user should be able to stop a streaming answer
   mid-flight — a Stop button replaces Send while streaming.

---

## 10. Visual direction

### Tone

**Sovereign, calm, precise.** This is not a friendly chat-bot —
this is an instrument. Think *Linear / Anthropic Console / Notion AI* over
*Discord / Replika*.

### Mode

**Dark-first.** A light theme is welcome but the marketing screenshots will
be dark. Both modes should feel deliberate, not one inverted from the other.

### Palette (suggestion — designer can adapt)

| Use | Dark mode | Light mode |
|---|---|---|
| Background    | `#0a0a0c` (near-black, slight cool tint)   | `#fafafa` |
| Surface       | `#141418`                                  | `#ffffff` |
| Border        | `#26262d`                                  | `#e4e4e7` |
| Text primary  | `#f5f5f7`                                  | `#0a0a0c` |
| Text muted    | `#8a8a92`                                  | `#71717a` |
| Accent (graph) | `#7aa2f7` (cool blue)                     | `#3b82f6` |
| Accent (vector) | `#bb9af7` (lavender)                     | `#7c3aed` |
| Accent (success / health green) | `#9ece6a`              | `#16a34a` |
| Accent (warning / amber)        | `#e0af68`              | `#d97706` |
| Accent (HITL human)             | `#ff9e64` (warm orange) | `#ea580c` |

The "sovereign" identity comes from the **two accent colours** (blue for
graph, lavender for vector) appearing together in citations / source cards
to imply the hybrid nature of the retrieval — small visual signature.

### Typography

- **UI text** — Inter or IBM Plex Sans (whichever you have rights to).
- **Code & chunk text** — JetBrains Mono / IBM Plex Mono. Chunks are rendered
  in a slightly smaller mono so they read as "source material".
- **Numbers in score badges & citations** — tabular figures.
- **No headings inside chat answers** — the LLM output is rendered as
  paragraphs + lists + code blocks; suppress h1/h2 styling unless the answer
  is long enough to warrant.

### Iconography

Lucide or Phosphor. Outline icons, 1.5px stroke, consistent across the app.

### Motion

Sparing. **Citation chip pop-in** as the LLM streams it (subtle scale 0.95 →
1, 120 ms). **Approval card slide-in** from below the latest assistant
message. **Ingest progress stages** crossfade as each completes. No
gratuitous animations.

### Density

Comfortable on desktop, compact on mobile. The Ask screen specifically is
**desktop-first** — the three-column layout is the headline; mobile collapses
to a single column with the sources rail behind a chevron.

---

## 11. Tech stack (suggestion — non-binding)

- **Framework** — Next.js 15 (App Router) or Vite + React 19. Either is fine;
  Next gives easier SSR/SEO for the marketing-friendly /demo page, Vite gives
  a faster dev loop.
- **Styling** — Tailwind CSS 4 + **shadcn/ui** components as the base. Brand
  on top.
- **State / data fetching** — TanStack Query for REST endpoints, **EventSource**
  for the SSE streaming answer, **React Hook Form** for forms.
- **Markdown rendering** — `react-markdown` with `remark-gfm` and a custom
  renderer for the `[n]` citation tokens that turn into `CitationChip`
  components.
- **Code block highlighting** — `shiki` (server-rendered, no runtime JS).
- **Charts (for retrieval inspector)** — `visx` or `recharts`. Sparingly.

---

## 12. Non-functional requirements

- **Accessibility.** Keyboard-navigable end-to-end (the Ask screen is
  often used hands-on-keyboard). Citation chips reachable via Tab; their
  associated source card focuses on activation. Colour contrast AA in both
  themes. `prefers-reduced-motion` respected.
- **Latency budget.** First-token-after-Send should *feel* under 1 s on a
  warm pipeline. The streaming UI shouldn't wait for full completion to
  begin rendering.
- **Error surfaces.** Every failure shows a contextual message — not a
  toast that disappears. Network errors retry-with-backoff once, then
  surface a Retry button.
- **Offline tolerance.** If the back-end is unreachable, the UI shows the
  last-known thread (cached locally) read-only, with a banner. The Ingest
  and Ask actions are disabled with explanatory tooltips.
- **No telemetry without consent.** This is a "sovereign" product —
  outbound analytics are off by default; if added, opt-in toggle in Settings.

---

## 13. Out of scope (do not design these now)

- Multi-user accounts / login / RBAC. Single-tenant.
- Real-time collaboration in a thread.
- Mobile-native app. The web UI must be responsive, but no Swift/Kotlin.
- Anything that changes the back-end's retrieval algorithm. (Knobs exist for
  the existing dials only; designing a new retrieval strategy is out.)
- Marketing/landing page. (Separate brief if needed.)
- Billing / paywalls.

---

## 14. Sample data for mocks

Use this content in design mockups (it matches what the running system
actually produces, so the screenshots will look real):

**Sample question (Ask):**

> "How does Milvus 2.6's hybrid search combine dense vectors and BM25?"

**Sample assistant answer:**

> Milvus 2.6 implements hybrid search by issuing a dense ANN search and a
> sparse BM25 search **server-side in the same `hybrid_search` call**, then
> fusing their result lists with Reciprocal Rank Fusion (RRF) [1]. The RRF
> constant defaults to 60, which controls how much weight low-ranked
> candidates retain in the fused list [2]. Because BM25 is computed natively
> over the same collection, you avoid maintaining a separate sparse index
> alongside Milvus [1][3].

**Sample citations** for that answer:

```jsonc
[
  { "chunk_id": "0f69e9bf-…", "doc_id": "milvus-docs",
    "title": "Milvus 2.6 — Hybrid Search",
    "source_uri": "https://milvus.io/docs/hybrid-search.md",
    "page": null, "score": 0.992,
    "snippet": "Milvus 2.6 introduces native BM25 as a built-in function on text fields. A single hybrid_search call …" },
  { "chunk_id": "595deda9-…", "doc_id": "rrf-paper",
    "title": "Reciprocal Rank Fusion outperforms Condorcet…",
    "source_uri": "corpus://rrf-paper.pdf",
    "page": 3, "score": 0.961,
    "snippet": "The RRF score for a document d under rankings R is the sum over r ∈ R of 1 / (k + r(d)). The constant k is …" },
  { "chunk_id": "f8a3b…",     "doc_id": "internal-notes",
    "title": "Hybrid Retrieval — sovereign-rag internal notes",
    "source_uri": "smoke://notes",
    "page": null, "score": 0.847,
    "snippet": "We chose Milvus's native hybrid over a Pinecone-side BM25 because the second index would double our ingest cost …" }
]
```

**Sample candidate URLs (HITL approval card):**

```jsonc
[
  { "url": "https://milvus.io/docs/hybrid-search.md",
    "title": "Milvus 2.6 — Hybrid Search documentation",
    "snippet": "Combines dense ANN and BM25 in one call …" },
  { "url": "https://arxiv.org/abs/2009.11352",
    "title": "Reciprocal Rank Fusion (Cormack et al.)",
    "snippet": "RRF as a parameter-free rank fusion method …" }
]
```

**Sample threads sidebar (4 rows):**

1. *Milvus hybrid search* — 3 questions — 2 min ago — active.
2. *Why use a graph index?* — 7 questions — yesterday.
3. *FERRET activation codeword* — 1 question — **needs your approval**.
4. *Random LangGraph notes* — 12 questions — 4 days ago.

---

## 15. Deliverables expected from the designer

1. **Hi-fi mocks** of the five top-level screens (Ask, Library, Ingest,
   Threads, Settings) in **dark mode** at the **desktop breakpoint**
   (1440×900).
2. **Ask screen variants** — empty state, mid-stream, HITL interrupt,
   error.
3. **Component sheet** — every component from §6, in default / hover /
   focus / disabled / active states.
4. **Mobile breakpoint** (390×844) for at least Ask, Library, Ingest.
5. **Light-mode** version of just the Ask screen (so the brand survives in
   both modes).
6. **Brand assets** — wordmark, app icon (favicon + 1024×1024 PNG).

Out of scope for the designer: developer hand-off tokens, exported icons
(the implementer will wire shadcn + lucide). The mocks just need to be
*specific enough* to implement against.
