import { useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { AlertCircle, Check, Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { useEmbedModels } from "@/hooks/use-settings"
import { api, type EmbedModel, type SettingsPatch } from "@/lib/api"
import { cn } from "@/lib/utils"

/**
 * Editable embedding-model picker. Changing the model is a *stateful migration*
 * (re-embeds the corpus), so selecting a new one stages a confirm banner; on
 * confirm we PATCH (the backend derives the dimension + kicks off the reindex)
 * and poll `/api/reindex/status` to completion.
 */
export function EmbeddingsSection({
  model,
  dim,
}: {
  provider: string
  model: string
  dim: number
}) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const embedModels = useEmbedModels()
  const [pending, setPending] = useState<EmbedModel | null>(null)
  const [reindexing, setReindexing] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)

  const models = embedModels.data ?? []
  const shownDim = pending?.dim ?? dim

  const runReembed = async (target: EmbedModel) => {
    setReindexing(true)
    setProgress(null)
    try {
      const patch: SettingsPatch =
        target.provider === "openai"
          ? { embed_provider: "openai", openai_embed_model: target.id }
          : { embed_provider: "ollama", embed_model: target.id }
      await api.patchSettings(patch)
      for (;;) {
        const s = await api.getReindexStatus()
        setProgress({ done: s.doneCount, total: s.total })
        if (s.status !== "running") {
          if (s.status === "error") throw new Error(s.error ?? "reindex failed")
          break
        }
        await new Promise((r) => setTimeout(r, 1500))
      }
      await qc.invalidateQueries({ queryKey: ["settings"] })
      toast.success(t("pages.settings.embeddings.done"))
    } catch (e) {
      toast.error(t("pages.settings.embeddings.error", { message: (e as Error).message }))
    } finally {
      setReindexing(false)
      setPending(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-2 text-[13px]">
        <span className="text-muted-foreground">
          {t("pages.settings.embeddings.dimension")}
        </span>
        <span className="font-mono text-[12.5px] tabular-nums text-foreground">{shownDim}</span>
      </div>

      <div className="space-y-2">
        <Label className="text-[13px] font-medium">
          {t("pages.settings.embeddings.model")}
        </Label>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {models.map((m) => {
            const active = m.id === model
            return (
              <button
                key={m.id}
                type="button"
                data-testid={`embed-model-${m.id}`}
                disabled={reindexing}
                onClick={() => {
                  if (m.id !== model) setPending(m)
                }}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors disabled:opacity-50",
                  active
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border bg-card hover:bg-muted/30",
                  pending?.id === m.id && "border-warning ring-2 ring-warning/20",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-[12.5px] font-medium text-foreground">
                    {m.label}
                  </span>
                  {active && <Check className="size-3.5 text-primary" strokeWidth={2.25} />}
                </div>
                <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                  {m.provider} · {m.dim}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {pending && !reindexing && (
        <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/5 p-3">
          <div className="flex items-start gap-2 text-[12.5px] leading-[1.55] text-foreground">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>{t("pages.settings.embeddings.confirmBody", { model: pending.label })}</span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="destructive"
              data-testid="embed-save"
              onClick={() => void runReembed(pending)}
            >
              {t("pages.settings.embeddings.save")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setPending(null)}>
              {t("pages.settings.embeddings.cancel")}
            </Button>
          </div>
        </div>
      )}

      {reindexing && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-[12.5px] text-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span>
            {t("pages.settings.embeddings.reindexing")}
            {progress && progress.total > 0 && (
              <span className="ml-1 font-mono tabular-nums text-muted-foreground">
                {t("pages.settings.embeddings.progress", {
                  done: progress.done,
                  total: progress.total,
                })}
              </span>
            )}
          </span>
        </div>
      )}
    </div>
  )
}
