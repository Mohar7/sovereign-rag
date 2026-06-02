# Corrective RAG — Frontend (Plan 4 of 5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the CRAG UI from the delivered Claude Design bundle into the live React app — so a user can watch the self-correction in the pipeline strip, approve/decline the web fallback inline, see "corrected via web" provenance, configure the grade band in Settings, and read the CRAG A/B impact on the Evals page. The backend (Plans 1-3) already returns everything this needs.

**Architecture:** Two halves. (1) **Integration wiring** (NOT in the design bundle — spelled out completely here): bring `lib/api.ts` types in sync with the Plan-2 backend (interrupted status, interrupt/grade/resume, runs CRAG fields, evals `crag` block), extend `use-ask-stream.ts` with the new SSE events (`grade`/`interrupt`/`crawl_progress`) + a resume stream, and drive the new `Turn` statuses (`awaiting_approval`/`crawling`) + resume flow in `Ask.tsx`. (2) **Visual ports** (the bundle IS the source of truth): port `design/Sovereign RAG Design System/crag/components/crag-primitives.jsx` + `screens/*.jsx` into the app's shadcn/Tailwind idiom, matching existing `frontend/src/components` patterns. Primitives match the shipped tokens already (indigo/zinc, `Sparkles/Share2/Box/Globe` kind icons), so they drop in.

**Tech Stack:** React 19 + TypeScript · shadcn/ui (new-york) + Tailwind v4 · TanStack Query/Table/Form · react-i18next (EN+RU) · lucide-react · sonner. Verification: `npm run build` (`tsc -b && vite build`) + `npm run lint` (eslint). **No frontend test runner** — the gate is typecheck + lint + build green, plus visual fidelity to the bundle.

**Scope note:** Plan **4 of 5**. Depends on Plans 1-3 (the backend contract). Out of scope: docs reconciliation (Plan 5). Spec: `docs/superpowers/specs/2026-06-02-corrective-rag-hitl-design.md` §5.4. Design reference (gitignored, local): `design/Sovereign RAG Design System/crag/` — `components/crag-primitives.jsx`, `screens/{pipeline,approval,ask-context,app-surfaces,misc}.jsx`; open `crag/Corrective RAG.html` to view.

