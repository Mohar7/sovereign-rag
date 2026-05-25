import { useEffect, useState } from "react"
import {
  Activity,
  AlertCircle,
  Check,
  ChevronsUpDown,
  Cpu,
  Database,
  Loader2,
  Network,
  Server,
  Sparkles,
} from "lucide-react"
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
import { cn } from "@/lib/utils"

export function SettingsPage() {
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
        toast.error(`Failed to update ${String(key)}: ${err.message}`)
        // Roll back the draft to the server's last known value.
        if (settings.data) setDraft(settings.data)
      },
    })
  }

  if (settings.isLoading || !draft) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> <span className="ml-2">loading settings…</span>
      </div>
    )
  }

  return (
    <div className="h-[calc(100svh-4rem)] min-h-0 w-full">
      <ScrollArea className="h-full">
        <div className="mx-auto w-full max-w-4xl p-6">
          <header className="mb-6">
            <h1 className="text-[20px] font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">
              Live retrieval knobs. Changes apply immediately in-process — values
              reset on server restart until persistence is wired.
            </p>
          </header>

          <Tabs defaultValue="retrieval">
            <TabsList className="mb-5">
              <TabsTrigger value="retrieval">Retrieval</TabsTrigger>
              <TabsTrigger value="model">Model</TabsTrigger>
              <TabsTrigger value="indexing">Indexing</TabsTrigger>
              <TabsTrigger value="rerank">Rerank</TabsTrigger>
              <TabsTrigger value="services">Services</TabsTrigger>
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
  return (
    <div className="space-y-5">
      <SectionCard
        title="Hybrid retrieval"
        subtitle="Dense + sparse + graph candidates fused, reranked by a cross-encoder."
      >
        <SliderRow
          label="k_retrieve (candidates per retriever)"
          min={1}
          max={200}
          value={draft.retrieve_top_k}
          onChange={(v) => patch("retrieve_top_k", v)}
        />
        <SliderRow
          label="k_rerank (final chunks to LLM)"
          min={1}
          max={50}
          value={draft.rerank_top_k}
          onChange={(v) => patch("rerank_top_k", v)}
        />
        <SwitchRow
          label="Dense retriever"
          description="Cosine ANN over Milvus dense vectors."
          value={draft.dense_enabled}
          onChange={(v) => patch("dense_enabled", v)}
        />
        <SwitchRow
          label="Sparse retriever (BM25)"
          description="Milvus native BM25 over the sparse text field."
          value={draft.sparse_enabled}
          onChange={(v) => patch("sparse_enabled", v)}
        />
        <SwitchRow
          label="Graph retriever (Neo4j local-search)"
          description="1-hop traversal joined into the fusion step."
          value={draft.enable_graph_retrieval}
          onChange={(v) => patch("enable_graph_retrieval", v)}
        />
      </SectionCard>

      <SectionCard
        title="Fusion"
        subtitle="How dense + sparse + graph rankings are combined into one ordered list."
      >
        <div className="space-y-2">
          <Label className="text-[13px] font-medium">Strategy</Label>
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
                  <span className="font-medium">RRF (Reciprocal Rank Fusion)</span>
                  <span className="text-[11px] text-muted-foreground">
                    rank-only, the proven default
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="weighted">
                <div className="flex flex-col items-start">
                  <span className="font-medium">Weighted</span>
                  <span className="text-[11px] text-muted-foreground">
                    uses the graph / vector weights below
                  </span>
                </div>
              </SelectItem>
              <SelectItem value="borda">
                <div className="flex flex-col items-start">
                  <span className="font-medium">Borda</span>
                  <span className="text-[11px] text-muted-foreground">
                    positional voting, also rank-only
                  </span>
                </div>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <SliderRow
          label="RRF k constant"
          min={1}
          max={200}
          value={draft.rrf_k}
          onChange={(v) => patch("rrf_k", v)}
        />
        <SliderRow
          label="Graph weight"
          min={0}
          max={100}
          value={Math.round(draft.fusion_graph_weight * 100)}
          onChange={(v) => patch("fusion_graph_weight", v / 100)}
          format={(v) => (v / 100).toFixed(2)}
        />
        <SliderRow
          label="Vector weight"
          min={0}
          max={100}
          value={Math.round(draft.fusion_vector_weight * 100)}
          onChange={(v) => patch("fusion_vector_weight", v / 100)}
          format={(v) => (v / 100).toFixed(2)}
        />
      </SectionCard>
    </div>
  )
}

