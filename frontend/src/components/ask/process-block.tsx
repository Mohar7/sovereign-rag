import { useState } from "react"
import { Box, ChevronDown, ChevronRight, Globe, Loader, Search, Sparkles } from "lucide-react"

import { cn } from "@/lib/utils"
import { MonoTag } from "./citation-chip"

export type ProcessStatus = "pending" | "awaiting_approval" | "crawling" | "ok" | "error"

type StepStatus = "done" | "running" | "fail" | "idle"

const TOOL_META: Record<string, { label: string; Icon: typeof Search }> = {
  SearchCorpus: { label: "search corpus", Icon: Search },
  WebSearch: { label: "web search", Icon: Globe },
  CrawlAndIndex: { label: "crawl + index", Icon: Box },
  __answer__: { label: "answer", Icon: Sparkles },
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

/** Status dot styles per step status */
function StepDot({ stepStatus }: { stepStatus: StepStatus }) {
  return (
    <span
      style={{
        position: "absolute",
        left: -22,
        top: "50%",
        transform: "translateY(-50%)",
        width: 11,
        height: 11,
        borderRadius: 999,
        background: stepStatus === "idle" ? "var(--muted)" : "var(--card)",
        border:
          "1.5px solid " +
          (stepStatus === "done"
            ? "var(--primary)"
            : stepStatus === "running"
              ? "var(--primary)"
              : stepStatus === "fail"
                ? "var(--destructive)"
                : "var(--border)"),
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {stepStatus === "done" && (
        <span
          style={{ width: 5, height: 5, borderRadius: 999, background: "var(--primary)" }}
        />
      )}
      {stepStatus === "running" && (
        <span
          className="sr-dot-pulse"
          style={{ width: 5, height: 5, borderRadius: 999, background: "var(--primary)" }}
        />
      )}
    </span>
  )
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
    // design: marginBottom 14, collapsed pill; expanded gets muted bg + border
    <div style={{ marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => setToggle({ snapshot: autoOpen, choice: !open })}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "3px 8px 3px 6px",
          borderRadius: 6,
          cursor: "pointer",
          color: open ? "var(--foreground)" : "var(--muted-foreground)",
          background: open ? "var(--muted)" : "transparent",
          border: open
            ? "1px solid color-mix(in oklab, var(--border) 70%, transparent)"
            : "1px solid transparent",
        }}
      >
        {open ? (
          <ChevronDown size={12} />
        ) : (
          <ChevronRight size={12} />
        )}
        <MonoTag
          style={{
            fontSize: 11.5,
            color: open ? "var(--foreground)" : "var(--muted-foreground)",
          }}
        >
          {summary}
        </MonoTag>
      </button>

      {open && (
        // design: marginTop 8, marginLeft 9, paddingLeft 16, borderLeft primary rail
        <div
          style={{
            marginTop: 8,
            marginLeft: 9,
            paddingLeft: 16,
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            gap: 0,
          }}
        >
          {timeline.map((tool, i) => {
            const meta = TOOL_META[tool] ?? { label: tool, Icon: Search }
            const Icon = meta.Icon
            const isLast = i === timeline.length - 1
            const running = inFlight && isLast

            const stepStatus: StepStatus = running
              ? "running"
              : inFlight
                ? "done"
                : i < timeline.length - 1
                  ? "done"
                  : "done"

            return (
              <div
                key={i}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "5px 0",
                  position: "relative",
                }}
              >
                <StepDot stepStatus={stepStatus} />
                <Icon
                  size={13}
                  style={{
                    color: running ? "var(--primary)" : "var(--foreground)",
                    flexShrink: 0,
                  }}
                  strokeWidth={2}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: running ? "var(--foreground)" : "var(--foreground)",
                  }}
                >
                  {meta.label}
                </span>
                <span style={{ flex: 1 }} />
                {running ? (
                  <span
                    style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
                  >
                    <Loader
                      size={11}
                      className={cn("sr-spin")}
                      style={{ color: "var(--primary)" }}
                    />
                    <MonoTag style={{ fontSize: 11, color: "var(--primary)" }}>
                      running…
                    </MonoTag>
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