**Porting rules (read before any visual task):**
- The bundle JSX uses **inline styles + CSS vars** (it's a standalone mock). Port to the app's idiom: Tailwind classes + `cn()` + the existing CSS vars (`var(--primary)`, `text-muted-foreground`, etc.). Match the nearest existing component's style (e.g. `components/ask/pipeline-strip.tsx`, `components/ask/citation-chip.tsx`).
- Keep the bundle's **structure, states, copy, and EN/RU strings**; translate visual intent, not literal inline styles.
- lucide icons: the bundle hand-rolls SVGs; use `lucide-react` (`RotateCcw`, `CircleCheck`/`CircleAlert`/`CircleX`, `Wand2`, `DownloadCloud`/`CloudDownload`, `Scale`, `Gauge`, `Globe`, `Lock`, `CornerDownLeft`, `User`). Confirm each name exists in the installed `lucide-react@1.16` (substitute the closest if not).
- All user-facing strings go through `t(...)` with keys added to BOTH `src/locales/en.json` and `src/locales/ru.json` (RU strings are in the bundle).

**Conventions:** Conventional-commit messages, **no `Co-Authored-By` footer**.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `frontend/src/lib/api.ts` | types in sync w/ Plan-2 backend + `askResume` | modify |
| `frontend/src/hooks/use-ask-stream.ts` | `grade`/`interrupt`/`crawl_progress` events + resume stream | modify |
| `frontend/src/components/crag/*` | ported primitives (grade chip, provenance, sliders, fav tile) | **create** |
| `frontend/src/components/ask/pipeline-strip.tsx` | new stages + corrective lanes + grade chip | modify |
| `frontend/src/components/ask/approval-card.tsx` | HITL card (deciding/crawling/partial/declined) | **create** |
| `frontend/src/pages/Ask.tsx` | `awaiting_approval`/`crawling` statuses + resume + provenance | modify |
| `frontend/src/components/ask/citation-chip.tsx` / `sources-rail.tsx` | web-kind icon + provenance | modify |
| `frontend/src/pages/Settings.tsx` (+ `hooks/use-settings.ts`) | "Corrective RAG" section | modify |
| `frontend/src/pages/History.tsx` (+ `hooks/use-runs.ts`) | grade + fallback columns + filter | modify |
| `frontend/src/pages/Evals.tsx` (+ `hooks/use-evals.ts`) | "Corrective RAG impact" panel | modify |
| `frontend/src/pages/Threads.tsx` | "needs approval" badge | modify |
| `frontend/src/locales/{en,ru}.json` | all new strings | modify |

---

## Task 1: API types in sync with the Plan-2 backend (`lib/api.ts`)

The backend (Plan 2) changed these contracts; the frontend types are stale. Complete code:

**Files:** Modify `frontend/src/lib/api.ts`

- [ ] **Step 1: Add/extend the types**

Replace `AskResponse` and add the CRAG types (near the existing `AskResponse`/`CitationModel`):

```typescript
export type GradeLabel = "correct" | "ambiguous" | "incorrect"

export interface GradeModel {
  label: GradeLabel
  confidence: number
  reason: string
}

export interface CandidateUrl {
  url: string
  title: string
  snippet: string
  verified?: boolean | null
}

export interface InterruptModel {
  reason: "approve_urls"
  candidate_urls: CandidateUrl[]
}

export interface AskResponse {
  thread_id: string
  status: "ok" | "interrupted"
  answer: string | null
  citations: CitationModel[]
  retrieved: number
  used: number
  fallback_used: boolean
  grade: GradeModel | null
  interrupt: InterruptModel | null
}

export interface ResumeRequest {
  thread_id: string
  approved_urls: string[]
}
```

Extend `RunRow` with the CRAG columns (Plan 2 Task 7):

```typescript
  grade: GradeLabel | null
  grade_confidence: number | null
  fallback_used: boolean
  decision: "approved" | "declined" | null
  correction_attempts: number
```

Extend the evals types (Plan 3) — add a `CragSummary` and an optional `crag` on `EvalsResults`:

```typescript
export interface CragSummary {
  k: number
  aggregate_off: Record<string, number>
  aggregate_on: Record<string, number>
  lift_on_corrected: Record<string, number>
  grade_distribution: { correct: number; ambiguous: number; incorrect: number }
  fallback_fired: number
  n_questions: number
  n_requires_web: number
}
```

and add `crag?: CragSummary | null` to `EvalsResults`. Also add the per-question CRAG fields to `EvalsPerQuestion` (optional, since linear-mode rows lack them):

```typescript
  grade?: GradeLabel | null
  fallback_used?: boolean
  requires_web?: boolean
```

- [ ] **Step 2: Add the resume client method**

In the `api` object, after `ask:`:

```typescript
  askResume: (body: ResumeRequest) => postJSON<AskResponse>("/ask/resume", body),
```

- [ ] **Step 3: Typecheck**

Run: `cd frontend && npm run build`
Expected: `tsc -b` passes (no consumers break — these are additive/widening except `AskResponse.status`, which widens from `"ok"` to a union; any exhaustive switch on it will now error and is fixed in Task 5). If `tsc` flags a consumer, note it — Tasks 5/7/8/9 fix the consumers; you may need to land Task 1 + its consumers together if `tsc -b` blocks. Prefer: make Task 1 type-only and additive, and let the widened `status` be handled where it's read (Ask.tsx, Task 5).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/api.ts
git commit -m "feat(ui): sync api types with CRAG backend (interrupted, grade, resume, runs, evals.crag)"
```

---

## Task 2: SSE events + resume stream (`use-ask-stream.ts`)

**Files:** Modify `frontend/src/hooks/use-ask-stream.ts`

- [ ] **Step 1: Extend `StageTimings`, `StreamEvent`, options, and add a resume submit**

Add the new node names to `StageTimings`:

```typescript
export interface StageTimings {
  retrieve_local?: number
  rerank?: number
  grade?: number
  transform_query?: number
  web_search?: number
  crawl_index?: number
  generate?: number
  total?: number
}
```

Add the three new event variants to `StreamEvent` (mirror `api/ask/router.py:_stream_generator` — Plan 2 Task 5):

```typescript
  | { type: "grade"; label: GradeLabel; confidence: number; reason: string }
  | {
      type: "interrupt"
      thread_id: string
      reason: "approve_urls"
      candidate_urls: CandidateUrl[]
    }
  | { type: "crawl_progress"; url: string; status: "crawling" | "indexed" | "failed"; chunks?: number }
```

(import `GradeLabel`, `CandidateUrl` from `@/lib/api`.) Add callbacks to `UseAskStreamOptions`: `onGrade?`, `onInterrupt?`, `onCrawlProgress?`. Extend `dispatch` with the three new cases.

Add a `submitResume` to the hook that POSTs `/ask/resume/stream` with `{thread_id, approved_urls}` and reuses the SAME stream-reading loop (extract the reader loop into a shared `runStream(url, body, ac)` so `submit` and `submitResume` share it). Return `submitResume` from the hook.

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: green (the new callbacks are optional; `Ask.tsx` wires them in Task 5).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/hooks/use-ask-stream.ts
git commit -m "feat(ui): stream client handles grade/interrupt/crawl_progress + resume stream"
```

---

## Task 3: Port the shared CRAG primitives (`components/crag/`)

Port `design/.../crag/components/crag-primitives.jsx` into typed React components in the app idiom. Reference the bundle for exact layout/colors/copy; match `components/ask/citation-chip.tsx` for the styling approach (Tailwind + `cn`, `var(--*)` tokens).

**Files:** Create `frontend/src/components/crag/grade-chip.tsx`, `provenance-badge.tsx`, `grade-band-slider.tsx`, `stepper.tsx`, `value-slider.tsx`, `fav-tile.tsx`, `source-kind-icon.tsx`

- [ ] **Step 1: Create each primitive**

Port these (bundle → component), keeping props + semantics:
- `GradeChip({ label, confidence?, lang?, size? })` — icon + label + mono confidence; semantic colors (success/warning/destructive) per `GRADE` map; RU uses comma decimals. Use `react-i18next` for the label (keys `crag.grade.correct|ambiguous|incorrect`) instead of the bundle's `lang` prop, and a `formatConfidence(n)` that respects the active locale (comma in RU). Pop-in animation: add the keyframes to `index.css` gated on `prefers-reduced-motion` (port the bundle's `crag-pop`).
- `ProvenanceBadge()` — "↻ corrected via web" pill (`RotateCcw` + `t("crag.correctedViaWeb")`).
- `SourceKindIcon({ kind })` — `{hybrid:Sparkles, graph:Share2, vector:Box, web:Globe}` (this already exists as a map in `citation-chip.tsx` — REUSE that mapping; export it if needed rather than duplicating).
- `GradeBandSlider({ low, high, onChange? })` — dual-handle, three zones (Incorrect ≤low / "LLM decides" / Correct ≥high), red→amber→green track + numeric readout. For v1 it can be **display + two number inputs** (or two range inputs) rather than a full drag-dual-thumb widget — the priority is the labeled-zones visualization and persisting the two values; note if you simplify the interaction.
- `Stepper({ value, min, max, onChange })`, `ValueSlider({ value, min, max, onChange })` — small numeric controls (use the existing shadcn `Slider` for `ValueSlider` if it composes cleanly).
- `FavTile({ domain, size? })` — monogram tile (first letter of domain), no network favicons (offline-first).

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: green. The components are self-contained; nothing imports them yet.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/crag/ frontend/src/index.css
git commit -m "feat(ui): port CRAG primitives (grade chip, provenance, grade-band slider, stepper, fav tile)"
```

---

## Task 4: Agentic pipeline strip (corrective lanes + grade chip)

Extend `pipeline-strip.tsx` to the bundle's design (`crag/screens/pipeline.jsx`): the new stage names, the grade outcome chip, and — when corrections happened — the stacked "pass 1 · local / correction · web fallback / pass 2 · re-retrieve" lanes with return arrows. The human-decision stage uses the amber/warning tone.

**Files:** Modify `frontend/src/components/ask/pipeline-strip.tsx`

- [ ] **Step 1: Extend `StageName` + render**

- `StageName` → add `grade`, `transform_query`, `web_search`, `crawl_index`. Extend `STAGE_META` (labels via i18n keys `pages.ask.pipeline.*`, icons `Gauge`/`Wand2`/`Globe`/`CloudDownload`). Extend `emptyStages()`.
- Accept an optional `grade?: GradeModel` and a `corrective?: boolean` (or derive "corrective" from whether any of the correction-stage states are non-idle). Happy path: render the existing compact row + a `GradeChip` after the grade stage. Corrective path: render the stacked lanes per the bundle (`crag/screens/pipeline.jsx` `CorrectiveStrip`) — keep it as a vertical lanes layout (the bundle's `CorrectiveStripMobile` is the simplest faithful structure and works at all widths). Use the existing `StagePill`/`Connector` where possible.
- The `Ask.tsx` `isKnownStage` guard (Task 5) must accept the new names.

- [ ] **Step 2: Typecheck + lint + eyeball**

Run: `cd frontend && npm run build && npm run lint`. Then `npm run dev` and confirm the strip renders both a happy (grade=correct) and a corrective (multi-lane) shape against `crag/Corrective RAG.html`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ask/pipeline-strip.tsx
git commit -m "feat(ui): agentic pipeline strip — grade chip + corrective loop lanes"
```

