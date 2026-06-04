# Agent-Native Chat Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Ask/chat surface to be answer-first and agent-native — one collapsible process block (replacing PipelineStrip + AgentTrace), inline "Used N sources" disclosure (no rail), a one-gear composer, an intent-preview approval card — and delete the vestigial linear/CRAG visualization.

**Architecture:** Frontend-only (React 19 + TS + Tailwind v4). The ReAct agent SSE contract is fixed; the UI just renders it cleanly. Extract turn rendering out of the 903-line `Ask.tsx` into focused components, delete `pipeline-strip.tsx`/`agent-trace.tsx`, and stop consuming the CRAG-only `node`/`grade` events in the chat.

**Tech Stack:** React/TS, Tailwind, lucide-react, react-i18next (EN/RU), existing design tokens (`index.css`).

**Spec:** `docs/superpowers/specs/2026-06-04-agent-native-chat-redesign-design.md`

## Frontend verification (no unit-test harness)

This project's frontend has no test runner. Each task verifies with:
- `cd frontend && npm run build` → tsc -b + vite must pass (zero type errors).
- `npm run lint` → must add **zero** new errors over the ~27-error pre-existing baseline (your touched/new files clean).
- Manual: the spec's turn-type checks against the live agent.

**Commit messages MUST NOT include any `Co-Authored-By` / "Generated with Claude" footer** (project rule). All work on branch `feat/agent-native-chat` (create it first; do NOT work on `main`).

---

## File structure

- **Create** `docs/claude-design-agent-native-chat-prompt.md` — the claude.ai/design prompt (per the save-prompts-to-docs convention).
- **Create** `frontend/src/components/ask/process-block.tsx` — collapsible agent process: live tool timeline → one-line summary.
- **Create** `frontend/src/components/ask/sources-disclosure.tsx` — inline "Used N sources" disclosure.
- **Create** `frontend/src/components/ask/conversation-turn.tsx` — the turn renderer extracted from `Ask.tsx`.
- **Modify** `frontend/src/components/ask/composer.tsx` — four popovers → one gear.
- **Modify** `frontend/src/components/ask/approval-card.tsx` — slim to intent-preview + crawling + receipt.
- **Modify** `frontend/src/components/ask/turns.tsx` — slim the meta row.
- **Modify** `frontend/src/pages/Ask.tsx` — orchestration only; remove stages/grade/rail; use the new components.
- **Modify** `frontend/src/components/ask/turn-inspector-sheet.tsx` — drop CRAG-stage rows; "view trace" reads `agentSteps`.
- **Modify** `frontend/src/locales/en.json` + `ru.json` — add new keys, remove dead ones.
- **Delete** `frontend/src/components/ask/pipeline-strip.tsx`, `frontend/src/components/ask/agent-trace.tsx`.

---

## Task 1: claude.ai/design prompt (visual treatment)

**Files:** Create `docs/claude-design-agent-native-chat-prompt.md`

- [ ] **Step 1:** Write a self-contained claude.ai/design prompt describing the redesigned chat for visual generation. It MUST specify: the design system (technical/dense — Inter 14px/1.55, JetBrains Mono accents, indigo-600 primary, zinc neutrals, square-ish radii, light+dark); the **turn anatomy** (user message right; assistant = answer-as-hero with inline `[1][2]` citation chips; a muted collapsed process row; an inline "Used N sources" disclosure; per-message actions copy/regenerate/view-trace; a "corrected via web" provenance chip); the **process block** in both states (live expanded timeline `search corpus → web search → answer` with per-step status+ms, and the collapsed one-line summary `searched corpus · 2 searches · 6.2s`); the **intent-preview approval** (heading, checkable URL list with favicon+domain, the "why", Approve/Decline, a receipt line); the **one-gear composer**; and the **empty state**. Ask for desktop + mobile, light + dark, and the five turn types (reformat / single-hop / multi-hop / web-fallback / error). State that it is for an internal GraphRAG tool, answer-first ("AI-second"), not "maccy".

- [ ] **Step 2: Commit**

```bash
git add docs/claude-design-agent-native-chat-prompt.md
git commit -m "docs(design): claude.ai/design prompt for the agent-native chat"
```

---

## Task 2: `process-block.tsx`

