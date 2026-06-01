import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronsUpDown,
  Cpu,
  Database,
  Loader2,
  Network,
  Server,
  Sparkles,
} from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useHealth } from "@/hooks/use-ask"
import { useModels, useSettings, useUpdateSettings } from "@/hooks/use-settings"
import type { ModelChoice, ServiceStatus, SettingsResponse } from "@/lib/api"
import { formatCount, formatDecimal } from "@/lib/format"
import { cn } from "@/lib/utils"

export function SettingsPage() {
  const { t } = useTranslation()
  const settings = useSettings()
  const update = useUpdateSettings()

  // Local draft mirror so sliders / switches are responsive, then patch on
  // commit (blur, change for switches/segmented, or value change for sliders).
  const [draft, setDraft] = useState<SettingsResponse | null>(null)
  useEffect(() => {
    if (settings.data) setDraft(settings.data)
  }, [settings.data])

  const patch = <K extends keyof SettingsResponse>(
    key: K,
    value: SettingsResponse[K],
  ) => {
    if (!draft) return
    const next = { ...draft, [key]: value }
    setDraft(next)
    update.mutate({ [key]: value } as Partial<SettingsResponse>, {
      onError: (err) => {
        toast.error(
          t("pages.settings.updateFailed", {
            key: String(key),
            message: err.message,
          }),
        )
        // Roll back the draft to the server's last known value.
        if (settings.data) setDraft(settings.data)
      },
    })
  }

  if (settings.isLoading || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />{" "}
        <span className="ml-2">{t("pages.settings.loading")}</span>
      </div>
    )
  }

  return (
    <div className="h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-4xl p-6">
          <header className="mb-6">
            <h1 className="text-[20px] font-semibold tracking-tight">
              {t("pages.settings.title")}
            </h1>
            <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">
              {t("pages.settings.subtitle")}
            </p>
          </header>

          <Tabs defaultValue="retrieval">
            <TabsList className="mb-5 w-full max-w-full overflow-x-auto">
              <TabsTrigger value="retrieval">
                {t("pages.settings.tabs.retrieval")}
              </TabsTrigger>
              <TabsTrigger value="model">{t("pages.settings.tabs.model")}</TabsTrigger>
              <TabsTrigger value="indexing">
                {t("pages.settings.tabs.indexing")}
              </TabsTrigger>
              <TabsTrigger value="rerank">{t("pages.settings.tabs.rerank")}</TabsTrigger>
              <TabsTrigger value="services">
                {t("pages.settings.tabs.services")}
              </TabsTrigger>
              <TabsTrigger value="danger" className="text-destructive">
                {t("pages.settings.tabs.danger")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="retrieval">
              <RetrievalTab draft={draft} patch={patch} />
            </TabsContent>
            <TabsContent value="model">
              <ModelTab draft={draft} patch={patch} />
            </TabsContent>
            <TabsContent value="indexing">
              <IndexingTab draft={draft} patch={patch} />
            </TabsContent>
            <TabsContent value="rerank">
              <RerankTab draft={draft} patch={patch} />
            </TabsContent>
            <TabsContent value="services">
              <ServicesTab />
            </TabsContent>
            <TabsContent value="danger">
              <DangerTab />
            </TabsContent>
          </Tabs>
        </div>
      </ScrollArea>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Tabs
// ─────────────────────────────────────────────────────────────────

interface TabProps {
  draft: SettingsResponse
  patch: <K extends keyof SettingsResponse>(
    key: K,
    value: SettingsResponse[K],
  ) => void
}

function RetrievalTab({ draft, patch }: TabProps) {
  const { t } = useTranslation()
  return (
    <div className="space-y-5">
      <SectionCard
        title={t("pages.settings.retrieval.hybrid.title")}
        subtitle={t("pages.settings.retrieval.hybrid.subtitle")}
      >
        <SliderRow
          label={t("pages.settings.retrieval.kRetrieve")}
          min={1}
          max={200}
          value={draft.retrieve_top_k}
          onChange={(v) => patch("retrieve_top_k", v)}
        />
        <SliderRow
          label={t("pages.settings.retrieval.kRerank")}
          min={1}
          max={50}
          value={draft.rerank_top_k}
          onChange={(v) => patch("rerank_top_k", v)}
        />
        <SwitchRow
          label={t("pages.settings.retrieval.dense.label")}
          description={t("pages.settings.retrieval.dense.description")}
          value={draft.dense_enabled}
          onChange={(v) => patch("dense_enabled", v)}
        />
        <SwitchRow
          label={t("pages.settings.retrieval.sparse.label")}
          description={t("pages.settings.retrieval.sparse.description")}
          value={draft.sparse_enabled}
          onChange={(v) => patch("sparse_enabled", v)}
        />
        <SwitchRow
          label={t("pages.settings.retrieval.graph.label")}
          description={t("pages.settings.retrieval.graph.description")}
          value={draft.enable_graph_retrieval}
          onChange={(v) => patch("enable_graph_retrieval", v)}
        />
      </SectionCard>

      <SectionCard
        title={t("pages.settings.fusion.title")}
        subtitle={t("pages.settings.fusion.subtitle")}
      >
        <div className="space-y-2">
          <Label className="text-[13px] font-medium">
            {t("pages.settings.fusion.strategy")}
          </Label>
          <Select
            value={draft.fusion_strategy}
            onValueChange={(v) => patch("fusion_strategy", v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rrf">
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {t("pages.settings.fusion.rrf.label")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("pages.settings.fusion.rrf.hint")}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="weighted">
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {t("pages.settings.fusion.weighted.label")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("pages.settings.fusion.weighted.hint")}
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="borda">
                <div className="flex flex-col items-start">
                  <span className="font-medium">
                    {t("pages.settings.fusion.borda.label")}
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    {t("pages.settings.fusion.borda.hint")}
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SliderRow
          label={t("pages.settings.fusion.rrfK")}
          min={1}
          max={200}
          value={draft.rrf_k}
          onChange={(v) => patch("rrf_k", v)}
        />
        <SliderRow
          label={t("pages.settings.fusion.graphWeight")}
          min={0}
          max={100}
          value={Math.round(draft.fusion_graph_weight * 100)}
          onChange={(v) => patch("fusion_graph_weight", v / 100)}
          format={(v) => formatDecimal(v / 100)}
        />
        <SliderRow
          label={t("pages.settings.fusion.vectorWeight")}
          min={0}
          max={100}
          value={Math.round(draft.fusion_vector_weight * 100)}
          onChange={(v) => patch("fusion_vector_weight", v / 100)}
          format={(v) => formatDecimal(v / 100)}
        />
      </SectionCard>
    </div>
  )
}

function ModelTab({ draft, patch }: TabProps) {
  const { t } = useTranslation()
  // For the OpenAI provider we use the `openai_chat_model*` fields; for Ollama
  // the shared `llm_model*` fields. The factory falls back to the latter when
  // the former are blank, so the UI just picks the right field per provider.
  const provider = draft.llm_provider
  const models = useModels(provider)

  const tierFieldFor = (tier: "default" | "light" | "nano"): keyof SettingsResponse => {
    if (provider === "openai") {
      return tier === "default"
        ? "openai_chat_model"
        : tier === "light"
          ? "openai_chat_model_light"
          : "openai_chat_model_nano"
    }
    return tier === "default"
      ? "llm_model"
      : tier === "light"
        ? "llm_model_light"
        : "llm_model_nano"
  }

  const currentValue = (tier: "default" | "light" | "nano") => {
    const field = tierFieldFor(tier)
    const v = draft[field] as string
    if (v) return v
    // OpenAI tiers fall back to the shared llm_model* when blank.
    if (provider === "openai") {
      const shared =
        tier === "default"
          ? draft.llm_model
          : tier === "light"
            ? draft.llm_model_light
            : draft.llm_model_nano
      return shared
    }
    return ""
  }

  const setTier = (tier: "default" | "light" | "nano", next: string) => {
    patch(tierFieldFor(tier), next as SettingsResponse[keyof SettingsResponse])
  }

  return (
    <div className="space-y-5">
      <SectionCard
        title={t("pages.settings.llm.title")}
        subtitle={t("pages.settings.llm.subtitle")}
      >
        <ProviderRow
          value={provider}
          onChange={(v) =>
            patch("llm_provider", v as SettingsResponse["llm_provider"])
          }
        />

        <ModelDropdownRow
          label={t("pages.settings.llm.default.label")}
          description={t("pages.settings.llm.default.description")}
          value={currentValue("default")}
          onChange={(v) => setTier("default", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />
        <ModelDropdownRow
          label={t("pages.settings.llm.light.label")}
          description={t("pages.settings.llm.light.description")}
          value={currentValue("light")}
          onChange={(v) => setTier("light", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />
        <ModelDropdownRow
          label={t("pages.settings.llm.nano.label")}
          description={t("pages.settings.llm.nano.description")}
          value={currentValue("nano")}
          onChange={(v) => setTier("nano", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />

        <SliderRow
          label={t("pages.settings.llm.temperature")}
          min={0}
          max={200}
          value={Math.round(draft.llm_temperature * 100)}
          onChange={(v) => patch("llm_temperature", v / 100)}
          format={(v) => formatDecimal(v / 100)}
        />
        {provider === "openai" && (
          <div className="flex items-start gap-2 rounded border border-warning/40 bg-warning/5 px-3 py-2.5 text-[12px] leading-[1.55] text-foreground">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              <Trans
                i18nKey="pages.settings.llm.reasoningWarning"
                components={{ code: <code className="font-mono" /> }}
              />
            </span>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title={t("pages.settings.embeddings.title")}
        subtitle={t("pages.settings.embeddings.subtitle")}
      >
        <ReadOnlyRow
          label={t("pages.settings.embeddings.provider")}
          value={draft.embed_provider}
        />
        <ReadOnlyRow
          label={t("pages.settings.embeddings.model")}
          value={draft.embed_model}
          mono
        />
        <ReadOnlyRow
          label={t("pages.settings.embeddings.dimension")}
          value={String(draft.embed_dim)}
          mono
        />
      </SectionCard>
    </div>
  )
}

function ProviderRow({
  value,
  onChange,
}: {
  value: "ollama" | "openai"
  onChange: (next: "ollama" | "openai") => void
}) {
  const { t } = useTranslation()
  const options: Array<{ id: "ollama" | "openai"; label: string; sub: string }> = [
    { id: "ollama", label: "Ollama", sub: t("pages.settings.provider.ollamaSub") },
    { id: "openai", label: "OpenAI", sub: t("pages.settings.provider.openaiSub") },
  ]
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-medium">
        {t("pages.settings.provider.label")}
      </Label>
      <div className="grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            className={cn(
              "rounded-lg border p-3 text-left transition-colors",
              value === o.id
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border bg-card hover:bg-muted/30",
            )}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13.5px] font-semibold text-foreground">
                {o.label}
              </span>
              {value === o.id && (
                <Check className="size-3.5 text-primary" strokeWidth={2.25} />
              )}
            </div>
            <div className="mt-0.5 text-[11.5px] text-muted-foreground">{o.sub}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function ModelDropdownRow({
  label,
  description,
  value,
  onChange,
  models,
  loading,
  error,
  provider,
  onReload,
}: {
  label: string
  description?: string
  value: string
  onChange: (next: string) => void
  models: ModelChoice[]
  loading: boolean
  error?: string
  provider: "ollama" | "openai"
  onReload: () => void
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const current = models.find((m) => m.id === value)
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <Label className="text-[13px] font-medium">{label}</Label>
          {description && (
            <p className="mt-0.5 text-[12px] leading-[1.5] text-muted-foreground">
              {description}
            </p>
          )}
        </div>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-full justify-between font-mono text-[12.5px]"
            disabled={loading}
          >
            {loading ? (
              <span className="inline-flex items-center gap-2 text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" />
                {t("pages.settings.model.loadingModels")}
              </span>
            ) : (
              <span className="truncate">
                {value || (
                  <span className="italic text-muted-foreground">
                    {t("pages.settings.model.autoFallback")}
                  </span>
                )}
              </span>
            )}
            <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput
              placeholder={t("pages.settings.model.searchPlaceholder", { provider })}
            />
            <CommandList>
              {error ? (
                <div className="px-3 py-3 text-[12px] text-destructive">
                  {error}{" "}
                  <button
                    type="button"
                    onClick={onReload}
                    className="ml-1 underline hover:text-foreground"
                  >
                    {t("pages.settings.model.retry")}
                  </button>
                </div>
              ) : (
                <>
                  <CommandEmpty>{t("pages.settings.model.noModels")}</CommandEmpty>
                  <CommandGroup>
                    {models.map((m) => (
                      <CommandItem
                        key={m.id}
                        value={m.id}
                        onSelect={(v) => {
                          onChange(v)
                          setOpen(false)
                        }}
                      >
                        <Check
                          className={cn(
                            "size-3.5",
                            value === m.id ? "opacity-100" : "opacity-0",
                          )}
                        />
                        <div className="ml-1 flex-1">
                          <div className="font-mono text-[12.5px] text-foreground">
                            {m.label}
                          </div>
                          {(m.size || m.note) && (
                            <div className="font-mono text-[10.5px] text-muted-foreground">
                              {[m.size, m.note].filter(Boolean).join(" · ")}
                            </div>
                          )}
                        </div>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {current && current.note === "reasoning" && (
        <p className="text-[11px] text-muted-foreground">
          {t("pages.settings.model.reasoningNote")}
        </p>
      )}
    </div>
  )
}

function IndexingTab({ draft, patch }: TabProps) {
  const { t } = useTranslation()
  return (
    <SectionCard
      title={t("pages.settings.indexing.title")}
      subtitle={t("pages.settings.indexing.subtitle")}
    >
      <SwitchRow
        label={t("pages.settings.indexing.contextual.label")}
        description={t("pages.settings.indexing.contextual.description")}
        value={draft.enable_contextual_retrieval}
        onChange={(v) => patch("enable_contextual_retrieval", v)}
      />
      <SliderRow
        label={t("pages.settings.indexing.graphDepth")}
        min={1}
        max={5}
        value={draft.graph_depth}
        onChange={(v) => patch("graph_depth", v)}
      />
      <SliderRow
        label={t("pages.settings.indexing.graphMaxNodes")}
        min={10}
        max={500}
        value={draft.graph_max_nodes}
        onChange={(v) => patch("graph_max_nodes", v)}
      />
    </SectionCard>
  )
}

function RerankTab({ draft, patch }: TabProps) {
  const { t } = useTranslation()
  return (
    <SectionCard
      title={t("pages.settings.rerank.title")}
      subtitle={t("pages.settings.rerank.subtitle")}
    >
      <ReadOnlyRow
        label={t("pages.settings.rerank.model")}
        value={draft.reranker_model}
        mono
      />
      <div className="space-y-2">
        <Label className="text-[13px] font-medium">
          {t("pages.settings.rerank.device")}
        </Label>
        <Select
          value={draft.reranker_device}
          onValueChange={(v) =>
            patch("reranker_device", v as SettingsResponse["reranker_device"])
          }
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("pages.settings.rerank.deviceAuto")}</SelectItem>
            <SelectItem value="mps">{t("pages.settings.rerank.deviceMps")}</SelectItem>
            <SelectItem value="cuda">{t("pages.settings.rerank.deviceCuda")}</SelectItem>
            <SelectItem value="cpu">{t("pages.settings.rerank.deviceCpu")}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <SliderRow
        label={t("pages.settings.rerank.scoreFloor")}
        min={0}
        max={100}
        value={Math.round(draft.rerank_score_floor * 100)}
        onChange={(v) => patch("rerank_score_floor", v / 100)}
        format={(v) => formatDecimal(v / 100)}
      />
      <SwitchRow
        label={t("pages.settings.rerank.adaptive.label")}
        description={t("pages.settings.rerank.adaptive.description")}
        value={draft.adaptive_rerank}
        onChange={(v) => patch("adaptive_rerank", v)}
      />
    </SectionCard>
  )
}

function ServicesTab() {
  const { t } = useTranslation()
  const health = useHealth()
  return (
    <SectionCard
      title={t("pages.settings.services.title")}
      subtitle={t("pages.settings.services.subtitle")}
    >
      {health.isLoading && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> {t("pages.settings.services.probing")}
        </div>
      )}
      {health.data?.services && health.data.services.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {health.data.services.map((s) => (
            <ServiceCard key={s.name} service={s} />
          ))}
        </div>
      )}
    </SectionCard>
  )
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function SectionCard({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardContent className="space-y-5 p-6 2xl:p-8">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">{title}</h2>
          {subtitle && (
            <p className="mt-0.5 text-[12.5px] leading-[1.55] text-muted-foreground">
              {subtitle}
            </p>
          )}
        </div>
        <div className="space-y-5">{children}</div>
      </CardContent>
    </Card>
  )
}

function SliderRow({
  label,
  min,
  max,
  value,
  onChange,
  format,
}: {
  label: string
  min: number
  max: number
  value: number
  onChange: (next: number) => void
  format?: (n: number) => string
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-[13px] font-medium">{label}</Label>
        <span className="font-mono text-[12.5px] tabular-nums text-muted-foreground">
          {format ? format(value) : value}
        </span>
      </div>
      <Slider
        value={[value]}
        min={min}
        max={max}
        step={1}
        onValueChange={(v) => onChange(v[0])}
      />
    </div>
  )
}

function SwitchRow({
  label,
  description,
  value,
  onChange,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (next: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="min-w-0">
        <Label className="text-[13px] font-medium">{label}</Label>
        {description && (
          <p className="mt-0.5 text-[12px] leading-[1.5] text-muted-foreground">
            {description}
          </p>
        )}
      </div>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  )
}

function ReadOnlyRow({
  label,
  value,
  mono,
}: {
  label: string
  value: string
  mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border/40 pb-2 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          "text-foreground",
          mono && "font-mono tabular-nums text-[12.5px]",
        )}
      >
        {value}
      </span>
    </div>
  )
}

function ServiceCard({ service }: { service: ServiceStatus }) {
  const { t } = useTranslation()
  const tone =
    service.state === "ok"
      ? "border-success/40 bg-success/5"
      : service.state === "warn"
        ? "border-warning/40 bg-warning/5"
        : "border-destructive/40 bg-destructive/5"
  const Icon = iconFor(service.name)
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border p-3.5",
        tone,
      )}
    >
      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-card">
        <Icon className="size-4 text-foreground" strokeWidth={2} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-[13.5px] font-medium text-foreground capitalize">
            {service.name}
          </span>
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10.5px] uppercase",
              service.state === "ok" && "border-success text-success",
              service.state === "warn" && "border-warning text-warning",
              service.state === "err" && "border-destructive text-destructive",
            )}
          >
            {service.state}
          </Badge>
          {typeof service.latency_ms === "number" && (
            <span className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground">
              {t("pages.settings.services.latencyMs", {
                ms: formatCount(Math.round(service.latency_ms)),
              })}
            </span>
          )}
        </div>
        {service.endpoint && (
          <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
            {service.endpoint}
          </div>
        )}
        {service.note && (
          <div className="mt-1 font-mono text-[11px] text-destructive">
            {service.note}
          </div>
        )}
      </div>
    </div>
  )
}

function iconFor(name: string) {
  switch (name) {
    case "milvus":
      return Database
    case "neo4j":
      return Network
    case "postgres":
      return Server
    case "ollama":
      return Cpu
    case "openai":
    case "searxng":
      return Sparkles
    default:
      return Activity
  }
}

// ─────────────────────────────────────────────────────────────────
// Danger zone — typed-confirm wrapper for /admin/wipe
//
// Three scopes (corpus / threads / all) each get a card with the exact
// implications spelled out, plus a typed-confirmation input that must
// match the scope name before the destructive button enables.
// ─────────────────────────────────────────────────────────────────

function DangerTab() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-destructive/15 text-destructive">
            <AlertTriangle className="size-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-foreground">
              {t("pages.settings.danger.title")}
            </h2>
            <p className="mt-0.5 text-[12.5px] leading-[1.55] text-muted-foreground">
              {t("pages.settings.danger.subtitle")}
            </p>
          </div>
        </div>
      </div>

      <WipeCard
        scope="corpus"
        title={t("pages.settings.danger.corpus.title")}
        summary={t("pages.settings.danger.corpus.summary")}
        details={t("pages.settings.danger.corpus.details", {
          returnObjects: true,
        }) as string[]}
        invalidateKeys={[["library", "search"], ["corpus", "stats"], ["graph", "stats"], ["graph", "entities"]]}
        qc={qc}
      />
      <WipeCard
        scope="threads"
        title={t("pages.settings.danger.threads.title")}
        summary={t("pages.settings.danger.threads.summary")}
        details={t("pages.settings.danger.threads.details", {
          returnObjects: true,
        }) as string[]}
        invalidateKeys={[["threads", "list"], ["runs", "list"]]}
        qc={qc}
      />
      <WipeCard
        scope="all"
        title={t("pages.settings.danger.all.title")}
        summary={t("pages.settings.danger.all.summary")}
        details={t("pages.settings.danger.all.details", {
          returnObjects: true,
        }) as string[]}
        invalidateKeys={[["library", "search"], ["corpus", "stats"], ["graph", "stats"], ["graph", "entities"], ["threads", "list"], ["runs", "list"]]}
        qc={qc}
      />
    </div>
  )
}

function WipeCard({
  scope,
  title,
  summary,
  details,
  invalidateKeys,
  qc,
}: {
  scope: "corpus" | "threads" | "all"
  title: string
  summary: string
  details: string[]
  invalidateKeys: Array<readonly string[]>
  qc: ReturnType<typeof useQueryClient>
}) {
  const { t } = useTranslation()
  const [confirmText, setConfirmText] = useState("")
  const [running, setRunning] = useState(false)
  const armed = confirmText === scope
  const handleWipe = async () => {
    if (!armed || running) return
    setRunning(true)
    try {
      const r = await fetch("/admin/wipe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope, confirm: "wipe" }),
      })
      if (!r.ok) {
        const body = await r.text().catch(() => r.statusText)
        throw new Error(body || r.statusText)
      }
      toast.success(t("pages.settings.danger.wipedToast", { scope }))
      setConfirmText("")
      for (const key of invalidateKeys) {
        void qc.invalidateQueries({ queryKey: [...key] })
      }
    } catch (err) {
      toast.error(
        t("pages.settings.danger.wipeFailedToast", {
          message: (err as Error).message,
        }),
      )
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card className="border-destructive/30">
      <CardContent className="space-y-3 p-6">
        <div className="space-y-1">
          <h3 className="text-[14px] font-semibold text-foreground">{title}</h3>
          <p className="text-[12.5px] leading-[1.55] text-muted-foreground">
            {summary}
          </p>
        </div>
        <ul className="space-y-1 pl-3 text-[12px] leading-[1.55] text-muted-foreground">
          {details.map((d, i) => (
            <li key={i} className="list-disc">
              {d}
            </li>
          ))}
        </ul>
        <div className="space-y-2 pt-1">
          <Label className="text-[13px] font-medium">
            <Trans
              i18nKey="pages.settings.danger.confirmLabel"
              values={{ scope }}
              components={{
                code: <code className="rounded bg-muted px-1 font-mono" />,
              }}
            />
          </Label>
          <div className="flex items-center gap-2">
            <Input
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={scope}
              className="h-8 font-mono text-[13px]"
            />
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={handleWipe}
              disabled={!armed || running}
            >
              {running ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <AlertTriangle className="size-3.5" strokeWidth={2} />
              )}
              {t("pages.settings.danger.wipeButton", { scope })}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
