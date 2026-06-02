import { CircleAlert, CircleCheck, CircleX } from "lucide-react"
import { useTranslation } from "react-i18next"
import type { LucideIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import type { GradeLabel } from "@/lib/api"
import { formatConfidence } from "./crag-utils"

// ─────────────────────────────────────────────────────────────────
// GradeChip
//
// Displays a grade label (correct / ambiguous / incorrect) with an icon,
// translated label, and an optional confidence score. Pops in on mount.
// ─────────────────────────────────────────────────────────────────

interface GradeMeta {
  icon: LucideIcon
  /** Tailwind color classes */
  bgClass: string
  borderClass: string
  textClass: string
}

const GRADE_META: Record<GradeLabel, GradeMeta> = {
  correct: {
    icon: CircleCheck,
    bgClass: "bg-success/10",
    borderClass: "border-success/35",
    textClass: "text-success",
  },
  ambiguous: {
    icon: CircleAlert,
    bgClass: "bg-warning/10",
    borderClass: "border-warning/35",
    textClass: "text-warning",
  },
  incorrect: {
    icon: CircleX,
    bgClass: "bg-destructive/10",
    borderClass: "border-destructive/35",
    textClass: "text-destructive",
  },
}

export interface GradeChipProps {
  label: GradeLabel
  confidence?: number | null
  /** "sm" (default) | "lg" */
  size?: "sm" | "lg"
  className?: string
}

export function GradeChip({
  label = "ambiguous",
  confidence,
  size = "sm",
  className,
}: GradeChipProps) {
  const { t, i18n } = useTranslation()
  const meta = GRADE_META[label] ?? GRADE_META.ambiguous
  const Icon = meta.icon
  const isLg = size === "lg"

  return (
    <span
      className={cn(
        "crag-gradechip",
        "inline-flex items-center gap-1 rounded-[6px] border font-semibold leading-none whitespace-nowrap",
        meta.bgClass,
        meta.borderClass,
        meta.textClass,
        isLg ? "h-7 px-[11px] text-[13px]" : "h-[22px] px-2 text-[12px]",
        className,
      )}
    >
      <Icon className={cn("shrink-0", isLg ? "size-[15px]" : "size-3")} />
      <span>{t(`crag.grade.${label}`)}</span>
      {confidence != null && (
        <>
          <span className="opacity-40 font-normal">·</span>
          <span className="font-mono font-semibold tabular-nums">
            {formatConfidence(confidence, i18n.language)}
          </span>
        </>
      )}
    </span>
  )
}