---

## Task 5: Approval card + Ask.tsx status machine + resume + provenance

The centerpiece. Port the approval card and wire the interrupt→approve/decline→resume flow into the conversation. Complete code for the status machine + stream wiring (the integration glue); the card visuals port from `crag/screens/approval.jsx`.

**Files:** Create `frontend/src/components/ask/approval-card.tsx`; modify `frontend/src/pages/Ask.tsx`, `citation-chip.tsx`/`sources-rail.tsx`

- [ ] **Step 1: Approval card component**

Create `components/ask/approval-card.tsx` with a state-driven render (port from `crag/screens/approval.jsx`):
- `deciding`: warning header + grade chip + "your call" badge; "select all"; per-row checkbox + `FavTile` + title + globe icon + optional "unverified" badge + snippet + mono URL; footer with **co-equal** primary "Crawl N & continue" and solid-secondary "Decline — answer from local". Props: `candidates: CandidateUrl[]`, `grade`, `question`, `onApprove(urls)`, `onDecline()`. Track checked state internally; the primary button's N tracks the selection.
- `crawling`: aggregate progress + 4-phase strip (`crawling→indexing→re-retrieving→answering`) + per-URL list fed by `crawl_progress` events. Props: `progress: { url; status }[]`.
- `partial`: non-blocking amber alert + per-URL done/failed list.
- `declined`: compact muted chip ("Declined web search · answered from local corpus") — rendered above the answer.

