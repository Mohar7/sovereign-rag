import { Bot, Check, Clock, ExternalLink, FileText, Hash, Sparkles, User } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import type { StageName, StageState } from "@/components/ask/pipeline-strip"
import type { AskOverrides, CitationModel } from "@/lib/api"
import { cn } from "@/lib/utils"

export interface InspectableTurn {
  id: number
  question: string
  answer: string | null | undefined
  citations: CitationModel[]
  retrieved: number
  used: number
  threadId?: string
  /** The overrides that were in effect when this turn was sent. */
  overrides?: AskOverrides | null
  /** Per-stage timing/phase data, populated by the SSE stream. */
  stages?: Record<StageName, StageState>
  /** Total wall-clock ms for the request, populated on the final done event. */
  totalMs?: number
}

interface Props {
  turn: InspectableTurn | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TurnInspectorSheet({ turn, open, onOpenChange }: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Sparkles className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="line-clamp-2 text-[15px] font-semibold leading-[1.35]">
                Turn inspector
              </SheetTitle>
              {turn?.threadId && (
                <SheetDescription className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  thread {turn.threadId}
                </SheetDescription>
              )}
            </div>
          </div>
          {turn && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[10.5px]">
                turn #{turn.id}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {turn.used} of {turn.retrieved} chunks
              </Badge>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {turn.citations.length} citation
                {turn.citations.length === 1 ? "" : "s"}
              </Badge>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-5">
            {turn && (
              <>
                {turn.stages && (
                  <Section
                    icon={<Clock className="size-3.5" strokeWidth={2} />}
                    label={
                      turn.totalMs !== undefined
                        ? `Pipeline · ${formatMs(turn.totalMs)} total`
                        : "Pipeline"
                    }
                  >
                    <PipelineTimeline
                      stages={turn.stages}
                      totalMs={turn.totalMs}
                    />
                  </Section>
                )}

                <Section
                  icon={<User className="size-3.5" strokeWidth={2} />}
                  label="Question"
                >
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-[13.5px] leading-[1.55]">
                    {turn.question}
                  </p>
                </Section>

                <Section
                  icon={<Bot className="size-3.5" strokeWidth={2} />}
                  label="Answer"
                >
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] leading-[1.55] whitespace-pre-wrap">
                    {turn.answer || (
                      <span className="italic text-muted-foreground">(empty answer)</span>
                    )}
                  </div>
                </Section>

                {turn.overrides && (
                  <Section
                    icon={<Hash className="size-3.5" strokeWidth={2} />}
                    label="Overrides used"
                  >
                    <OverridesList overrides={turn.overrides} />
                  </Section>
                )}

                <Section
                  icon={<FileText className="size-3.5" strokeWidth={2} />}
                  label={`Citations (${turn.citations.length})`}
                >
                  {turn.citations.length === 0 ? (
                    <p className="text-[12.5px] italic text-muted-foreground">
                      No citations attached to this turn.
                    </p>
                  ) : (
                    <ol className="space-y-2">
                      {turn.citations.map((c, i) => (
                        <li
                          key={c.chunk_id + i}
                          className="rounded-lg border border-border bg-card p-3"
                        >
                          <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
                            <span className="font-mono font-semibold text-primary">
                              [{i + 1}]
                            </span>
                            <span className="truncate font-medium text-foreground">
                              {c.title || "untitled"}
                            </span>
                            {c.page !== null && c.page !== undefined && (
                              <span className="font-mono tabular-nums">p.{c.page}</span>
                            )}
                            <span className="ml-auto font-mono tabular-nums">
                              {c.score.toFixed(3)}
                            </span>
                          </div>
                          <p className="mt-1.5 text-[12.5px] leading-[1.55] text-muted-foreground line-clamp-5">
                            {c.snippet}
                          </p>
                          {c.source_uri?.startsWith("http") && (
                            <a
                              href={c.source_uri}
                              target="_blank"
                              rel="noreferrer"
                              className="mt-2 inline-flex items-center gap-1 font-mono text-[11px] text-primary hover:underline"
                            >
                              {c.source_uri}
                              <ExternalLink className="size-3" strokeWidth={2} />
                            </a>
                          )}
                        </li>
                      ))}
                    </ol>
                  )}
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function Section({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      {children}
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────
// Pipeline timeline — vertical list of nodes with duration + bar
//
// The bar width is proportional to the stage's share of total elapsed time,
// making the slow leg visually obvious. When totalMs is unknown (e.g. for
// turns rehydrated from the thread history that don't carry timings) we
// fall back to the max single-stage value so the layout still works.
// ─────────────────────────────────────────────────────────────────

const STAGE_ROW_META: Record<StageName, { label: string; description: string }> = {
  retrieve_local: {
    label: "Retrieve",
    description: "Milvus hybrid (dense + BM25) + Neo4j graph local search, fused via RRF.",
  },
  rerank: {
    label: "Rerank",
    description: "Cross-encoder reranks the candidate pool down to k_rerank.",
  },
  generate: {
    label: "Generate",
    description: "LLM synthesises a cited answer from the reranked context.",
  },
}

function PipelineTimeline({
  stages,
  totalMs,
}: {
  stages: Record<StageName, StageState>
  totalMs?: number
}) {
  const order: StageName[] = ["retrieve_local", "rerank", "generate"]
  const known = order
    .map((n) => stages[n]?.elapsedMs ?? 0)
    .filter((v) => v > 0)
  const max = Math.max(totalMs ?? 0, ...known, 1)
  return (
    <ol className="space-y-1.5">
      {order.map((name) => {
        const stage = stages[name]
        const meta = STAGE_ROW_META[name]
        const elapsed = stage.elapsedMs
        const widthPct =
          typeof elapsed === "number" && max > 0
            ? Math.max(1, Math.min(100, Math.round((elapsed / max) * 100)))
            : 0
        const isDone = stage.phase === "done"
        const isRunning = stage.phase === "running"
        return (
          <li
            key={name}
            className="rounded-lg border border-border bg-card px-3 py-2"
          >
            <div className="flex items-baseline gap-2 text-[12.5px]">
              <span
                aria-hidden
                className={cn(
                  "inline-flex size-5 shrink-0 items-center justify-center rounded-full",
                  isDone && "bg-primary/15 text-primary",
                  isRunning && "bg-primary/15 text-primary",
                  !isDone && !isRunning && "bg-muted text-muted-foreground",
                )}
              >
                {isDone ? <Check className="size-3" /> : <Clock className="size-3" />}
              </span>
              <span className="font-medium text-foreground">{meta.label}</span>
              <span className="ml-auto font-mono text-[11.5px] tabular-nums">
                {typeof elapsed === "number" ? formatMs(elapsed) : "—"}
              </span>
            </div>
            <p className="ml-7 mt-0.5 text-[11.5px] leading-[1.4] text-muted-foreground">
              {meta.description}
            </p>
            <div
              aria-hidden
              className="ml-7 mt-2 h-1 overflow-hidden rounded-full bg-muted"
            >
              <div
                className={cn(
                  "h-full rounded-full transition-[width] duration-200",
                  isRunning ? "bg-primary/60" : "bg-primary",
                )}
                style={{ width: `${widthPct}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function formatMs(n: number): string {
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(2)}s`
}

function OverridesList({ overrides }: { overrides: AskOverrides }) {
  const rows: Array<[string, string]> = []
  if (overrides.model) rows.push(["model", overrides.model])
  if (overrides.retrieve_top_k != null)
    rows.push(["retrieve_top_k", String(overrides.retrieve_top_k)])
  if (overrides.rerank_top_k != null)
    rows.push(["rerank_top_k", String(overrides.rerank_top_k)])
  if (overrides.enable_graph_retrieval != null)
    rows.push(["enable_graph_retrieval", overrides.enable_graph_retrieval ? "on" : "off"])
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] italic text-muted-foreground">
        Server defaults (no per-question overrides).
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-y-1.5 text-[12.5px]">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono tabular-nums">{v}</dd>
        </div>
      ))}
    </dl>
  )
}
