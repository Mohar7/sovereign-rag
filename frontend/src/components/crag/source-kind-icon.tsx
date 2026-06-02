import { Globe } from "lucide-react"

import { cn } from "@/lib/utils"
import { SOURCE_KIND_ICON } from "./crag-utils"
import type { SourceKind } from "./crag-utils"

// ─────────────────────────────────────────────────────────────────
// SourceKindIcon
//
// Renders the retrieval-kind icon by ICON only (never colour).
// The icon map lives in crag-utils.ts and matches citation-chip.tsx.
// ─────────────────────────────────────────────────────────────────

export type { SourceKind }

export interface SourceKindIconProps {
  kind?: SourceKind
  className?: string
}

export function SourceKindIcon({
  kind = "web",
  className,
}: SourceKindIconProps) {
  const Icon = SOURCE_KIND_ICON[kind] ?? Globe
  return (
    <Icon
      className={cn("size-3 text-muted-foreground shrink-0", className)}
    />
  )
}