- [ ] **Step 2: Ask.tsx — extend the Turn status machine**

In `Ask.tsx`:
- Extend the `Turn` interface `status` union: `"pending" | "awaiting_approval" | "crawling" | "ok" | "error"`. Add `Turn` fields: `grade?: GradeModel | null`, `candidateUrls?: CandidateUrl[]`, `crawlProgress?: { url: string; status: string; chunks?: number }[]`, `fallbackUsed?: boolean`, `declined?: boolean`.
- Wire the new `useAskStream` callbacks:
  - `onGrade(label, confidence, reason)` → set `turn.grade` on the current turn (and the pipeline strip's grade).
  - `onInterrupt(payload)` → set `turn.status = "awaiting_approval"`, `turn.candidateUrls = payload.candidate_urls`, `turn.threadId = payload.thread_id`. Stop the streaming spinner.
  - `onCrawlProgress(ev)` → append to `turn.crawlProgress` (and set status `"crawling"`).
- `isKnownStage` accepts the four new stage names.
- Add `handleApprove(turn, urls)` / `handleDecline(turn)`: set status `"crawling"`, call `stream.submitResume({ thread_id: turn.threadId!, approved_urls: urls | [] })`, and reuse the SAME stream callbacks (the resume stream emits node/token/grade/citations/done). On `onDone`, set status `"ok"`, `fallbackUsed`, etc.
- Render: in `ConversationTurn`, when `status === "awaiting_approval"` render `<ApprovalCard state="deciding" .../>`; when `"crawling"` render `state="crawling"`; on `ok` with `declined` show the declined chip; on `ok` with `fallbackUsed` show `<ProvenanceBadge/>` in the meta line.

- [ ] **Step 3: Provenance + web-kind citations**

In `citation-chip.tsx`/`sources-rail.tsx`: web-sourced citations already get the `Globe` icon via the existing kind map — ensure crawled-this-turn citations are tagged `kind:"web"` (the backend citation has `source_uri`; `pickKind` in `Ask.tsx` currently always returns `"hybrid"` — extend it to return `"web"` when the citation came from a fallback crawl, e.g. detect via a `web`-ish `source_uri` or a flag). Add the small "web — crawled this turn / local corpus" legend from `ProvenanceBoard` when `fallbackUsed`.

- [ ] **Step 4: Typecheck + lint + eyeball the full flow**

Run: `cd frontend && npm run build && npm run lint`. With the backend running and `ENABLE_CORRECTIVE_RAG=true`, drive a `requires_web`-style question → interrupt → approval card → approve → crawling → answer with provenance. (Or eyeball against `crag/screens/ask-context.jsx`.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/ask/approval-card.tsx frontend/src/pages/Ask.tsx frontend/src/components/ask/citation-chip.tsx frontend/src/components/ask/sources-rail.tsx
git commit -m "feat(ui): HITL approval card + interrupt/resume flow + web provenance in Ask"
```

---

## Task 6: Settings — "Corrective RAG" section

**Files:** Modify `frontend/src/pages/Settings.tsx`, `frontend/src/hooks/use-settings.ts`, and the backend settings schema if the CRAG knobs aren't exposed.

- [ ] **Step 1: Expose the CRAG knobs in the settings API + types**

The backend `SettingsResponse` (`api/settings/schemas.py`) and the frontend `SettingsResponse` type must include the CRAG knobs (`enable_corrective_rag`, `crag_correct_threshold`, `crag_incorrect_threshold`, `crag_max_corrections`, `web_fallback_max_urls`). **Check first** whether `/api/settings` already returns them; if not, add them to the backend settings schema + service (mirror the existing knob round-trip — this is a small backend addition that belongs with this UI). Add the same fields to the frontend `SettingsResponse` in `api.ts`.

- [ ] **Step 2: Render the section**

Port `crag/screens/app-surfaces.jsx` `SettingsCorrective`: a "Corrective RAG" group with the enable `Switch`, the `GradeBandSlider` (binds `crag_incorrect_threshold`/`crag_correct_threshold`), the `Stepper` (`crag_max_corrections`), and `ValueSlider` (`web_fallback_max_urls`) — each field row showing the mono config key, matching the existing Settings layout. Persist via the existing `patchSettings` flow.

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`. (If backend schema changed: `uv run pytest -m "not integration" -q && uv run mypy src/` too.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.tsx frontend/src/hooks/use-settings.ts frontend/src/lib/api.ts src/sovereign_rag/api/settings/
git commit -m "feat(ui): Corrective RAG settings section (grade band, max corrections, max urls)"
```

---

## Task 7: Run History — grade + fallback columns + filter

**Files:** Modify `frontend/src/pages/History.tsx` (+ `hooks/use-runs.ts` if needed)

- [ ] **Step 1: Add columns + filter**

Port `crag/screens/app-surfaces.jsx` `HistoryGrade`: a `grade` cell (`GradeChip` with `r.grade`/`r.grade_confidence`), a `fallback` cell (`RotateCcw` when `r.fallback_used`, else `—`), a `decision` cell (approved/declined badge), and a "used web fallback" filter chip. Fallback rows get a faint brand wash. The `RunRow` type already carries these (Task 1).

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/History.tsx frontend/src/hooks/use-runs.ts
git commit -m "feat(ui): run history shows grade + fallback + decision, with a fallback filter"
```

---

## Task 8: Evals — "Corrective RAG impact" panel

**Files:** Modify `frontend/src/pages/Evals.tsx` (+ `hooks/use-evals.ts`)

- [ ] **Step 1: Render the panel when `results.crag` exists**

Port `crag/screens/app-surfaces.jsx` `EvalsImpact`: above the existing stat cards, when `data.crag` is present, render paired off→on stat cards with ▲/▼ delta badges (precision@5, recall@5 from `aggregate_off`/`aggregate_on` + `lift_on_corrected`), a "fallback fired N/M" card with a per-question cell strip, and a grade-distribution stacked bar + legend. Reuse the page's existing stat-card + `--chart-*` token styling. Gracefully render nothing extra when `data.crag` is absent (linear/offline eval).

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Evals.tsx frontend/src/hooks/use-evals.ts
git commit -m "feat(ui): Evals 'Corrective RAG impact' panel (A/B deltas, grade dist, fallback)"
```

---

## Task 9: Threads "needs approval" badge

**Files:** Modify `frontend/src/pages/Threads.tsx` (+ `ThreadSummary` type / backend if a paused flag isn't exposed)

- [ ] **Step 1: Surface paused threads**

Port `crag/screens/misc.jsx` `ThreadsNeedsApproval`: a thread paused at an interrupt shows an amber "needs your approval" `Badge`. **Check** whether `ThreadSummary` / `/api/threads` can tell a thread is paused (a pending checkpoint interrupt). If not exposed, the minimal version: derive it from the most-recent run having `status != "ok"`-but-actually... a paused thread has NO completed run for its last question — so the cleanest signal is a backend `paused_at_interrupt` flag on `ThreadSummary` (small backend addition: check the checkpoint for a pending interrupt). If that's too large for this plan, render the badge from a client-side signal (a thread the user left in `awaiting_approval`) and note the limitation as a follow-up. Reopening a paused thread should show the approval card + a disabled composer with the `Lock` tooltip (port from `misc.jsx`) — reuse the Task 5 approval card.

- [ ] **Step 2: Typecheck + lint**

Run: `cd frontend && npm run build && npm run lint`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Threads.tsx
git commit -m "feat(ui): threads 'needs approval' badge for paused interrupts"
```

---

## Task 10: i18n (EN + RU) + full green

**Files:** Modify `frontend/src/locales/en.json`, `frontend/src/locales/ru.json`

- [ ] **Step 1: Add every CRAG string in both locales**

Collect all `t(...)` keys introduced in Tasks 3-9 and add them to BOTH locale files. The RU strings are in the bundle (verbatim) — lift them. Keys (suggested namespacing): `crag.grade.{correct,ambiguous,incorrect}`, `crag.correctedViaWeb`, `crag.approval.{title,why,selectAll,crawlContinue,declineLocal,yourCall,unverified}`, `crag.crawling.{crawling,indexing,reRetrieving,answering}`, `crag.declinedChip`, `crag.needsApproval`, `crag.composerLocked`, `pages.ask.pipeline.{grade,transformQuery,webSearch,crawlIndex}`, `pages.settings.crag.*`, `pages.history.{grade,fallback,decision,usedWebFallback}`, `pages.evals.cragImpact.*`. Ensure no missing-key warnings at runtime.

- [ ] **Step 2: Full green**

Run:
```bash
cd frontend && npm run build && npm run lint
```
Expected: clean. Launch `npm run dev`, switch EN↔RU, and confirm no missing-translation fallbacks on any CRAG surface (RU strings ~15-25% longer — confirm nothing clips).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ru.json
git commit -m "i18n(ui): EN+RU strings for all CRAG surfaces"
```

---

## Self-review (against the spec §5.4)

**Spec coverage:**
- §5.4.1 agentic pipeline strip → Task 4. ✅
- §5.4.2 HITL approval card (4 states, approve+decline) → Task 5. ✅
- §5.4.3 Ask.tsx status machine + resume + crawl_progress → Tasks 2, 5. ✅
- §5.4.4 provenance badge + web-kind citation → Tasks 3, 5. ✅
- §5.4.5 Settings CRAG section → Task 6. ✅
- §5.4.6 Run History grade/fallback → Task 7. ✅
- §5.4.7 Evals impact panel → Task 8. ✅
- §5.4.8 Threads "needs approval" → Task 9. ✅
- §5.4.9 i18n EN+RU → Task 10. ✅
- New shared primitives → Task 3. ✅
- API/SSE contract sync → Tasks 1, 2. ✅

**Placeholder scan:** the visual tasks (3-9) are intentionally reference-based (port from the named bundle file + match the named existing component) rather than re-pasting TSX — the bundle is the committed visual source of truth and re-transcribing it into the plan would be lossy. The integration wiring (Tasks 1, 2, and Task 5's status machine) is spelled out completely because it is NOT in the bundle. Two tasks (6, 9) flag a possible small backend addition (settings knobs exposure; threads paused flag) with a decision point — resolve by checking the existing endpoint first.

**Type consistency:** `GradeModel`/`CandidateUrl`/`InterruptModel`/`ResumeRequest`/`GradeLabel` (Task 1) are consumed by `use-ask-stream.ts` (Task 2), `Ask.tsx` (Task 5), the primitives (Task 3), and the pages (6-8). `RunRow` CRAG fields (Task 1) → History (Task 7). `EvalsResults.crag`/`CragSummary` (Task 1) → Evals (Task 8).

## Risks / decisions

- **No frontend test runner.** The gate is `tsc` + eslint + build + visual fidelity to the bundle. Reviews should eyeball against `crag/Corrective RAG.html` and the existing screenshots, not just trust green build.
- **Two possible small backend additions** (Tasks 6 + 9): exposing the CRAG settings knobs in `/api/settings`, and a `paused_at_interrupt` flag on `ThreadSummary`. Each is a minor, in-scope backend touch (with its own pytest+mypy gate) — check the existing endpoint first; if exposing them is non-trivial, the plan notes the minimal fallback.
- **`AskResponse.status` widening** (Task 1) can ripple into any exhaustive consumer; land Task 1 with its Ask.tsx consumer (Task 5) if `tsc -b` blocks in between, or keep the new fields optional/additive.

## Execution handoff

Subagent-driven, on `feat/corrective-rag-backend`. Suggested units: **(A)** Tasks 1-2 (contract: types + SSE), **(B)** Tasks 3-4 (primitives + pipeline strip), **(C)** Task 5 (the approval/resume centerpiece — its own unit), **(D)** Tasks 6-10 (Settings/History/Evals/Threads + i18n + full green). After Plan 4: **Plan 5 (docs reconciliation)** — README/architecture/CLAUDE.md, restore the `/ask/resume` examples, add the `grade` node + loop to the diagrams, fix stale `agent/`→`graphs/rag_qa/` paths. Once Plans 4-5 land and the eval A/B shows the lift, enabling CRAG in prod (`ENABLE_CORRECTIVE_RAG=true`) is the final, data-backed ops step.
