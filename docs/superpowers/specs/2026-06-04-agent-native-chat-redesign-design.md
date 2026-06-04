# Agent-Native Chat Redesign — Design

**Status:** approved (brainstorm) — pending implementation plan
**Date:** 2026-06-04
**Relates to:** `2026-06-03-react-agentic-rag-design.md` (the ReAct agent this UI now serves). The chat was built for the old linear/CRAG pipeline; the backend is now a ReAct agent (live in prod, `ENABLE_REACT_AGENT=true`).

---

## 1. Problem

The Ask/chat UI is **overloaded and built for a pipeline that no longer drives it**. `Ask.tsx` is 903 lines, `pipeline-strip.tsx` 450, `approval-card.tsx` 552. The biggest issues (from a parallel audit + agent-contract map + agentic-chat pattern survey):

- **Vestigial linear/CRAG machinery:** the fixed 7-stage `PipelineStrip` (retrieve→rerank→grade→transform_query→web_search→crawl_index→generate), the grade band, the 3-lane "corrective" view, and the `isKnownStage` filter that **silently drops the agent's own steps**. The ReAct agent emits only `agent_step` / `token` / `citations` / `interrupt`+`crawl_progress` / `done` — **never** `node`/`grade`.
- **Double process chrome:** two parallel progress strips per turn (`PipelineStrip` *and* `AgentTrace`).
- **Panel sprawl:** a persistent 360px `SourcesRail` plus three overlapping sheets (inspector, context-manager, source-drawer).
- **Heavy controls:** a 4-popover composer; a 4-state approval card; a dense meta row; citations rendered in three places.

## 2. Goals / non-goals

**Goals**
- An **answer-first, agent-native** chat: the streamed answer is the hero; process is one quiet, collapsed row beneath it.
- Render exactly what the ReAct agent produces (tool trace, reformat-vs-search turns, multi-hop, HITL crawl, inline citations, provenance) — nothing vestigial.
- Cut overhead: one process block (not two), no persistent rail, one composer affordance, a slim intent-preview approval.
- Improve visual hierarchy/quality on the existing technical/dense token system.

**Non-goals (out of scope)**
- The Evals / Threads / History surfaces — CRAG/pipeline visualization stays there, untouched.
- Backend changes — the SSE contract is fixed (Plan 3 already added `agent_step`).
- The `turn-inspector` / `context-manager` / `source-drawer` sheets stay as on-demand power surfaces (inspector cleaned of dead CRAG-stage rows; no redesign).
- New i18n languages — keep EN/RU; new copy gets keys in both `en.json` + `ru.json`.

## 3. Decisions (approved)
1. **Agent-native only** — delete the linear/CRAG chat visualization; CRAG viz lives only in Evals/Threads.
2. **Inline sources disclosure** — no persistent rail; "Used N sources" expands on demand; full-width answer.
3. **Lean composer** — text + send + one gear (model · rerank-k · graph).
4. **Answer-first, process-collapsed** — the converged 2025-26 agent-chat pattern.

## 4. Turn anatomy

```
[ user message — right-aligned ]

[ assistant ]
  ▾ searching corpus…                         (process block: live + expanded WHILE streaming)
  <streamed markdown answer, inline [1][2]>    (hero)
  ▸ searched corpus · 2 searches · 6.2s        (process collapses to one line on `done`)
  ▸ Used 5 sources                             (inline sources disclosure)
  copy · regenerate · view trace ↗   ⟐ corrected via web   (actions + provenance if fallback_used)
```

## 5. The process block (`process-block.tsx` — replaces `PipelineStrip` + `AgentTrace`)

One block per turn. Consumes `agent_step` (ordered tool calls) + the answer **token** stream (which marks the final "answer" step). **Ignores** `grade`, `node`, and the 7 fixed stages — they are not part of the agent path.

- **States:** while streaming → **expanded** live timeline (`search corpus → web search → answer`, each row: icon + label + status + ms); on `done` → **auto-collapse to a one-line summary**; non-routine turns (web fallback fired, or an `interrupt` occurred) → **stay expanded**.
- **Summary line** (derived from steps + total timing): `answered from conversation · 0.8s` (reformat, zero tool calls) · `searched corpus · 2 searches · 6.2s` (multi-hop) · `web fallback · 2 pages · 8.2s`.
- **Tool → label/icon map:** `SearchCorpus`→"search corpus" (search icon), `WebSearch`→"web search" (globe), `CrawlAndIndex`→"crawl + index" (box), finalize→"answer" (sparkle). Unknown tool → its raw name (forward-compatible).
- Collapsed row is muted/secondary (low contrast, small) so it never competes with the answer.

## 6. Sources — inline disclosure (`sources-disclosure.tsx`)

Inline `[n]` chips + popover stay (kept from `citation-chip.tsx`). Below the answer: a **"Used N sources"** disclosure (collapsed by default) → expands to a compact list, one row per citation: `[n] · title · doc/uri · score`, clickable → opens the existing `SourceDrawer` sheet. When `fallback_used`, web-crawled sources are tagged (globe). The persistent 360px `SourcesRail` is **removed** (the answer column goes full-width). `pickKind` / `citationToSource` logic is reused.

## 7. Composer (`composer.tsx` slimmed)

