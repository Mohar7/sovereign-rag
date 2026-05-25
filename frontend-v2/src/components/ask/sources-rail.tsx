import {
  Box,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  Share2,
  Sparkles,
  type LucideIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import type { CitationKind } from "./citation-chip"

export interface SourceItem {
  n: number
  kind: CitationKind
  title: string
  doc: string
  page?: number
  score: number
  snippet: string
  used: boolean
}

const KIND_ICON: Record<CitationKind, LucideIcon> = {
  hybrid: Sparkles,
  graph: Share2,
  vector: Box,
  web: Globe,
}

const KIND_LABEL: Record<CitationKind, string> = {
  hybrid: "hybrid",
  graph: "graph",
  vector: "vector",
  web: "web",
}

function SourceCard({ s }: { s: SourceItem }) {
  const Icon = KIND_ICON[s.kind]
  return (
    <button
      type="button"
      className={cn(
        "group relative w-full rounded-lg border border-border bg-card p-3 text-left transition-colors duration-[120ms]",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "inline-flex size-5 items-center justify-center rounded-[4px] bg-primary/10 text-primary",
          )}
        >
          <Icon className="size-3" strokeWidth={2} />
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[s.kind]}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">·</span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
          [{s.n}]
        </span>
        <span className="ml-auto font-mono text-[10.5px] tabular-nums text-foreground/80">
          {s.score.toFixed(2)}
        </span>
      </div>
      <div className="mt-2 line-clamp-2 text-[13.5px] font-medium leading-[1.4] text-foreground">
        {s.title}
      </div>
      <p className="mt-1.5 line-clamp-3 text-[12.5px] leading-[1.55] text-muted-foreground">
        {s.snippet}
      </p>
      <div className="mt-2.5 flex items-center gap-2 text-[11px] text-muted-foreground">
        <FileText className="size-3 opacity-70" strokeWidth={2} />
        <span className="truncate font-mono">{s.doc}</span>
        {s.page !== undefined && (
          <>
            <span aria-hidden>·</span>
            <span className="font-mono tabular-nums">p.{s.page}</span>
          </>
        )}
        {s.used && (
          <span className="ml-auto rounded-[2px] bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
            used
          </span>
        )}
      </div>
      <div
        aria-hidden
        className="mt-2 h-1 rounded-full bg-muted overflow-hidden"
      >
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round(s.score * 100)}%` }}
        />
      </div>
    </button>
  )
}

export interface SourcesRailProps {
  sources?: SourceItem[]
  loading?: boolean
  title?: string
  subtitle?: string
}

export function SourcesRail({
  sources = [],
  loading = false,
  title = "Sources",
  subtitle,
}: SourcesRailProps) {
  return (
    <aside className="hidden w-[360px] shrink-0 flex-col border-l border-border bg-background lg:flex">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
          {title}
        </h2>
        {subtitle && (
          <span className="font-mono text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label="filter sources">
            <Filter className="size-3.5" strokeWidth={2} />
          </Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label="open inspector">
            <ExternalLink className="size-3.5" strokeWidth={2} />
          </Button>
        </span>
      </div>
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-2 p-3">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-5 rounded" />
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="ml-auto h-3 w-8" />
                  </div>
                  <Skeleton className="mt-2 h-3.5 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-full" />
                  <Skeleton className="mt-1 h-3 w-5/6" />
                </div>
              ))
            : sources.map((s) => <SourceCard key={s.n} s={s} />)}
        </div>
      </ScrollArea>
    </aside>
  )
}
