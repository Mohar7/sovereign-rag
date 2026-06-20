import { Bot, Box, Clock, ExternalLink, FileText, Globe, Hash, Search, Sparkles, User } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { RetrievalSection } from "@/components/ask/retrieval-section"
import { formatCount, formatDecimal } from "@/lib/format"
import type { AskOverrides, CitationModel, RetrievalTrace } from "@/lib/api"

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
  /** Ordered agent tool steps (ReAct mode). */
  agentSteps?: { tool: string }[]
  /** Total wall-clock ms for the request, populated on the final done event. */
  totalMs?: number
  /** Per-leg + rerank provenance for this turn (inspector overlay). */
  retrieval?: RetrievalTrace
}

interface Props {
  turn: InspectableTurn | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function TurnInspectorSheet({ turn, open, onOpenChange }: Props) {
  const { t } = useTranslation()
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
                {t("pages.ask.inspector.title")}
              </SheetTitle>
              {turn?.threadId && (
                <SheetDescription className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {t("pages.ask.inspector.threadLabel", { id: turn.threadId })}
                </SheetDescription>
              )}
            </div>
          </div>
          {turn && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[10.5px]">
                {t("pages.ask.inspector.turnBadge", { id: turn.id })}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {t("pages.ask.chunksUsed", {
                  used: formatCount(turn.used),
                  total: formatCount(turn.retrieved),
                })}
              </Badge>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {t("pages.ask.inspector.citationsBadge", { count: turn.citations.length })}
              </Badge>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {turn && (
              <>
                {/* Tool trace — shows agent steps + totalMs */}
                {((turn.agentSteps && turn.agentSteps.length > 0) || turn.totalMs !== undefined) && (
                  <Section
                    icon={<Clock className="size-3.5" strokeWidth={2} />}
                    label={
                      turn.totalMs !== undefined
                        ? t("pages.ask.inspector.pipelineTotal", {
                            total: formatMs(turn.totalMs),
                          })
                        : t("pages.ask.inspector.pipeline")
                    }
                  >
                    <AgentToolTrace steps={turn.agentSteps ?? []} />
                  </Section>
                )}

                {turn.retrieval && <RetrievalSection trace={turn.retrieval} />}

                <Section
                  icon={<User className="size-3.5" strokeWidth={2} />}
                  label={t("pages.ask.inspector.question")}
                >
                  <p className="rounded-lg bg-muted/40 px-3 py-2 text-[13.5px] leading-[1.55]">
                    {turn.question}
                  </p>
                </Section>

                <Section
                  icon={<Bot className="size-3.5" strokeWidth={2} />}
                  label={t("pages.ask.inspector.answer")}
                >
                  <div className="rounded-lg border border-border bg-card px-3 py-2 text-[13.5px] leading-[1.55] whitespace-pre-wrap">
                    {turn.answer || (
                      <span className="italic text-muted-foreground">{t("pages.ask.inspector.emptyAnswer")}</span>
                    )}
                  </div>
                </Section>

                {turn.overrides && (
                  <Section
                    icon={<Hash className="size-3.5" strokeWidth={2} />}
                    label={t("pages.ask.inspector.overridesUsed")}
                  >
                    <OverridesList overrides={turn.overrides} />
                  </Section>
                )}

                <Section
                  icon={<FileText className="size-3.5" strokeWidth={2} />}
                  label={t("pages.ask.inspector.citationsLabel", {
                    count: turn.citations.length,
                  })}
                >
                  {turn.citations.length === 0 ? (
                    <p className="text-[12.5px] italic text-muted-foreground">
                      {t("pages.ask.inspector.noCitations")}
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
                              {c.title || t("common.untitled")}
                            </span>
                            {c.page !== null && c.page !== undefined && (
                              <span className="font-mono tabular-nums">p.{c.page}</span>
                            )}
                            <span className="ml-auto font-mono tabular-nums">
                              {formatDecimal(c.score, 3)}
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
// AgentToolTrace — compact ordered list of tool calls for the turn.
// Replaces the old CRAG PipelineTimeline.
// ─────────────────────────────────────────────────────────────────

const TOOL_ICON: Record<string, React.ComponentType<{ className?: string; strokeWidth?: number }>> = {
  SearchCorpus: Search,
  WebSearch: Globe,
  CrawlAndIndex: Box,
}

function AgentToolTrace({ steps }: { steps: { tool: string }[] }) {
  if (steps.length === 0) {
    return (
      <p className="text-[12.5px] italic text-muted-foreground">
        No tool calls recorded for this turn.
      </p>
    )
  }
  return (
    <ol className="space-y-1.5">
      {steps.map((s, i) => {
        const Icon = TOOL_ICON[s.tool] ?? Search
        return (
          <li
            key={i}
            className="flex items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-[12.5px]"
          >
            <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[10px] text-primary">
              {i + 1}
            </span>
            <Icon className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
            <span className="font-mono text-foreground">{s.tool}</span>
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
  const { t } = useTranslation()
  const rows: Array<[string, string]> = []
  if (overrides.model) rows.push(["model", overrides.model])
  if (overrides.retrieve_top_k != null)
    rows.push(["retrieve_top_k", String(overrides.retrieve_top_k)])
  if (overrides.rerank_top_k != null)
    rows.push(["rerank_top_k", String(overrides.rerank_top_k)])
  if (overrides.enable_graph_retrieval != null)
    rows.push([
      "enable_graph_retrieval",
      overrides.enable_graph_retrieval ? t("pages.ask.on") : t("pages.ask.off"),
    ])
  if (rows.length === 0) {
    return (
      <p className="text-[12.5px] italic text-muted-foreground">
        {t("pages.ask.inspector.serverDefaults")}
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
