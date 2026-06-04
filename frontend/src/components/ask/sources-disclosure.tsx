import { useState } from "react"
import { ChevronRight, Globe } from "lucide-react"
import { useTranslation } from "react-i18next"

import type { CitationModel } from "@/lib/api"
import { pickKind } from "@/lib/citation-kind"
import { cn } from "@/lib/utils"
import i18n from "@/lib/i18n"

/**
 * Inline "Used N sources" disclosure beneath an answer. Collapsed by default;
 * expands to a compact citation list. Replaces the persistent SourcesRail.
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
    <div className="mt-3 text-[12px]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 font-mono text-muted-foreground hover:text-foreground"
      >
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} strokeWidth={2} />
        {t("pages.ask.usedSources", { count: citations.length })}
      </button>
      {open && (
        <ol className="mt-2 flex flex-col gap-1.5">
          {citations.map((c, i) => {
            const web = pickKind(c) === "web"
            return (
              <li key={c.chunk_id}>
                <button
                  type="button"
                  onClick={() => onOpenSource?.(c)}
                  disabled={!onOpenSource}
                  className="flex w-full items-baseline gap-2 rounded-sm px-1.5 py-1 text-left hover:bg-muted disabled:hover:bg-transparent"
                >
                  <span className="font-mono font-semibold text-primary">[{i + 1}]</span>
                  {web && <Globe className="size-3 shrink-0 self-center text-muted-foreground" strokeWidth={2} />}
                  <span className="truncate font-medium text-foreground">
                    {c.title || i18n.t("common.untitled")}
                  </span>
                  <span className="ml-auto shrink-0 font-mono tabular-nums text-muted-foreground">
                    {c.score.toFixed(2)}
                  </span>
                </button>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
