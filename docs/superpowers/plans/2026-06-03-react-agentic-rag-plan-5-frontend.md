# ReAct Agentic RAG — Plan 5: Frontend tool trace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or executing-plans. Steps use `- [ ]`.

**Goal:** Render the agent's dynamic tool steps in the Ask UI — a compact "tool trace" showing what the controller did this turn (e.g. `search_corpus → web_search → crawl_and_index → answer`) — driven by the `agent_step` SSE events typed in Plan 3.

**Architecture:** The fixed CRAG pipeline strip assumes known stages; the agent's steps are dynamic. Capture `agent_step` events into the streaming turn's state and render them as an ordered chip list (only when present, i.e. agent mode). No backend changes. Minimal, additive — does not disturb the CRAG pipeline strip.

**Tech Stack:** React 19 + TS, Tailwind, the existing `useAskStream` hook (already exposes `onAgentStep` from Plan 3). Gate: `npm run build` (tsc + vite) + no NEW eslint errors. **Prereq:** Plans 1–3.

---

## Task 1: Capture `agent_step` into the streaming turn

**Files:** Modify `frontend/src/pages/Ask.tsx`.

- [ ] **Step 1:** Add a field to the `Turn` interface (near `crawlProgress`):

```typescript
  /** Ordered agent tool steps for this turn (ReAct mode). */
  agentSteps?: { tool: string }[]
```

- [ ] **Step 2:** Wire the `onAgentStep` callback in the `useAskStream({...})` options object (alongside `onCrawlProgress`), appending to the current turn:

```typescript
    onAgentStep: (ev) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, agentSteps: [...(t.agentSteps ?? []), { tool: ev.tool }] }
            : t,
        ),
      )
    },
```

- [ ] **Step 3:** Build check — `cd frontend && npm run build` (tsc passes; the field + callback type-check against the Plan-3 `StreamEvent`/`UseAskStreamOptions`).

- [ ] **Step 4:** Commit — `feat(ui): capture agent_step tool trace into the turn` (no Co-Authored-By footer).

---

## Task 2: Render the tool trace

**Files:** Create `frontend/src/components/ask/agent-trace.tsx`; Modify `frontend/src/pages/Ask.tsx`.

- [ ] **Step 1: Create** `frontend/src/components/ask/agent-trace.tsx` — a small presentational component:

```tsx
import { Box, Globe, Search, Sparkles } from "lucide-react"

/** Map a ReAct tool name to a short label + icon. */
const TOOL_META: Record<string, { label: string; Icon: typeof Search }> = {
  SearchCorpus: { label: "search corpus", Icon: Search },
  WebSearch: { label: "web search", Icon: Globe },
  CrawlAndIndex: { label: "crawl + index", Icon: Box },
}

export function AgentTrace({ steps }: { steps: { tool: string }[] }) {
  if (steps.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
      <Sparkles className="size-3 text-primary" strokeWidth={2} />
      {steps.map((s, i) => {
        const meta = TOOL_META[s.tool] ?? { label: s.tool, Icon: Search }
        const Icon = meta.Icon
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-border">→</span>}
            <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted/50 px-1.5 py-0.5">
              <Icon className="size-3" strokeWidth={2} />
              {meta.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Render it** in `Ask.tsx`'s `ConversationTurn`, inside the `pending` and `crawling` and `ok` assistant blocks — place `{turn.agentSteps && turn.agentSteps.length > 0 && <AgentTrace steps={turn.agentSteps} />}` just above the existing `PipelineStrip` usage in each of those branches. Import `AgentTrace` at the top of `Ask.tsx`. (Showing it in `ok` too lets a completed agent turn keep its trace.)

- [ ] **Step 3:** Build — `cd frontend && npm run build` passes. `npm run lint` — confirm no NEW errors in `agent-trace.tsx` / `Ask.tsx` (the ~27-error baseline is pre-existing; your files should add 0).

- [ ] **Step 4:** Commit — `feat(ui): render agent tool trace (search/web/crawl → answer)`.

---

## Task 3: Gate

- [ ] `cd frontend && npm run build` (passes) and `npm run lint` (no new errors vs the baseline). Commit any fixes: `chore(ui): plan-5 gate green`.

---

## Self-review
- Spec §3/Plan-5 (dynamic tool steps rendered) ✓ — additive, agent-only (the chip row only shows when `agentSteps` is non-empty, so CRAG/linear turns are unaffected). The CRAG `PipelineStrip` is untouched. No backend changes. Types: `agentSteps: {tool}[]` matches the `onAgentStep` event (`{tool, args?}`); `AgentTrace` props match. No placeholders.
