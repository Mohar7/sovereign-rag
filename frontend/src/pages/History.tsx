import { useMemo, useState } from "react"
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Filter,
  History as HistoryIcon,
  MessageSquare,
  RefreshCw,
  Search,
  X,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { useRunsList } from "@/hooks/use-runs"
import type { CitationModel, RunRow } from "@/lib/api"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Run history
//
// Renders /api/runs as a TanStack-style audit log: one row per /ask, with
// per-stage timings + status + model badge, expandable to reveal the full
// citation list, applied overrides, and the raw error trace on failures.
// ─────────────────────────────────────────────────────────────────

type StatusFilter = "all" | "ok" | "error"

export function HistoryPage() {
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<StatusFilter>("all")
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const runs = useRunsList(100)

  const filtered = useMemo(() => {
    const all = runs.data ?? []
    const q = search.trim().toLowerCase()
    return all.filter((r) => {
      if (status !== "all" && r.status !== status) return false
      if (!q) return true
      return (
        r.question.toLowerCase().includes(q) ||
        (r.answer ?? "").toLowerCase().includes(q) ||
        (r.model ?? "").toLowerCase().includes(q) ||
        r.thread_id.toLowerCase().includes(q)
      )
    })
  }, [runs.data, search, status])

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const totalCount = (runs.data ?? []).length
  const errCount = (runs.data ?? []).filter((r) => r.status === "error").length
  const okCount = totalCount - errCount

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 w-full overflow-hidden">
      {/* left rail: stats + filters */}
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-border bg-background lg:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <HistoryIcon className="size-3.5 text-muted-foreground" strokeWidth={2} />
            Run history
          </div>
          <p className="mt-2 font-mono text-[11px] leading-[1.55] text-muted-foreground">
            {totalCount.toLocaleString()} runs · {okCount.toLocaleString()} ok ·{" "}
            <span className={errCount > 0 ? "text-destructive" : ""}>
              {errCount.toLocaleString()} errors
            </span>
          </p>
        </div>
        <div className="space-y-3 border-b border-border px-4 py-3">
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              search
            </div>
            <div className="relative mt-1">
              <Search
                className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                strokeWidth={2}
              />
              <Input
                placeholder="question, answer, model, id…"
                className="pl-8 h-8 text-[13px]"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search && (
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3" strokeWidth={2} />
                </button>
              )}
            </div>
          </div>
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              status
            </div>
            <div className="mt-1 flex gap-1.5">
              {(["all", "ok", "error"] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatus(s)}
                  className={cn(
                    "inline-flex h-7 items-center rounded-full border px-2.5 font-mono text-[11px]",
                    status === s
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-card hover:bg-muted",
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-auto border-t border-border px-4 py-3 text-[11px] text-muted-foreground">
          <p className="leading-[1.55]">
            Every <span className="font-mono">/ask</span> writes one row.
            Errors are kept too — useful for tracking down model failures or
            retrieval misses.
          </p>
        </div>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Run history</h1>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {runs.isLoading
              ? "loading…"
              : `${filtered.length} of ${totalCount}`}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => void runs.refetch()}
          >
            <RefreshCw
              className={cn("size-3.5", runs.isFetching && "animate-spin")}
              strokeWidth={2}
            />
            Refresh
          </Button>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          {runs.isLoading ? (
            <div className="space-y-1.5 p-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="h-14 w-full rounded-md" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <EmptyState totalCount={totalCount} hasQuery={search.length > 0 || status !== "all"} />
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((r) => (
                <RunRowItem
                  key={r.id}
                  run={r}
                  expanded={expanded.has(r.id)}
                  onToggle={() => toggle(r.id)}
                />
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>
    </div>
  )
}

function EmptyState({ totalCount, hasQuery }: { totalCount: number; hasQuery: boolean }) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
      <span className="inline-flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <Filter className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="text-[16px] font-semibold text-foreground">
        {hasQuery ? "Nothing matches" : "No runs yet"}
      </h2>
      <p className="text-[13px] leading-[1.55] text-muted-foreground">
        {hasQuery
          ? `${totalCount} run${totalCount === 1 ? "" : "s"} indexed, but none match the current filter.`
          : "Runs appear here after you ask a question from the Ask page."}
      </p>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Row
// ─────────────────────────────────────────────────────────────────

function RunRowItem({
  run,
  expanded,
  onToggle,
}: {
  run: RunRow
  expanded: boolean
  onToggle: () => void
}) {
  const isError = run.status === "error"
  const total = run.timings?.total
  const created = run.created_at
    ? new Date(run.created_at).toLocaleString(undefined, {
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—"

  const openThread = (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = `/?thread=${encodeURIComponent(run.thread_id)}`
    window.history.pushState({}, "", url)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          "flex w-full items-start gap-3 px-6 py-3 text-left transition-colors",
          "hover:bg-muted/30 focus-visible:outline-none focus-visible:bg-muted/40",
        )}
      >
        <span className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-muted-foreground">
          {expanded ? (
            <ChevronDown className="size-3.5" strokeWidth={2} />
          ) : (
            <ChevronRight className="size-3.5" strokeWidth={2} />
          )}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13.5px]">
            <span
              className={cn(
                "inline-flex size-5 shrink-0 items-center justify-center rounded-md",
                isError
                  ? "bg-destructive/15 text-destructive"
                  : "bg-primary/10 text-primary",
              )}
            >
              {isError ? (
                <AlertCircle className="size-3" strokeWidth={2} />
              ) : (
                <MessageSquare className="size-3" strokeWidth={2} />
              )}
            </span>
            <span className="truncate font-medium text-foreground">{run.question}</span>
            <Badge
              variant={isError ? "outline" : "secondary"}
              className={cn(
                "ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wide",
                isError && "border-destructive/40 text-destructive",
              )}
            >
              {run.status}
            </Badge>
          </div>

          <div className="ml-7 mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span>{created}</span>
            {run.model && (
              <>
                <span aria-hidden>·</span>
                <span className="text-foreground/80">{run.model}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatMs(total)}</span>
            <span aria-hidden>·</span>
            <span>
              {run.used} of {run.retrieved} chunks
            </span>
            <span aria-hidden>·</span>
            <button
              type="button"
              onClick={openThread}
              className="truncate text-primary hover:underline"
            >
              {run.thread_id.slice(0, 8)}
            </button>
          </div>
        </div>
      </button>

      {expanded && <RunRowDetail run={run} />}
    </li>
  )
}

function RunRowDetail({ run }: { run: RunRow }) {
  const stageRows: Array<[string, number | undefined]> = [
    ["retrieve_local", run.timings?.retrieve_local],
    ["rerank", run.timings?.rerank],
    ["generate", run.timings?.generate],
    ["total", run.timings?.total],
  ]
  return (
    <div className="border-l-2 border-primary/30 bg-muted/20 px-6 py-4">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* timings */}
        <Section label="Pipeline timings">
          <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[12px]">
            {stageRows.map(([label, ms]) => (
              <div key={label} className="contents">
                <dt
                  className={cn(
                    "text-muted-foreground",
                    label === "total" && "font-medium text-foreground",
                  )}
                >
                  {label}
                </dt>
                <dd
                  className={cn(
                    "font-mono tabular-nums",
                    label === "total" && "font-medium text-foreground",
                  )}
                >
                  {formatMs(ms)}
                </dd>
              </div>
            ))}
          </dl>
        </Section>

        {/* overrides */}
        <Section label="Overrides used">
          <OverridesBlock overrides={run.overrides} />
        </Section>
      </div>

      {/* answer */}
      <Section label="Answer">
        <div className="rounded-lg border border-border bg-card px-3 py-2 text-[12.5px] leading-[1.55] whitespace-pre-wrap">
          {run.answer || (
            <span className="italic text-muted-foreground">(no answer)</span>
          )}
        </div>
      </Section>

      {/* citations */}
      {run.citations.length > 0 && (
        <Section label={`Citations · ${run.citations.length}`}>
          <CitationsList citations={run.citations} />
        </Section>
      )}

      {/* error trace */}
      {run.error && (
        <Section label="Error">
          <pre className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-[11.5px] leading-[1.45] text-destructive whitespace-pre-wrap">
            {run.error}
          </pre>
        </Section>
      )}
    </div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-3 first:mt-0">
      <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      {children}
    </section>
  )
}

function OverridesBlock({
  overrides,
}: {
  overrides: Record<string, unknown> | null
}) {
  if (!overrides || Object.keys(overrides).length === 0) {
    return (
      <p className="text-[12px] italic text-muted-foreground">
        Server defaults (no overrides).
      </p>
    )
  }
  return (
    <dl className="grid grid-cols-[140px_1fr] gap-y-1 text-[12px]">
      {Object.entries(overrides).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-mono tabular-nums break-all">{formatOverride(v)}</dd>
        </div>
      ))}
    </dl>
  )
}

function CitationsList({ citations }: { citations: CitationModel[] }) {
  return (
    <ol className="space-y-1.5">
      {citations.map((c, i) => (
        <li
          key={(c.chunk_id || "") + i}
          className="rounded-md border border-border bg-card px-3 py-1.5"
        >
          <div className="flex items-baseline gap-2 text-[12px]">
            <span className="font-mono font-semibold text-primary">[{i + 1}]</span>
            <span className="truncate font-medium text-foreground">{c.title || "untitled"}</span>
            {c.page !== null && c.page !== undefined && (
              <span className="font-mono tabular-nums text-muted-foreground">p.{c.page}</span>
            )}
            <span className="ml-auto font-mono tabular-nums text-muted-foreground">
              {c.score.toFixed(3)}
            </span>
          </div>
          {c.snippet && (
            <p className="mt-1 line-clamp-2 text-[11.5px] leading-[1.5] text-muted-foreground">
              {c.snippet}
            </p>
          )}
        </li>
      ))}
    </ol>
  )
}

function formatMs(n: number | undefined): string {
  if (n === undefined || n === null) return "—"
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(2)}s`
}

function formatOverride(v: unknown): string {
  if (typeof v === "boolean") return v ? "on" : "off"
  if (v === null || v === undefined) return "—"
  return String(v)
}
