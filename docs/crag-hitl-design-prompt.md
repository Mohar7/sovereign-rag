# sovereign-rag — Corrective RAG + HITL web-fallback UI (Claude Design prompt)

Paste the block below into a fresh `claude.ai/design` thread. **Attach the live
screenshots** as visual anchors so the output matches the shipped app rather than
generic shadcn:

- `docs/screenshots/ui-ask.png` and `docs/screenshots/ui-ask-dark.png` (Ask)
- `docs/screenshots/ui-evals.png` (Evals) and `docs/screenshots/live-real-data.png`
- `docs/screenshots/04-hitl.png` — the **pre-refactor** approval card. Useful as
  *prior art only*; it is in the discarded "terminal" aesthetic — do not copy it.

Unlike `frontend-redesign-prompt.md` (which wanted a clean canvas), this prompt
adds a feature **into the existing design system** — so it says *match, don't
reinvent*. This is the full prompt covering every UI surface the CRAG feature
touches (Ask pipeline strip, HITL approval card with approve **and** decline,
answer provenance, Threads badge, Settings, Run History, Evals impact).

---

```
Design ONE feature into an EXISTING, shipped product — sovereign-rag. This is
NOT a redesign. Match the current design system exactly; invent nothing new
visually. I'm attaching screenshots of the live app (light + dark Ask, Evals,
History) — treat them as ground truth and make these new surfaces look like they
were always part of it.

=== THE PRODUCT (context) ===

sovereign-rag is a self-hosted GraphRAG system: ask questions over an indexed
corpus, get answers with inline numbered citations back to source chunks.
Single-user, no auth. "Ask" is a chat: conversation center, a Sources rail
right, a composer pinned bottom. Each answer shows a horizontal "pipeline strip"
of retrieval stages with per-stage timings. There are also Evals and Run-History
pages (stat cards + tables).

=== THE FEATURE: Corrective RAG (CRAG) with human-approved web fallback ===

Today the pipeline is linear: retrieve → rerank → generate. We're making it
SELF-CORRECTING. After reranking, a "grade" step judges the local sources:
  • CORRECT   → answer now (the common path; strip ≈ today + a green grade chip)
  • AMBIGUOUS → sources thin/uncertain
  • INCORRECT → sources don't cover the question
On AMBIGUOUS/INCORRECT the agent rewrites the query, searches the web, and
PAUSES — the human decides which result URLs to crawl. The human can APPROVE
(crawl the selected URLs, then re-retrieve and answer) or DECLINE (crawl
nothing, answer from local sources only). Full corrective path:

  retrieve → rerank → grade → rewrite → web-search → [HUMAN: APPROVE ⟶ crawl+index
           → retrieve(2) → rerank(2) → generate]  or  [DECLINE ⟶ generate(local)]

Two emotional beats to nail:
  (1) "the system noticed its own sources were weak and is correcting itself" —
      the grade outcome + the loop-back must be legible at a glance.
  (2) "the human is in control of the open web" — approving AND declining are
      BOTH first-class, equally easy, never a guilt-trip.

=== LOCKED STACK & AESTHETIC — match the live app ===

- shadcn/ui "new-york" (Radix + Tailwind). Use ONLY existing shadcn components:
  Card, Button, Checkbox, Badge, Alert, Progress, Tooltip, Popover, Skeleton,
  Switch, Slider, Separator, ScrollArea, Sheet, Table, Tabs, Sonner. Annotate
  each artboard with the components it uses.
- Type: Inter (UI), JetBrains Mono (IDs / scores / URLs / timings).
- Color: ONE brand accent (indigo) over a zinc neutral ramp. Retrieval KIND is
  shown by ICON, never color (graph / vector / web each a lucide icon). Reserve
  color ONLY for grade semantics: success=green Correct, warning=amber
  Ambiguous, destructive=red Incorrect. Charts reuse the app's chart tokens.
- Motion: sparing. Approval card slides in under the latest answer; grade chip
  pops in (scale 0.95→1, ~120ms). Respect prefers-reduced-motion.
- Tone: calm, precise instrument — Linear / Vercel / Cal.com. Not a chatty bot.

=== SURFACES TO DESIGN ===

★ = also produce lg (1024) and mobile (390) variants. Others: 1920 hero only.
Hero canvas 1920×1080. Light is default; also do dark for ★ items.

1. ★ AGENTIC PIPELINE STRIP — the self-correction visualization. Two renders:
   (a) Happy path: retrieve · rerank · grade(✓ Correct 0,82) · generate.
   (b) Corrective path: full sequence INCLUDING the loop-back — make "it went
       back for more" obvious (return arrow, second lane, or pass-1/pass-2
       labels; pick one, commit). Each stage: icon + label + state
       (pending/running/done) + ms. Grade stage shows the outcome chip
       (label + confidence, mono).

2. ★ HITL APPROVAL CARD — inline in the conversation, the centerpiece. Make
   APPROVE and DECLINE equally first-class. Four states as separate artboards:
   (a) DECIDING: heading ("Need more sources?"), one line saying WHY, quoting
       the question + grade ("Local sources were ambiguous on '…'"). A checklist
       of candidate URLs — each row: checkbox + domain/favicon + page title +
       1-line snippet + small source-kind icon + a "select all". Top results
       pre-checked. TWO co-equal actions: primary "Crawl N & continue →" (N
       tracks selection) and an equally-prominent "Decline — answer from local".
       Neither should look like the scary/throwaway option.
   (b) CRAWLING: card morphs to progress — "Crawling 2 of 3 … indexing …
       re-retrieving … answering" (Progress + the stage idiom).
   (c) PARTIAL FAILURE: non-blocking Alert — "1 of 3 URLs failed to crawl —
       answered from the rest."
   (d) DECLINED: collapses to a compact muted chip above the answer — "Declined
       web search · answered from local corpus."

3. ANSWER PROVENANCE. When web fallback contributed, the answer meta line gets a
   small "↻ corrected via web" badge, and web-sourced citations use the WEB
   (globe) icon to distinguish them from local graph/vector citations.

4. THREADS "NEEDS APPROVAL". A thread paused at an interrupt shows an amber
   "needs your approval" Badge in the Threads list; reopening it shows the
   approval card and the composer is disabled with a tooltip ("Resume the
   pending approval to continue"). One small artboard.

5. SETTINGS — "Corrective RAG" section. EN+RU labels:
   - enable_corrective_rag (Switch)
   - grade band: a DUAL-handle range slider over 0..1 with three labeled zones —
     "Incorrect" (≤ low) | "LLM decides" (middle) | "Correct" (≥ high) — encoding
     crag_incorrect_threshold (0,30) and crag_correct_threshold (0,70) in one
     control.
   - crag_max_corrections (stepper 0–3, default 1)
   - web_fallback_max_urls (slider 1–10, default 5)

6. RUN HISTORY — add a "grade" cell (the colored outcome chip) and a "fallback"
   indicator to each row, plus a "used web fallback" filter chip. Match the
   existing History table styling.

7. EVALS — a "Corrective RAG impact" panel above/beside the existing stat cards:
   CRAG on-vs-off as paired stat deltas (precision@5, recall@5 with ▲/▼), a grade
   distribution mini-bar (correct/ambiguous/incorrect), and a "fallback fired: N
   / M questions" stat. Reuse the existing stat-card + chart-token look.

8. COMPONENT STATES SHEET — approval checklist row, grade chip, provenance badge:
   idle / hover / focus / checked / disabled, light + dark, EN + RU.

=== DATA SHAPES THE UI CONSUMES ===

  // New SSE events on POST /ask/stream (added to today's token/node/done):
  { type:"node", name:"grade"|"transform_query"|"web_search"|"crawl_index",
    phase:"start"|"done", elapsed_ms:number }
  { type:"grade", label:"correct"|"ambiguous"|"incorrect",
    confidence:number /*0..1*/, reason:string }
  { type:"interrupt", reason:"approve_urls", thread_id:string,
    candidate_urls:{ url:string; title:string; snippet:string }[] }

  // Resume: POST /ask/resume  body { thread_id:string, approved_urls:string[] }
  //   approved_urls non-empty = APPROVE those;  [] = DECLINE (answer local-only)

  // Turn status the UI tracks:
  "pending" | "awaiting_approval" | "crawling" | "ok" | "error"

  // Run-history row gains: grade, grade_confidence, fallback_used, decision

=== i18n — design EN and RU ===

RU variants of: approval card (deciding) and the grade chip. RU strings run
15–25% longer — leave slack; body line-height ≥1.55 for Cyrillic. Keys:
  "Need more sources?"        → "Нужны дополнительные источники?"
  "Crawl {n} & continue"      → "Загрузить {n} и продолжить"
  "Decline — answer from local" → "Отклонить — ответить по локальным"
  "Select all"                → "Выбрать все"
  "corrected via web"         → "исправлено через веб"
  grade Correct/Ambiguous/Incorrect → "Достаточно" / "Неоднозначно" / "Недостаточно"
  "needs your approval"       → "требуется ваше подтверждение"
Numbers RU: thin-space thousands (12 345), comma decimals (0,82).

=== THEMING — light + dark ===

Light default (off-white ~#fafafa, zinc neutrals). Dark = shadcn zinc-950
register (not pure black). Do dark for the ★ surfaces.

=== SAMPLE DATA FOR MOCKS (use verbatim) ===

Question:  "How is FERRET's activation codeword provisioned?"
Grade:     { label:"ambiguous", confidence:0.46,
             reason:"Top local chunk covers activation codes generally, not FERRET specifically." }
Candidate URLs:
  ☑ support.1password.com — "Secret Key" — "Your Secret Key is combined with your password…"
  ☑ anthropic.com/research — "Activation passes" — "Provisioning short-lived activation tokens…"
  ☐ reddit.com/r/… — "Thread (unverified)" — "someone said you can just regenerate it…"
Answer meta after correction: "sovereign-rag · 4/12 chunks · 6.2s · ↻ corrected via web"
Evals impact: precision@5 0,71 → 0,86 (▲0,15) · fallback fired 3/14 · grades 9✓/3~/2✕

=== DELIVERABLES ===

- ~16–20 artboards. Hero 1920×1080.
- ★ items (pipeline strip, approval card) at 1920 + 1024 + 390, light + dark.
- RU variants of the approval card (deciding) and grade chip.
- Component states sheet.
- Annotate each artboard with shadcn components used + Tailwind breakpoint label.
- One strong direction, deeply executed — no alternate palettes.
```

---

## After Claude Design ships

The returned mocks become **Section 4** of the CRAG design spec
(`docs/superpowers/specs/`). Port order, matching existing component structure:

1. `frontend/src/components/ask/pipeline-strip.tsx` — extend `StageName` with
   `grade`/`transform_query`/`web_search`/`crawl_index` + the grade outcome chip
   and the loop-back rendering.
2. New `frontend/src/components/ask/approval-card.tsx` — the HITL card
   (deciding / crawling / partial-fail / declined). Approve **and** decline.
3. `Ask.tsx` — add `"awaiting_approval"` / `"crawling"` to the `Turn` status
   union; wire `useAskStream` to the new `interrupt`/`grade` SSE events and the
   `/ask/resume/stream` continuation.
4. Provenance badge + web-kind citation icon in `citation-chip.tsx` /
   `sources-rail.tsx`.
5. Settings "Corrective RAG" section; History `grade`/`fallback` column; Evals
   "Corrective RAG impact" panel.
6. Locale keys into `src/locales/en.json` + `ru.json`.
