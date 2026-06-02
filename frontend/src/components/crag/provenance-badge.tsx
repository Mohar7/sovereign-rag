import { RotateCcw } from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// ProvenanceBadge
//
// "↻ corrected via web" pill shown on the answer meta line when
// the answer was corrected via web fallback.
// ─────────────────────────────────────────────────────────────────

export interface ProvenanceBadgeProps {
  className?: string
}

export function ProvenanceBadge({ className }: ProvenanceBadgeProps) {
  const { t } = useTranslation()
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border",
        "bg-primary/10 text-primary border-primary/28",
        "h-5 px-2 text-[11.5px] font-medium font-mono leading-none whitespace-nowrap",
        className,
      )}
    >
      <RotateCcw className="size-[11px] shrink-0" />
      {t("crag.correctedViaWeb")}
    </span>
  )
}
