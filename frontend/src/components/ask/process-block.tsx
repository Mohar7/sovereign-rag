import { useState } from "react"
import { Box, ChevronRight, Globe, Search, Sparkles } from "lucide-react"

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

  // Auto open while in-flight; collapse on done unless non-routine.
  // Store a (snapshot, choice) pair: when autoOpen differs from snapshot the
  // user's last explicit toggle is stale and we fall back to autoOpen.
  const autoOpen = inFlight ? true : nonRoutine
  const [toggle, setToggle] = useState<{ snapshot: boolean; choice: boolean } | null>(null)
  const open = toggle !== null && toggle.snapshot === autoOpen ? toggle.choice : autoOpen

  if (status === "error") return null
  const summary = summarize(steps, totalMs, declined)

  // Live timeline: the tool steps, plus an "answer" step once we're answering.
  const timeline = [...steps.map((s) => s.tool), ...(inFlight || status === "ok" ? ["__answer__"] : [])]

  return (
    <div className="mb-2 text-[11.5px] text-muted-foreground">
      <button
        type="button"
        onClick={() => setToggle({ snapshot: autoOpen, choice: !open })}
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