**Files:** Create `frontend/src/components/ask/process-block.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useEffect, useState } from "react"
import { Box, ChevronRight, Globe, Search, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

export type ProcessStatus = "pending" | "awaiting_approval" | "crawling" | "ok" | "error"

const TOOL_META: Record<string, { label: string; Icon: typeof Search }> = {
  SearchCorpus: { label: "search corpus", Icon: Search },
  WebSearch: { label: "web search", Icon: Globe },
  CrawlAndIndex: { label: "crawl + index", Icon: Box },
}

function summarize(steps: { tool: string }[], totalMs: number | undefined, declined: boolean): string {
  const secs = totalMs != null ? `${(totalMs / 1000).toFixed(1)}s` : null
  const searches = steps.filter((s) => s.tool === "SearchCorpus").length
  const crawled = steps.some((s) => s.tool === "CrawlAndIndex")
  let head: string
  if (steps.length === 0) head = "answered from conversation"
  else if (crawled && !declined) head = "web fallback"
  else if (declined) head = "answered from local corpus"
  else head = searches === 1 ? "searched corpus" : `searched corpus · ${searches} searches`
  return secs ? `${head} · ${secs}` : head
}

/**
 * One process block per turn. Replaces PipelineStrip + AgentTrace. While the
 * turn is in-flight it shows a live tool timeline; on completion it collapses
 * to a one-line summary — unless the turn was non-routine (web fallback /
 * declined), which stays expanded.
 */
export function ProcessBlock({
  steps,
  status,
  totalMs,
  fallbackUsed = false,
  declined = false,
}: {
  steps: { tool: string }[]
  status: ProcessStatus
  totalMs?: number
  fallbackUsed?: boolean
  declined?: boolean
}) {
  const inFlight = status === "pending" || status === "awaiting_approval" || status === "crawling"
  const nonRoutine = fallbackUsed || declined
  const [open, setOpen] = useState(inFlight)

  // Auto-collapse when the turn finishes (unless non-routine); auto-open while in-flight.
  useEffect(() => {
    if (inFlight) setOpen(true)
    else setOpen(nonRoutine)
  }, [inFlight, nonRoutine])

  if (status === "error") return null
  const summary = summarize(steps, totalMs, declined)

  // Live timeline: the tool steps, plus an "answer" step once we're answering.
  const timeline = [...steps.map((s) => s.tool), ...(inFlight || status === "ok" ? ["__answer__"] : [])]

  return (
    <div className="mb-2 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-mono hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2} />
        <span>{summary}</span>
      </button>
      {open && (
        <ol className="mt-1.5 ml-1.5 flex flex-col gap-1 border-l border-border pl-3">
          {timeline.map((tool, i) => {
            const meta =
              tool === "__answer__"
                ? { label: "answer", Icon: Sparkles }
                : (TOOL_META[tool] ?? { label: tool, Icon: Search })
            const Icon = meta.Icon
            const isLast = i === timeline.length - 1
            const running = inFlight && isLast
            return (
              <li key={i} className="inline-flex items-center gap-1.5 font-mono">
                <Icon className="size-3 text-primary" strokeWidth={2} />
                <span className={cn(running && "text-foreground")}>{meta.label}</span>
                {running && <span className="text-primary">…</span>}
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify** — `cd frontend && npm run build` passes; `npm run lint` no new errors in `process-block.tsx`.

- [ ] **Step 3: Commit** — `git commit -am "feat(ui): process-block — collapsible agent tool timeline + summary"`

---

## Task 3: `sources-disclosure.tsx`

**Files:** Create `frontend/src/components/ask/sources-disclosure.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { useState } from "react"
import { ChevronRight, Globe } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { CitationModel } from "@/lib/api"
import { pickKind } from "@/lib/citation-kind"
import { cn } from "@/lib/utils"
import i18n from "@/lib/i18n"

/**
 * Inline "Used N sources" disclosure beneath an answer. Collapsed by default;
 * expands to a compact citation list. Replaces the persistent SourcesRail.
 */