`[ Ask anything…            ⚙  ↑ ]`. Text input + send; **one gear** opens a single popover containing model · rerank-k · graph toggle (the four current popovers collapse into it). The attach-context button appears only when `activeThreadId` exists. `ComposerConfig` / `DEFAULT_COMPOSER_CONFIG` / the `ChipButton` primitive are reused; only the affordance layout changes.

## 8. Approval — Intent-Preview checkpoint (`approval-card.tsx` slimmed)

On `interrupt` (turn → `awaiting_approval`): a compact gate — heading *"The agent wants to read these pages to answer:"*, the candidate URL list (favicon · domain, checkable, reusing `FavTile`), the agent's **reason/why**, and first-class **Approve / Decline** (decline → empty `approved_urls` → local-only answer). On approve → `crawling` state shows per-URL `crawl_progress`; on completion a one-line **receipt** (`crawled 2 pages · 41 chunks`) folds into the process block. The 4-state CRAG framing (grade-explanation header, hardcoded crawling→indexing→re-retrieving phases, `DeclinedChip` CRAG copy) is dropped/genericized. `/ask/resume(+stream)` wiring is unchanged.

## 9. Component plan

- **Delete:** `pipeline-strip.tsx`; in `Ask.tsx` the `isKnownStage` filter, the `stages`/`emptyStages` per-turn pipeline state, the 7-stage `final.timings` unpack, and `onNode`/`onGrade` chat handling (agent doesn't emit them); remove the persistent `SourcesRail` usage.
- **New:** `process-block.tsx`, `sources-disclosure.tsx`, `conversation-turn.tsx` (extract the ~250-line `ConversationTurn` out of `Ask.tsx`).
- **Merge:** `agent-trace.tsx` logic → into `process-block.tsx` (then delete `agent-trace.tsx`).
- **Slim:** `approval-card.tsx` (→ intent-preview + crawling + receipt; drop the partial/declined CRAG framing), `composer.tsx` (→ one gear), `turns.tsx` meta row (drop the dense dot-separated chunks/elapsed/model line; move detail to actions/inspector).
- **Refactor:** `Ask.tsx` → orchestration only (state + SSE wiring + layout), turn rendering moves to `conversation-turn.tsx`. Target: well under 400 lines.
- **Keep:** `markdown-answer.tsx`, `citation-chip.tsx` (popover), thread restoration + `popstate`, the turn state machine (`pending`/`awaiting_approval`/`crawling`/`ok`/`error`), design tokens, `context-manager-sheet`/`source-drawer` (on-demand), `turn-inspector-sheet` (as "view trace"; delete its CRAG-stage rows).

## 10. Data flow (SSE → turn state)

`Ask.tsx` keeps the existing `useAskStream` callbacks, remapped for the agent:
- `onAgentStep` → append `{tool}` to `turn.agentSteps` (drives the process timeline). *(already wired)*
- `onToken` → append to `turn.answer` (hero, streamed).
- `onCitations` / `done.citations` → `turn.citations` (inline + disclosure).
- `onInterrupt` → `awaiting_approval` + `candidateUrls`; `onCrawlProgress` → `crawling` progress; resume via `submitResume`. *(unchanged)*
- `onDone` → `ok`; compute the process summary from `agentSteps` + `done.timings.total`; set `fallbackUsed`/provenance. **Stop** consuming `onNode`/`onGrade` for the chat (harmless no-ops; remove the `stages`/grade UI).
- `onError` → `error` + `ErrorBanner` (add a working dismiss).

## 11. Turn type → visual treatment

| Turn type | Process block | Sources | Notes |
|-----------|---------------|---------|-------|
| reformat (0 tool calls) | `answered from conversation · Ns` | none | no "Used N sources" |
| single-hop | `searched corpus · 1 search · Ns` | Used N sources | |
| multi-hop | `searched corpus · M searches · Ns` | Used N sources | |
| web fallback (approved) | stays expanded; receipt line; `⟐ corrected via web` | web-tagged sources | via approval card |
| web fallback (declined) | `answered from local corpus · Ns` | local only | no provenance badge |
| error | hidden | none | `ErrorBanner` + retry |

## 12. Visual language

Keep the technical/dense token system (`index.css`; already de-"maccy"'d to 14px/1.55, square corners, indigo/zinc). Refresh **hierarchy**, not the palette: answer prominent; process row muted/secondary; restrained square chips; consistent spacing; a calm empty state. **Produce a claude.ai/design prompt** (saved to `docs/` per project convention) covering the new turn anatomy, the process block (live + collapsed), the sources disclosure, the intent-preview approval, the lean composer, and the empty state — then implement from it.

## 13. Verification

Frontend gate: `npm run build` (tsc + vite) passes; `npm run lint` adds **zero** new errors over the ~27 baseline. New components keep one clear responsibility (`process-block`, `sources-disclosure`, `conversation-turn`). New copy added to `en.json` + `ru.json`. Manual: exercise each turn type against the live agent (reformat, single/multi-hop, web-fallback approve/decline, error).

## 14. Risks
- **Process-summary accuracy** — derive from `agentSteps` + timing; fall back to a generic "answered · Ns" if steps are absent (e.g. a `done` with no `agent_step`).
- **Removing `stages`** must not break the `turn-inspector` "view trace" — inspector reads from the turn's `agentSteps`/timings instead.
- **i18n drift** — every new string in both locales; CI/lint won't catch missing RU keys, so add them with the component.
- **Scope creep** — do not touch Evals/Threads/History or the backend; chat surface only.
