import { BarChart3, Loader2, RefreshCw, Target, TrendingUp, Zap } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useEvalsLatest } from "@/hooks/use-evals"
import type { EvalsPerQuestion, EvalsResults } from "@/lib/api"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Evals dashboard
//
// Surfaces eval/results.json: 4 stat cards (precision@5, recall@5,
// nDCG@5, MRR) + a per-question retrieval table + a RAGAS panel on the
// right showing faithfulness / relevancy / context-recall.
// ─────────────────────────────────────────────────────────────────

export function EvalsPage() {
  const evals = useEvalsLatest()

  if (evals.isLoading) {
    return (
      <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        <span className="ml-2 text-[13px]">loading evals…</span>
      </div>
    )
  }

  const data = evals.data
  if (!data || !data.available) {
    return <EmptyState onRefresh={() => void evals.refetch()} />
  }

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Evals</h1>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {data.retrieval.per_question.length} questions · k={data.k} · mode={data.mode}
          </span>
          {data.generated_at && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {new Date(data.generated_at).toLocaleString()}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => void evals.refetch()}
          >
            <RefreshCw
              className={cn("size-3.5", evals.isFetching && "animate-spin")}
              strokeWidth={2}
            />
            Refresh
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-6 space-y-6">
            <StatCards data={data} />
            <PerQuestionTable rows={data.retrieval.per_question} />
            <RagasFootnote data={data} />
          </div>
        </ScrollArea>
      </div>

      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background xl:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <BarChart3 className="size-3.5 text-muted-foreground" strokeWidth={2} />
            RAGAS scores
          </div>
          <p className="mt-1 text-[11px] leading-[1.55] text-muted-foreground">
            Answer-quality metrics from the RAGAS framework, computed once per
            eval run using the gpt-5 / gpt-4o judge model.
          </p>
        </div>
        <ScrollArea className="min-h-0 flex-1">
          <div className="p-4 space-y-4">
            <RagasPanel data={data} />
            <DatasetPanel data={data} />
          </div>
        </ScrollArea>
      </aside>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Stat cards row
// ─────────────────────────────────────────────────────────────────

function StatCards({ data }: { data: EvalsResults }) {
  const agg = data.retrieval.aggregate
  const ragas = data.ragas.scores
  const cards: Array<{
    label: string
    value: number
    max: number
    icon: React.ComponentType<{ className?: string }>
    tone: "indigo" | "emerald" | "amber" | "violet"
    hint?: string
  }> = [
    {
      label: "precision@5",
      value: agg["precision@5"] ?? 0,
      max: 1,
      icon: Target,
      tone: "indigo",
      hint: "share of retrieved chunks that were relevant",
    },
    {
      label: "recall@5",
      value: agg["recall@5"] ?? 0,
      max: 1,
      icon: TrendingUp,
      tone: "emerald",
      hint: "share of relevant chunks that were retrieved",
    },
    {
      label: "nDCG@5",
      value: agg["ndcg@5"] ?? 0,
      max: 2,
      icon: BarChart3,
      tone: "violet",
      hint: "rank-aware quality (the higher, the better)",
    },
    {
      label: "faithfulness",
      value: ragas.faithfulness ?? 0,
      max: 1,
      icon: Zap,
      tone: "amber",
      hint: "answer-vs-context grounding (RAGAS)",
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {cards.map((c) => {
        const pct = Math.max(0, Math.min(1, c.value / c.max))
        return (
          <Card key={c.label} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                <c.icon className="size-3.5" strokeWidth={2} />
                <span className="font-mono uppercase tracking-wide">{c.label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="font-mono text-[26px] font-semibold tabular-nums">
                  {c.value.toFixed(3)}
                </span>
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  / {c.max}
                </span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div
                  className={cn(
                    "h-full rounded-full",
                    c.tone === "indigo" && "bg-primary",
                    c.tone === "emerald" && "bg-emerald-500",
                    c.tone === "violet" && "bg-violet-500",
                    c.tone === "amber" && "bg-amber-500",
                  )}
                  style={{ width: `${pct * 100}%` }}
                />
              </div>
              {c.hint && (
                <p className="mt-2 text-[11px] leading-[1.4] text-muted-foreground">
                  {c.hint}
                </p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Per-question retrieval table
// ─────────────────────────────────────────────────────────────────

function PerQuestionTable({ rows }: { rows: EvalsPerQuestion[] }) {
  return (
    <section>
      <h2 className="mb-2 text-[14px] font-semibold">Per-question retrieval</h2>
      <p className="mb-3 text-[12px] leading-[1.55] text-muted-foreground">
        Metrics computed against the gold-label qa_pairs.json fixture for each
        question. Bars under each metric scale to its theoretical maximum.
      </p>
      <Card className="overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50%]">Question</TableHead>
              <TableHead className="text-right font-mono text-[10.5px] uppercase">
                p@5
              </TableHead>
              <TableHead className="text-right font-mono text-[10.5px] uppercase">
                r@5
              </TableHead>
              <TableHead className="text-right font-mono text-[10.5px] uppercase">
                mrr
              </TableHead>
              <TableHead className="text-right font-mono text-[10.5px] uppercase">
                nDCG@5
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow key={i}>
                <TableCell className="text-[13px]">{r.question}</TableCell>
                <ScoreCell value={r["precision@5"]} max={1} />
                <ScoreCell value={r["recall@5"]} max={1} />
                <ScoreCell value={r.mrr} max={1} />
                <ScoreCell value={r["ndcg@5"]} max={2} />
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </section>
  )
}

function ScoreCell({ value, max }: { value: number; max: number }) {
  const pct = Math.max(0, Math.min(1, value / max))
  return (
    <TableCell className="w-[110px] text-right">
      <div className="inline-flex flex-col items-end gap-1">
        <span className="font-mono text-[12.5px] tabular-nums">{value.toFixed(3)}</span>
        <span className="block h-1 w-20 overflow-hidden rounded-full bg-muted">
          <span
            className="block h-full rounded-full bg-primary"
            style={{ width: `${pct * 100}%` }}
          />
        </span>
      </div>
    </TableCell>
  )
}

// ─────────────────────────────────────────────────────────────────
// RAGAS panel + dataset panel (right rail)
// ─────────────────────────────────────────────────────────────────

function RagasPanel({ data }: { data: EvalsResults }) {
  const ragas = data.ragas
  if (!ragas.available) {
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-3 text-[12.5px] leading-[1.55] text-muted-foreground">
        RAGAS scores not available.{" "}
        {ragas.reason ? (
          <span className="font-mono">{ragas.reason}</span>
        ) : (
          "Set ``EVAL_SKIP_RAGAS=0`` in the next run."
        )}
      </div>
    )
  }
  const entries = Object.entries(ragas.scores)
  return (
    <ul className="space-y-2">
      {entries.map(([k, v]) => (
        <li key={k} className="rounded-lg border border-border bg-card p-3">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="font-medium text-foreground">{k.replaceAll("_", " ")}</span>
            <span className="font-mono tabular-nums">{v.toFixed(3)}</span>
          </div>
          <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.max(0, Math.min(1, v)) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}

function DatasetPanel({ data }: { data: EvalsResults }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3 text-[12px]">
      <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
        dataset
      </div>
      <dl className="mt-2 grid grid-cols-[110px_1fr] gap-y-1.5">
        <dt className="text-muted-foreground">questions</dt>
        <dd className="font-mono tabular-nums">{data.retrieval.per_question.length}</dd>
        <dt className="text-muted-foreground">k</dt>
        <dd className="font-mono tabular-nums">{data.k}</dd>
        <dt className="text-muted-foreground">mode</dt>
        <dd className="font-mono">{data.mode}</dd>
        {data.path && (
          <>
            <dt className="text-muted-foreground">source</dt>
            <dd className="break-all font-mono text-[11px]">{data.path}</dd>
          </>
        )}
      </dl>
    </div>
  )
}

function RagasFootnote({ data }: { data: EvalsResults }) {
  if (data.ragas.available || !data.ragas.reason) return null
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/30 p-3 text-[12px]">
      <Badge variant="outline" className="font-mono text-[10px]">
        RAGAS skipped
      </Badge>
      <p className="mt-1.5 text-muted-foreground">{data.ragas.reason}</p>
    </div>
  )
}

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] flex-col items-center justify-center gap-3 text-center text-muted-foreground">
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted">
        <BarChart3 className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="text-[16px] font-semibold text-foreground">No eval results yet</h2>
      <p className="max-w-md text-[13px] leading-[1.55]">
        Run <code className="font-mono">uv run python -m eval.evaluate</code>{" "}
        to populate <code className="font-mono">eval/results.json</code>. This
        page refreshes from that file on every visit.
      </p>
      <Button variant="outline" size="sm" className="mt-1 gap-1.5" onClick={onRefresh}>
        <RefreshCw className="size-3.5" /> Check again
      </Button>
    </div>
  )
}