export function SourcesDisclosure({
  citations,
  onOpenSource,
}: {
  citations: CitationModel[]
  onOpenSource?: (c: CitationModel) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (citations.length === 0) return null
  return (
    <div className="mt-3 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-mono text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2} />
        {t("pages.ask.usedSources", { count: citations.length })}
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-1.5">
          {citations.map((c, i) => {
            const web = pickKind(c) === "web"
            return (
              <li key={c.chunk_id}>
                <button
                  type="button"
                  onClick={() => onOpenSource?.(c)}
                  disabled={!onOpenSource}
                  className="flex w-full items-baseline gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted disabled:hover:bg-transparent"
                >
                  <span className="font-mono font-semibold text-primary">[{i + 1}]</span>
                  {web && <Globe className="size-3 shrink-0 self-center text-muted-foreground" strokeWidth={2} />}
                  <span className="truncate font-medium text-foreground">
                    {c.title || i18n.t("common.untitled")}
                  </span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                    {c.score.toFixed(2)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Add i18n key** — in `frontend/src/locales/en.json` under `pages.ask`, add `"usedSources": "Used {{count}} sources"`; in `ru.json` add `"usedSources": "Использовано источников: {{count}}"`.

- [ ] **Step 3: Verify** — `npm run build` passes; lint clean for the new file.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): sources-disclosure — inline 'Used N sources'"`

---

## Task 4: `conversation-turn.tsx` (extract + rewire)

**Files:** Create `frontend/src/components/ask/conversation-turn.tsx`; will be imported by `Ask.tsx` in Task 8.

- [ ] **Step 1:** Move the `ConversationTurn` component (currently in `Ask.tsx`, the ~250-line function rendering pending/awaiting_approval/crawling/ok/error) into this new file. Keep the same props (`turn`, `onRegenerate`, `onOpenInspector`, `onOpenSource`, `onApprove`, `onDecline`), plus add the `Turn` type import. Then rewire it to the agent-native layout:
  - Replace every `<PipelineStrip .../>` and `<AgentTrace .../>` usage with a single `<ProcessBlock steps={turn.agentSteps ?? []} status={turn.status} totalMs={turn.totalMs} fallbackUsed={turn.fallbackUsed} declined={turn.declined} />`.
  - In the `ok` branch, after `<MarkdownAnswer .../>`, render `<SourcesDisclosure citations={turn.citations ?? []} onOpenSource={onOpenSource} />` and remove the old `CitationLegend`/`EmptyAnswerFallback` source duplication (the disclosure + MarkdownAnswer cover it).
  - Remove the `corrective` computation and all `turn.stages`/`grade`-driven rendering.
  - Keep `UserTurn`, `AssistantTurn`, `ErrorBanner`, the `awaiting_approval` → `<ApprovalCard state="deciding" .../>` and `crawling` → `<ApprovalCard state="crawling" .../>` usages.
  - Import `ProcessBlock` from `./process-block`, `SourcesDisclosure` from `./sources-disclosure`.

- [ ] **Step 2:** Export `ConversationTurn` and the `Turn` interface from this file (move the `Turn` interface here too, since the turn renderer owns its shape; `Ask.tsx` will import `Turn` from here). Keep `agentSteps?: { tool: string }[]`; **remove** `stages?` and `grade?` from `Turn` (no longer rendered). Keep `totalMs`, `fallbackUsed`, `declined`, `candidateUrls`, `crawlProgress`, `citations`, etc.

- [ ] **Step 3: Verify** — `npm run build` (will still pass only after Task 8 wires it; if build references are incomplete, proceed — Task 8 completes the wiring). At minimum the new file must be type-correct in isolation. Run `npx tsc --noEmit -p frontend/tsconfig.app.json 2>&1 | grep conversation-turn || echo "no errors in conversation-turn"`.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): extract conversation-turn; render process-block + sources-disclosure"`

---

## Task 5: Composer — one gear

**Files:** Modify `frontend/src/components/ask/composer.tsx`

- [ ] **Step 1:** Replace the four inline popovers (ModelPickerPopover, RetrievalKnobsPopover, GraphTogglePopover, attach) with a single gear `ChipButton` that opens ONE `Popover` whose content stacks: the model select, the retrieve/rerank-k sliders, and the graph toggle (reuse the existing controls/handlers — just move them inside one popover). Keep the attach-context button rendered only when the `onAttach` prop is provided (unchanged). Use the `Settings` lucide icon for the gear. Keep `ComposerConfig`, `DEFAULT_COMPOSER_CONFIG`, `ChipButton`, and the textarea + send button exactly as-is.

- [ ] **Step 2:** Add i18n key `pages.ask.settings` = "Settings" / "Настройки" if a label is needed for the gear's aria-label.

- [ ] **Step 3: Verify** — `npm run build` passes; lint no new errors in `composer.tsx`.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): composer — collapse 4 popovers into one settings gear"`

---

## Task 6: Approval card — intent preview

**Files:** Modify `frontend/src/components/ask/approval-card.tsx`

- [ ] **Step 1:** Reduce the component to three states: `deciding`, `crawling`, and a completion `receipt` (drop the separate `partial`/`declined` 4-state framing). For `deciding`: a compact heading (i18n `crag.approval.heading` = "The agent wants to read these pages to answer:"), the candidate URL list with the existing `FavTile` favicon + extracted domain and checkboxes, an optional one-line "why" (the agent's reason, from the interrupt payload's `grade`/`reason` if present), and first-class **Approve** / **Decline** buttons (decline = submit empty `approved_urls`). For `crawling`: keep the per-URL `crawl_progress` rows (crawling → indexed/failed) but drop the hardcoded crawling→indexing→re-retrieving phase strip. Remove the CRAG `GradeChip`/grade-explanation header and the `DeclinedChip` CRAG copy. Keep `CrawlProgressItem` type + the approve/decline handler props unchanged so `Ask.tsx` wiring is untouched.

- [ ] **Step 2:** Update/add i18n keys in en.json + ru.json: `crag.approval.heading`, `crag.approval.why`, keep `actions.approve`/`actions.decline` (or add if missing). Remove now-dead keys referenced only by the deleted states.

- [ ] **Step 3: Verify** — `npm run build` passes; lint no new errors.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): approval-card — slim to intent-preview checkpoint"`

---

## Task 7: Turn meta row — slim

**Files:** Modify `frontend/src/components/ask/turns.tsx`

- [ ] **Step 1:** In `AssistantTurn`, drop the dense dot-separated meta line (`sovereign-rag · chunks · elapsed · model · fallback`). Keep only the per-message actions (copy, regenerate, the "view trace" → `onOpenInspector` button). The chunk/elapsed/model detail moves to the inspector ("view trace"); the provenance "corrected via web" chip is rendered by `conversation-turn` next to the actions when `fallbackUsed`. Keep `UserTurn` and the `AssistantTurn` frame (avatar, container).

- [ ] **Step 2: Verify** — `npm run build` passes; lint no new errors.

- [ ] **Step 3: Commit** — `git commit -am "feat(ui): slim assistant turn meta to per-message actions"`

---

## Task 8: `Ask.tsx` — orchestration only + deletions

**Files:** Modify `frontend/src/pages/Ask.tsx`; Delete `frontend/src/components/ask/pipeline-strip.tsx`, `frontend/src/components/ask/agent-trace.tsx`

- [ ] **Step 1:** Import `ConversationTurn` and `Turn` from `@/components/ask/conversation-turn` (remove the now-moved inline `ConversationTurn` + `Turn` definitions). Remove imports of `PipelineStrip`/`emptyStages`/`StageName`/`StageState` (from `pipeline-strip`) and `AgentTrace`, `SourcesRail`/`SourceItem`, `CitationChip`. Keep `MarkdownAnswer`? (it moved into `conversation-turn`; remove from Ask if unused.)

- [ ] **Step 2:** Remove the `isKnownStage` function, the `onNode` and `onGrade` callbacks from `useAskStream({...})`, and the `stages`/`emptyStages`/grade fields from `submitWithConfig`'s placeholder turn and the `onDone` `final.timings` 7-stage unpack (keep `totalMs: final.timings?.total`). Keep `onToken`, `onCitations`, `onDone`, `onError`, `onInterrupt`, `onCrawlProgress`, `onAgentStep`.

- [ ] **Step 3:** Remove the right-side `<SourcesRail .../>` block and the `sources`/`sourcesLoading`/`citationToSource` rail wiring (the inline `SourcesDisclosure` in `conversation-turn` replaces it). Keep `SourceDrawer`, `TurnInspectorSheet`, `ContextManagerSheet` (on-demand sheets) and `sourceCitation` state. The main column becomes full-width.

- [ ] **Step 4:** Render the turns via `<ConversationTurn ... />` (already imported). Keep the empty state, the restoring spinner (`isRestoring`), the resume chip, and the composer.

- [ ] **Step 5:** Delete the files: `git rm frontend/src/components/ask/pipeline-strip.tsx frontend/src/components/ask/agent-trace.tsx`. Fix any remaining import errors surfaced by the build.

- [ ] **Step 6: Verify** — `cd frontend && npm run build` passes (this is the integration point — all prior tasks must compile together now); `npm run lint` adds zero new errors.

- [ ] **Step 7: Commit** — `git commit -am "feat(ui): Ask.tsx orchestration-only; drop pipeline-strip/agent-trace/rail/grade"`

---

## Task 9: Turn inspector — drop CRAG stages

**Files:** Modify `frontend/src/components/ask/turn-inspector-sheet.tsx`

- [ ] **Step 1:** Remove the CRAG-stage `STAGE_ROW_META` entries (grade, transform_query, web_search, crawl_index, retrieve_local, rerank) and the `PipelineTimeline` that renders them. Replace the "PIPELINE" section with a compact **tool trace** read from the turn's `agentSteps` (tool name + order) plus `totalMs`. Keep the QUESTION / ANSWER / overrides / citations sections. Update the `InspectableTurn` type to carry `agentSteps?: { tool: string }[]` instead of `stages`.

- [ ] **Step 2:** Update `Ask.tsx`'s `inspectedTurn` mapping (it builds `InspectableTurn`) to pass `agentSteps` instead of `stages`.

- [ ] **Step 3: Verify** — `npm run build` passes; lint no new errors.

- [ ] **Step 4: Commit** — `git commit -am "feat(ui): inspector shows agent tool trace, not CRAG stages"`

---

## Task 10: i18n sweep + dead-key cleanup

**Files:** Modify `frontend/src/locales/en.json`, `frontend/src/locales/ru.json`

- [ ] **Step 1:** Ensure every new key added in Tasks 3/5/6 exists in BOTH `en.json` and `ru.json` (`pages.ask.usedSources`, `pages.ask.settings`, `crag.approval.heading`, `crag.approval.why`). Remove keys now referenced by nothing (the deleted pipeline-strip stage labels, the removed approval 4-state copy, the dropped meta-row strings) — grep the `src/` tree for each candidate key before deleting to confirm it's unused.

- [ ] **Step 2: Verify** — `npm run build` passes; `npm run lint` no new errors. Spot-check the app renders EN and RU without missing-key warnings in the console.

- [ ] **Step 3: Commit** — `git commit -am "chore(ui): i18n keys for redesigned chat; drop dead keys"`

---

## Task 11: Final gate + manual verification

- [ ] **Step 1:** `cd frontend && npm run build` (passes) and `npm run lint` (error count ≤ the pre-redesign baseline; new files clean).
- [ ] **Step 2:** Confirm deleted files are gone and unreferenced: `grep -rn "pipeline-strip\|agent-trace\|SourcesRail\|isKnownStage\|emptyStages" frontend/src` returns nothing.
- [ ] **Step 3:** Manual check against the live agent (prod or `npm run dev`): each turn type renders per the spec table — reformat (no sources, "answered from conversation"), single/multi-hop (collapsed summary + Used N sources), web-fallback approve/decline (intent-preview → receipt → provenance), error (banner). Process block auto-expands while streaming, auto-collapses on done (except web fallback).
- [ ] **Step 4: Commit** any gate fixes — `git commit -am "chore(ui): chat redesign gate green"`.

---

## Self-review

- **Spec coverage:** answer-first turn anatomy (Task 4) ✓; process block collapse behavior + summary (Task 2) ✓; inline sources disclosure, no rail (Tasks 3, 8) ✓; one-gear composer (Task 5) ✓; intent-preview approval (Task 6) ✓; delete pipeline-strip/agent-trace/grade/isKnownStage (Tasks 8) ✓; Ask.tsx → orchestration + conversation-turn extraction (Tasks 4, 8) ✓; inspector de-CRAG'd (Task 9) ✓; i18n EN+RU (Tasks 3/5/6/10) ✓; claude.ai/design prompt to docs (Task 1) ✓; data-flow remap drop onNode/onGrade (Task 8) ✓; visual language via claude.ai/design (Task 1) + tokens (kept). Evals/Threads/backend untouched (not in any task) ✓.
- **Placeholder scan:** new components have full code; modifications give exact change specs + the JSX/keys to add and what to remove (the implementer reads the existing large files). No "TBD"/"handle edge cases".
- **Type consistency:** `Turn` (with `agentSteps`, without `stages`/`grade`) defined in `conversation-turn.tsx` (Task 4), imported by `Ask.tsx` (Task 8) and mapped into `InspectableTurn.agentSteps` (Task 9); `ProcessBlock`/`SourcesDisclosure` prop names match their call sites; `ProcessStatus` mirrors the turn status union; `pickKind` reused from `@/lib/citation-kind`.
- **Note:** Task 4's build won't fully pass until Task 8 wires it in — flagged in Task 4 Step 3 (isolated type-check only). Task 8 is the integration gate.
