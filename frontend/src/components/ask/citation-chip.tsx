import { Box, FileText, Globe, Share2, Sparkles, type LucideIcon } from "lucide-react"

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
  /** Source URI — used to show globe/file icon and the uri string in the popover */
  uri?: string
  /** Relevance score — shown as `.toFixed(3)` in the popover */
  score?: number
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
  uri,
  score,
  className,
  onOpen,
}: CitationChipProps) {
  const { icon: KIcon, label } = KIND_META[kind]
  const isWeb = kind === "web" || (uri != null && /^https?:\/\//i.test(uri))

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Inline [n] chip — design: mono 10.5px, primary 11% bg, primary 28% border, radius 3 */}
        <button
          type="button"
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            minWidth: 17,
            height: 16,
            padding: "0 4px",
            marginLeft: 1,
            borderRadius: 3,
            background: "color-mix(in oklab, var(--primary) 11%, transparent)",
            color: "var(--primary)",
            border: "1px solid color-mix(in oklab, var(--primary) 28%, transparent)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 600,
            lineHeight: 1,
            verticalAlign: "1.5px",
            cursor: "default",
            fontVariantNumeric: "tabular-nums",
          }}
          className={cn(
            "transition-[background] duration-[120ms]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "hover:[background:color-mix(in_oklab,var(--primary)_20%,transparent)]",
            className,
          )}
        >
          {n}
        </button>
      </PopoverTrigger>

      {/* Popover — matches design: 268px wide, 12px padding, radius 8, shadow-lg */}
      <PopoverContent
        align="center"
        sideOffset={7}
        style={{
          width: 268,
          padding: 12,
          background: "var(--popover)",
          border: "1px solid var(--border)",
          borderRadius: 8,
          boxShadow: "var(--shadow-lg)",
        }}
        className="z-40"
      >
        {/* Header row: kind chip · kind MonoTag · spacer · score MonoTag */}
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 7 }}>
          {/* Kind + n chip */}
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              height: 17,
              padding: "0 5px",
              borderRadius: 3,
              background: "color-mix(in oklab, var(--primary) 11%, transparent)",
              color: "var(--primary)",
              border: "1px solid color-mix(in oklab, var(--primary) 28%, transparent)",
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
            }}
          >
            <KIcon size={10} />
            {n}
          </span>
          <MonoTag style={{ fontSize: 10.5 }}>{label}</MonoTag>
          <span style={{ flex: 1 }} />
          {score != null && (
            <MonoTag style={{ fontSize: 10.5, color: "var(--foreground)" }}>
              {score.toFixed(3)}
            </MonoTag>
          )}
        </div>

        {/* Bold title */}
        {doc && (
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-sans)",
              fontSize: 12.5,
              fontWeight: 600,
              color: "var(--foreground)",
              lineHeight: 1.35,
              marginBottom: 4,
            }}
          >
            {doc}
          </span>
        )}

        {/* Snippet */}
        {snippet && (
          <span
            style={{
              display: "block",
              fontFamily: "var(--font-sans)",
              fontSize: 12,
              color: "var(--muted-foreground)",
              lineHeight: 1.5,
              marginBottom: 7,
            }}
          >
            {snippet}
          </span>
        )}

        {/* URI row: globe/file icon + uri + · p{page} */}
        {(uri || page != null) && (
          <span
            style={{
              display: "flex",
              alignItems: "center",
              gap: 5,
              fontFamily: "var(--font-mono)",
              fontSize: 10.5,
              color: "var(--muted-foreground)",
            }}
          >
            {isWeb ? <Globe size={10} /> : <FileText size={10} />}
            {uri && (
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {uri}
              </span>
            )}
            {page != null && <span>· p{page}</span>}
          </span>
        )}

        {/* Open-in-source action (only when wired) */}
        {onOpen && (
          <button
            type="button"
            onClick={onOpen}
            style={{ marginTop: 8, display: "block", width: "100%" }}
            className={cn(
              "border-t border-border/60 pt-2",
              "font-mono text-[11px] text-muted-foreground text-left transition-colors",
              "hover:text-primary focus-visible:text-primary",
              "focus-visible:outline-none",
            )}
          >
            open in source detail
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

export function MonoTag({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <code
      style={style}
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
