import { useState } from "react"
import {
  Box,
  ChevronRight,
  ExternalLink,
  FileText,
  Filter,
  Globe,
  PanelRightClose,
  PanelRightOpen,
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

// ─────────────────────────────────────────────────────────────────
// SourceCard
//
// Layout rules:
// - The card is a block element. Every text row uses `min-w-0` on its flex
//   children so `truncate` / `line-clamp-*` actually engage (Tailwind's
//   default `min-w` for flex items is the *content* width, not 0).
// - The score chip + "used" pill sit on their own rows so the long doc URL
//   has the full card width to truncate against. Earlier layout had them
//   inline with the doc, which forced the row to grow past the card.
// ─────────────────────────────────────────────────────────────────

function SourceCard({ s }: { s: SourceItem }) {
  const Icon = KIND_ICON[s.kind]
  return (
    <button
      type="button"
      className={cn(
        "group block w-full overflow-hidden rounded-lg border border-border bg-card p-3 text-left",
        "transition-colors duration-[120ms]",
        "hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      {/* Row 1 — kind + ref number + score */}
      <div className="flex items-center gap-2">
        <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-[4px] bg-primary/10 text-primary">
          <Icon className="size-3" strokeWidth={2} />
        </span>
        <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {KIND_LABEL[s.kind]}
        </span>
        <span className="font-mono text-[10.5px] text-muted-foreground">·</span>
        <span className="font-mono text-[10.5px] tabular-nums text-muted-foreground">
          [{s.n}]
        </span>
        {s.used && (
          <span className="ml-auto rounded-[2px] bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-primary">
            used
          </span>
        )}
        <span
          className={cn(
            "shrink-0 font-mono text-[10.5px] tabular-nums text-foreground/80",
            s.used ? "" : "ml-auto",
          )}
        >
          {s.score.toFixed(2)}
        </span>
      </div>

      {/* Row 2 — title (max 2 lines, wraps + breaks long unspaced strings) */}
      <div className="mt-2 line-clamp-2 break-words text-[13.5px] font-medium leading-[1.4] text-foreground">
        {s.title}
      </div>

      {/* Row 3 — snippet (max 3 lines, wraps long unspaced strings) */}
      <p className="mt-1.5 line-clamp-3 break-words text-[12.5px] leading-[1.55] text-muted-foreground">
        {s.snippet}
      </p>

      {/* Row 4 — doc id + optional page. Whole row gets its own line so the
          truncated mono URL doesn't fight the page badge for space. */}
      <div className="mt-2.5 flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
        <FileText className="size-3 shrink-0 opacity-70" strokeWidth={2} />
        <span className="min-w-0 flex-1 truncate font-mono">{s.doc}</span>
        {s.page !== undefined && (
          <span className="shrink-0 font-mono tabular-nums">p.{s.page}</span>
        )}
      </div>

      {/* Row 5 — score bar */}
      <div aria-hidden className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.round(Math.max(0, Math.min(1, s.score)) * 100)}%` }}
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
  /** When true, the rail renders a compact collapsed strip with just a chevron. */
  defaultCollapsed?: boolean
}

export function SourcesRail({
  sources = [],
  loading = false,
  title = "Sources",
  subtitle,
  defaultCollapsed = false,
}: SourcesRailProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed)

  if (collapsed) {
    return (
      <aside className="hidden w-10 shrink-0 flex-col items-center border-l border-border bg-background py-2 lg:flex">
        <Button
          variant="ghost"
          size="icon"
          className="size-7"
          aria-label="expand sources"
          onClick={() => setCollapsed(false)}
        >
          <PanelRightOpen className="size-3.5" strokeWidth={2} />
        </Button>
        <span
          className="mt-1 select-none font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
          style={{ writingMode: "vertical-rl" }}
        >
          {title} · {sources.length}
        </span>
      </aside>
    )
  }

  return (
    <aside
      // Responsive width: 280px on small lg, 320px on lg, 360px on xl+. Keeps
      // the main column readable when the rail is open on narrower screens.
      className="hidden w-[280px] shrink-0 flex-col border-l border-border bg-background lg:flex xl:w-[320px] 2xl:w-[360px]"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle && (
          <span className="truncate font-mono text-[11px] text-muted-foreground">
            {subtitle}
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label="filter sources">
            <Filter className="size-3.5" strokeWidth={2} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            aria-label="collapse sources"
            onClick={() => setCollapsed(true)}
          >
            <PanelRightClose className="size-3.5" strokeWidth={2} />
          </Button>
        </span>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex min-w-0 flex-col gap-2 p-3">
          {loading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-border bg-card p-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="size-5 shrink-0 rounded" />
                    <Skeleton className="h-3 w-12" />
                    <Skeleton className="ml-auto h-3 w-8" />
                  </div>
                  <Skeleton className="mt-2 h-3.5 w-3/4" />
                  <Skeleton className="mt-1.5 h-3 w-full" />
                  <Skeleton className="mt-1 h-3 w-5/6" />
                </div>
              ))
            : sources.length === 0
              ? (
                <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-[12.5px] text-muted-foreground">
                  No sources for this turn.
                </div>
              )
              : sources.map((s) => <SourceCard key={`${s.n}-${s.doc}`} s={s} />)}
        </div>
      </ScrollArea>

      <div className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="inline-flex items-center gap-1 hover:text-foreground"
        >
          collapse
          <ChevronRight className="size-3" strokeWidth={2} />
        </button>
        <span className="ml-2 inline-flex items-center gap-1">
          <ExternalLink className="size-3" strokeWidth={2} />
          inspector opens per-turn details
        </span>
      </div>
    </aside>
  )
}