function ModelTab({ draft, patch }: TabProps) {
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
        title="LLM"
        subtitle="Provider + model per tier. Changes take effect on the next graph run — the factory cache is busted automatically."
      >
        <ProviderRow
          value={provider}
          onChange={(v) =>
            patch("llm_provider", v as SettingsResponse["llm_provider"])
          }
        />

        <ModelDropdownRow
          label="Default (answer LLM)"
          description="The chat model used to synthesise answers. The full-quality tier."
          value={currentValue("default")}
          onChange={(v) => setTier("default", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />
        <ModelDropdownRow
          label="Light (structured output)"
          description="Cheaper / faster tier for JSON-shaped sub-tasks (rerank prompts, contextual retrieval)."
          value={currentValue("light")}
          onChange={(v) => setTier("light", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />
        <ModelDropdownRow
          label="Nano (smallest)"
          description="Smallest local-only tier used by fast classification + safety checks."
          value={currentValue("nano")}
          onChange={(v) => setTier("nano", v)}
          models={models.data ?? []}
          loading={models.isLoading}
          error={models.error?.message}
          provider={provider}
          onReload={() => void models.refetch()}
        />

        <SliderRow
          label="Temperature"
          min={0}
          max={200}
          value={Math.round(draft.llm_temperature * 100)}
          onChange={(v) => patch("llm_temperature", v / 100)}
          format={(v) => (v / 100).toFixed(2)}
        />
        {provider === "openai" && (
          <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/5 px-3 py-2.5 text-[12px] leading-[1.55] text-foreground">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0 text-warning" />
            <span>
              Reasoning-class models (<code className="font-mono">gpt-5*</code>,{" "}
              <code className="font-mono">o*</code>) ignore the temperature
              slider — the API rejects any value other than the default.
            </span>
          </div>
        )}
      </SectionCard>

      <SectionCard
        title="Embeddings"
        subtitle="Embedding provider + model. Pinned to the schema baked into Milvus — change via .env, then reindex."
      >
        <ReadOnlyRow label="Provider" value={draft.embed_provider} />
        <ReadOnlyRow label="Model" value={draft.embed_model} mono />
        <ReadOnlyRow label="Dimension" value={String(draft.embed_dim)} mono />
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
  const options: Array<{ id: "ollama" | "openai"; label: string; sub: string }> = [
    { id: "ollama", label: "Ollama", sub: "local or Ollama Cloud" },
    { id: "openai", label: "OpenAI", sub: "gpt-5 / 4.1 / o-series" },
  ]
  return (
    <div className="space-y-2">
      <Label className="text-[13px] font-medium">Provider</Label>
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
                loading models…
              </span>
            ) : (
              <span className="truncate">
                {value || (
                  <span className="italic text-muted-foreground">
                    (auto · falls back to default tier)
                  </span>
                )}
              </span>
            )}
            <ChevronsUpDown className="ml-2 size-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={`Search ${provider} models…`} />
            <CommandList>
              {error ? (
                <div className="px-3 py-3 text-[12px] text-destructive">
                  {error}{" "}
                  <button
                    type="button"
                    onClick={onReload}
                    className="ml-1 underline hover:text-foreground"
                  >
                    retry
                  </button>
                </div>
              ) : (
                <>
                  <CommandEmpty>No models found.</CommandEmpty>
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
          Reasoning model — temperature setting is ignored by the API.
        </p>
      )}
    </div>
  )
}

function IndexingTab({ draft, patch }: TabProps) {
  return (
    <SectionCard
      title="Indexing"
      subtitle="Knobs applied during ingest. Reindex to apply contextual changes to existing chunks."
    >
      <SwitchRow
        label="Contextual retrieval"
        description="Prefix each chunk with an LLM-generated summary of the document context."
        value={draft.enable_contextual_retrieval}
        onChange={(v) => patch("enable_contextual_retrieval", v)}
      />
      <SliderRow
        label="Graph BFS depth"
        min={1}
        max={5}
        value={draft.graph_depth}
        onChange={(v) => patch("graph_depth", v)}
      />
      <SliderRow
        label="Graph max nodes"
        min={10}
        max={500}
        value={draft.graph_max_nodes}
        onChange={(v) => patch("graph_max_nodes", v)}
      />
    </SectionCard>
  )
}

function RerankTab({ draft, patch }: TabProps) {
  return (
    <SectionCard
      title="Reranker"
      subtitle="Cross-encoder applied after fusion. Score-floor drops weak chunks before they reach the LLM."
    >
      <ReadOnlyRow label="Model" value={draft.reranker_model} mono />
      <div className="space-y-2">
        <Label className="text-[13px] font-medium">Device</Label>
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
            <SelectItem value="auto">auto (picks the best available)</SelectItem>
            <SelectItem value="mps">mps (Apple Silicon)</SelectItem>
            <SelectItem value="cuda">cuda (NVIDIA GPU)</SelectItem>
            <SelectItem value="cpu">cpu (universal fallback)</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <SliderRow
        label="Score floor"
        min={0}
        max={100}
        value={Math.round(draft.rerank_score_floor * 100)}
        onChange={(v) => patch("rerank_score_floor", v / 100)}
        format={(v) => (v / 100).toFixed(2)}
      />
      <SwitchRow
        label="Adaptive truncation"
        description="Stop collecting once cumulative score-mass crosses 0.85 — keeps LLM context lean on easy queries."
        value={draft.adaptive_rerank}
        onChange={(v) => patch("adaptive_rerank", v)}
      />
    </SectionCard>
  )
}

function ServicesTab() {
  const health = useHealth()
  return (
    <SectionCard
      title="Service health"
      subtitle="Live per-service liveness + p50 latency. Re-probed every 30 seconds."
    >
      {health.isLoading && (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" /> probing services…
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
      <CardContent className="space-y-5 p-6">
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
              {service.latency_ms.toFixed(0)}ms
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
