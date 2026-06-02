// ─────────────────────────────────────────────────────────────────
// CRAG shared utilities (non-component code, pure functions + maps).
// Kept separate from component files so react-refresh/only-export-
// components doesn't flag them.
// ─────────────────────────────────────────────────────────────────

import { Box, Globe, Share2, Sparkles } from "lucide-react"
import type { LucideIcon } from "lucide-react"

/**
 * Format a confidence value as a 2-decimal string, using comma as
 * the decimal separator in Russian locale ("0,82") and dot elsewhere ("0.82").
 */
export function formatConfidence(value: number, lang: string): string {
  const fixed = value.toFixed(2)
  if (lang === "ru") return fixed.replace(".", ",")
  return fixed
}

/** Retrieval kind type — matches citation-chip.tsx CitationKind. */
export type SourceKind = "hybrid" | "graph" | "vector" | "web"

/**
 * Icon map: retrieval kind → Lucide icon.
 * Canonical: matches KIND_META in citation-chip.tsx — keep in sync.
 */
export const SOURCE_KIND_ICON: Record<SourceKind, LucideIcon> = {
  hybrid: Sparkles,
  graph: Share2,
  vector: Box,
  web: Globe,
}
