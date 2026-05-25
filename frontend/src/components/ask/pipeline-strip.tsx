import { Check, CircleDot, Loader2, ScanSearch, Sparkles, Wand2 } from "lucide-react"

import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// PipelineStrip
//
// Renders the three RAG nodes (retrieve_local → rerank → generate) as a
// horizontal pill row above the streaming answer. Each pill carries:
//   - status icon (idle / running / done)
//   - human-readable stage label
//   - elapsed ms once the node finishes, or "live" pulse while active
//
// The Ask page tracks state for each node via the useAskStream `onNode`
// callback (start/done + elapsed_ms) and passes it in here.
// ─────────────────────────────────────────────────────────────────

export type StageName = "retrieve_local" | "rerank" | "generate"
export type StagePhase = "idle" | "running" | "done"

export interface StageState {
  phase: StagePhase
  /** Elapsed time in ms once the stage is done. */
  elapsedMs?: number
}

export interface PipelineStripProps {
  stages: Record<StageName, StageState>
}

const STAGE_ORDER: StageName[] = ["retrieve_local", "rerank", "generate"]

const STAGE_META: Record<StageName, { label: string; icon: React.ComponentType<{ className?: string }> }> = {
  retrieve_local: { label: "retrieve", icon: ScanSearch },
  rerank: { label: "rerank", icon: Wand2 },
  generate: { label: "generate", icon: Sparkles },
}

export function PipelineStrip({ stages }: PipelineStripProps) {
  return (
    <ol
      aria-label="retrieval pipeline progress"
      className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2 py-1.5 text-[12px]"
    >
      {STAGE_ORDER.map((name, i) => {
        const stage = stages[name]
        const meta = STAGE_META[name]
        return (
          <li key={name} className="flex items-center gap-1.5">
            {i > 0 && <Connector active={stage.phase !== "idle"} />}
            <StagePill name={name} stage={stage} meta={meta} />
          </li>
        )
      })}
    </ol>
  )
}

function StagePill({
  name,
  stage,
  meta,
}: {
  name: StageName
  stage: StageState
  meta: (typeof STAGE_META)[StageName]
}) {
  const Icon = meta.icon
  const isRunning = stage.phase === "running"
  const isDone = stage.phase === "done"
  return (
    <span
      data-stage={name}
      data-phase={stage.phase}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono",
        "transition-colors duration-[120ms]",
        isDone && "bg-primary/10 text-primary",
        isRunning && "bg-primary/15 text-primary ring-1 ring-primary/40",
        !isDone && !isRunning && "text-muted-foreground",
      )}
    >
      <StatusIcon phase={stage.phase} Icon={Icon} />
      <span className="text-[11.5px] uppercase tracking-wide">{meta.label}</span>
      {isDone && typeof stage.elapsedMs === "number" && (
        <span className="font-mono text-[10.5px] tabular-nums opacity-80">
          {formatMs(stage.elapsedMs)}
        </span>
      )}
      {isRunning && <span className="font-mono text-[10.5px] uppercase opacity-80">live</span>}
    </span>
  )
}

function StatusIcon({
  phase,
  Icon,
}: {
  phase: StagePhase
  Icon: React.ComponentType<{ className?: string }>
}) {
  if (phase === "running") {
    return <Loader2 className="size-3 animate-spin" />
  }
  if (phase === "done") {
    return <Check className="size-3" />
  }
  // idle
  return <CircleDot className="size-3 opacity-50" />
}

function Connector({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-px w-3 transition-colors duration-[120ms]",
        active ? "bg-primary/60" : "bg-border",
      )}
    />
  )
}

function formatMs(n: number): string {
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(1)}s`
}

/** Helper: derive the initial `stages` map for a new turn. */
export function emptyStages(): Record<StageName, StageState> {
  return {
    retrieve_local: { phase: "idle" },
    rerank: { phase: "idle" },
    generate: { phase: "idle" },
  }
}
