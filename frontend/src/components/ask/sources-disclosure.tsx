import { useState } from "react"
import { Box, ChevronDown, ChevronRight, Globe, Share2, Sparkles } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { CitationModel } from "@/lib/api"
import { pickKind } from "@/lib/citation-kind"
import i18n from "@/lib/i18n"
import { MonoTag } from "./citation-chip"

const KIND_ICON = {
  hybrid: Sparkles,
  graph: Share2,
  vector: Box,
  web: Globe,
} as const

/**
 * Inline "Used N sources" disclosure beneath an answer. Collapsed by default;
 * expands to a compact bordered citation list. Replaces the persistent SourcesRail.
 */
export function SourcesDisclosure({
  citations,
  onOpenSource,
}: {
  citations: CitationModel[]
  onOpenSource?: (c: CitationModel) => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  if (citations.length === 0) return null

  return (
    // design: marginTop 16
    <div style={{ marginTop: 16 }}>
      {/* Trigger — muted "Used N sources" with chevron + MonoTag */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "3px 8px 3px 6px",
          borderRadius: 6,
          cursor: "pointer",
          color: "var(--muted-foreground)",
          background: "transparent",
          border: "none",
        }}
        className="hover:[color:var(--foreground)]"
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        <MonoTag style={{ fontSize: 11.5 }}>
          {open ? t("pages.ask.sourcesTitle") : t("pages.ask.usedSources", { count: citations.length })}
        </MonoTag>
      </button>

      {/* Expanded bordered list */}
      {open && (
        <div
          style={{
            marginTop: 6,
            border: "1px solid var(--border)",
            borderRadius: 8,
            overflow: "hidden",
          }}
        >
          {citations.map((c, i) => {
            const kind = pickKind(c)
            const KIcon = KIND_ICON[kind] ?? Sparkles
            const web = kind === "web"
            return (
              <button
                key={c.chunk_id}
                type="button"
                onClick={() => onOpenSource?.(c)}
                disabled={!onOpenSource}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 11,
                  padding: "9px 12px",
                  width: "100%",
                  textAlign: "left",
                  background: "transparent",
                  border: "none",
                  cursor: onOpenSource ? "pointer" : "default",
                  borderBottom:
                    i < citations.length - 1
                      ? "1px solid color-mix(in oklab, var(--border) 55%, transparent)"
                      : "none",
                }}
                className="hover:[background:var(--muted)] disabled:hover:[background:transparent]"
              >
                {/* Rank chip [n] */}
                <span
                  style={{
                    minWidth: 18,
                    height: 17,
                    padding: "0 5px",
                    borderRadius: 3,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "color-mix(in oklab, var(--primary) 11%, transparent)",
                    color: "var(--primary)",
                    border: "1px solid color-mix(in oklab, var(--primary) 28%, transparent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    fontWeight: 600,
                    flexShrink: 0,
                  }}
                >
                  {i + 1}
                </span>

                {/* Kind icon */}
                <KIcon
                  size={13}
                  style={{ color: "var(--muted-foreground)", flexShrink: 0 }}
                  strokeWidth={2}
                />

                {/* Title (truncate) */}
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 500,
                    color: "var(--foreground)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  {c.title || i18n.t("common.untitled")}
                </span>

                {/* URI mono row with globe if web */}
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--muted-foreground)",
                    overflow: "hidden",
                    minWidth: 0,
                    maxWidth: 160,
                    flexShrink: 1,
                  }}
                >
                  {web && <Globe size={11} style={{ flexShrink: 0 }} strokeWidth={2} />}
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.source_uri}
                  </span>
                </span>

                {/* Score */}
                <MonoTag
                  style={{
                    fontSize: 11.5,
                    color: "var(--foreground)",
                    flexShrink: 0,
                    marginLeft: "auto",
                  }}
                >
                  {c.score.toFixed(2)}
                </MonoTag>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
