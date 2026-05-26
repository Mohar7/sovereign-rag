import { ArrowUpRight, Box, Globe, Share2, Sparkles, type LucideIcon } from "lucide-react"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

export type CitationKind = "hybrid" | "graph" | "vector" | "web"

const KIND_META: Record<CitationKind, { icon: LucideIcon; label: string }> = {
  hybrid: { icon: Sparkles, label: "hybrid" },
  graph: { icon: Share2, label: "graph" },
  vector: { icon: Box, label: "vector" },
  web: { icon: Globe, label: "web" },
}

export interface CitationChipProps {
  n: number
  kind?: CitationKind
  doc?: string
  page?: number
  snippet?: string
  className?: string
  /**
   * If provided, the popover footer becomes a real button that opens the
   * full source detail (the same drawer the Library uses). Without it the
   * chip is preview-only — keeps the docs-page / states.tsx demo content
   * from accidentally implying an action when there isn't one wired up.
   */
  onOpen?: () => void
}

export function CitationChip({
  n,
  kind = "hybrid",
  doc,
  page,
  snippet,
  className,
  onOpen,
}: CitationChipProps) {
  const { icon: Icon, label } = KIND_META[kind]
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex items-baseline gap-1 align-baseline",
            "px-1.5 py-0.5 mx-0.5 rounded-[2px]",
            "text-[11px] font-mono leading-none tabular-nums",
            "bg-primary/10 text-primary",
            "border border-primary/20",
            "transition-colors duration-[120ms]",
            "hover:bg-primary/15 hover:border-primary/30",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            className,
          )}
        >
          <Icon className="size-3 self-center text-primary" strokeWidth={2} />
          <span className="font-semibold">{n}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={8} className="w-80 p-3">
        <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-wide text-muted-foreground">
          <Icon className="size-3.5 text-primary" />
          <span>{label}</span>
          <span aria-hidden>·</span>
          <span>citation [{n}]</span>
        </div>
        {doc && (
          <div className="mt-2 text-sm font-medium text-foreground">
            {doc}
            {page !== undefined && (
              <span className="ml-2 text-xs font-mono text-muted-foreground">
                p.{page}
              </span>
            )}
          </div>
        )}
        {snippet && (
          <p className="mt-2 text-sm leading-[1.55] text-muted-foreground line-clamp-5">
            {snippet}
          </p>
        )}
        {onOpen ? (
          <button
            type="button"
            onClick={onOpen}
            className={cn(
              "mt-3 flex w-full items-center justify-between border-t border-border/60 pt-2",
              "font-mono text-xs text-muted-foreground transition-colors",
              "hover:text-primary focus-visible:text-primary",
              "focus-visible:outline-none",
            )}
          >
            <span>open in source detail</span>
            <ArrowUpRight className="size-3.5" strokeWidth={2} />
          </button>
        ) : (
          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2 text-xs text-muted-foreground">
            <span className="font-mono">open in source detail</span>
            <kbd className="font-mono">↵</kbd>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function MonoTag({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <code
      className={cn(
        "inline-flex items-baseline rounded-[2px] border border-border bg-muted/60",
        "px-1.5 py-0.5 mx-0.5 text-[12px] font-mono leading-none text-foreground",
        "tabular-nums",
        className,
      )}
    >
      {children}
    </code>
  )
}
