import { useEffect, useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  Loader2,
  Paperclip,
  Settings,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { useModels, useSettings } from "@/hooks/use-settings"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Per-question config — Ask page owns it, Composer just edits it
// ─────────────────────────────────────────────────────────────────

export interface ComposerConfig {
  /** LLM model id (Ollama tag or OpenAI model id). null = use server default. */
  model: string | null
  /** Number of candidates per retriever. null = server default. */
  retrieveTopK: number | null
  /** Number of final chunks reranked into the LLM context. null = server default. */
  rerankTopK: number | null
  /** Whether to include the Neo4j graph retriever in fusion. null = server default. */
  graphEnabled: boolean | null
}

export const DEFAULT_COMPOSER_CONFIG: ComposerConfig = {
  model: null,
  retrieveTopK: null,
  rerankTopK: null,
  graphEnabled: null,
}

// ─────────────────────────────────────────────────────────────────
// ChipButton — visual primitive for the popover triggers
// ─────────────────────────────────────────────────────────────────

interface ChipButtonProps {
  icon: React.ReactNode
  children: React.ReactNode
  active?: boolean
}

function ChipButton({ icon, children, active }: ChipButtonProps) {
  return (
    <span
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px]",
        "font-mono tabular-nums transition-colors duration-[120ms]",
        active
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          : "border-border bg-card text-foreground hover:bg-muted",
      )}
    >
      <span className="flex size-3 items-center justify-center [&_svg]:size-3">{icon}</span>
      <span>{children}</span>
      <ChevronDown className="size-3 opacity-60" strokeWidth={2} />
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────
// Internal helpers — model list + dot indicator
// ─────────────────────────────────────────────────────────────────

function Dot({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-3.5 place-items-center rounded-full border",
        selected ? "border-primary" : "border-border",
      )}
    >
      {selected && <span className="size-1.5 rounded-full bg-primary" />}
    </span>
  )
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  onChange: (v: number) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <Label className="text-[12.5px] font-medium">{label}</Label>
        <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{value}</span>
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

// ─────────────────────────────────────────────────────────────────
// SettingsPopover — single gear that stacks model + knobs + graph
// ─────────────────────────────────────────────────────────────────

function SettingsPopover({
  cfg,
  setCfg,
}: {
  cfg: ComposerConfig
  setCfg: (next: ComposerConfig) => void
}) {
  const { t } = useTranslation()
  const settings = useSettings()
  const provider = settings.data?.llm_provider ?? "ollama"
  const models = useModels(provider)

  const serverDefault =
    provider === "openai"
      ? settings.data?.openai_chat_model || settings.data?.llm_model || ""
      : settings.data?.llm_model || ""

  const serverRetrieve = settings.data?.retrieve_top_k ?? 50
  const serverRerank = settings.data?.rerank_top_k ?? 5
  const effRetrieve = cfg.retrieveTopK ?? serverRetrieve
  const effRerank = cfg.rerankTopK ?? serverRerank

  const serverDefaultGraph = settings.data?.enable_graph_retrieval ?? true
  const effectiveGraph = cfg.graphEnabled ?? serverDefaultGraph

  const anyActive =
    cfg.model !== null ||
    cfg.retrieveTopK !== null ||
    cfg.rerankTopK !== null ||
    (cfg.graphEnabled !== null && cfg.graphEnabled !== serverDefaultGraph)

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label={t("pages.ask.settings")}>
          <ChipButton icon={<Settings strokeWidth={2} />} active={anyActive}>
            {t("pages.ask.settings")}
          </ChipButton>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 p-0">
        {/* ── Model section ── */}
        <div className="p-3 pb-2">
          <div className="flex items-center justify-between pb-1.5">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {t("pages.ask.modelThisQuestion")}
            </span>
            <Badge variant="outline" className="font-mono text-[10px]">
              {provider}
            </Badge>
          </div>
          <button
            type="button"
            onClick={() => setCfg({ ...cfg, model: null })}
            className={cn(
              "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
              "hover:bg-accent",
              cfg.model === null && "bg-accent/50",
            )}
          >
            <Dot selected={cfg.model === null} />
            <span className="flex flex-1 flex-col">
              <span className="text-[13px] font-medium">{t("pages.ask.serverDefault")}</span>
              <span className="font-mono text-[11px] text-muted-foreground">
                {serverDefault || t("pages.ask.unset")}
              </span>
            </span>
          </button>
          <div className="my-1 border-t border-border/40" />
          {models.isLoading && (
            <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> {t("pages.ask.loadingModels")}
            </div>
          )}
          {models.error && (
            <div className="rounded-md px-2.5 py-2 text-[12px] text-destructive">
              {models.error.message}
            </div>
          )}
          <div className="max-h-40 overflow-y-auto">
            {(models.data ?? []).map((m) => {
              const isSelected = cfg.model === m.id
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setCfg({ ...cfg, model: m.id })}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
                    "hover:bg-accent",
                    isSelected && "bg-accent/50",
                  )}
                >
                  <Dot selected={isSelected} />
                  <span className="flex flex-1 flex-col">
                    <span className="font-mono text-[12.5px]">{m.label}</span>
                    {(m.size || m.note) && (
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {[m.size, m.note].filter(Boolean).join(" · ")}
                      </span>
                    )}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* ── Retrieval knobs section ── */}
        <div className="border-t border-border/60 p-3 pb-2">
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {t("pages.ask.retrievalThisQuestion")}
          </div>
          <div className="space-y-4">
            <SliderRow
              label="k_retrieve"
              value={effRetrieve}
              min={1}
              max={200}
              onChange={(v) => setCfg({ ...cfg, retrieveTopK: v })}
            />
            <SliderRow
              label="k_rerank"
              value={effRerank}
              min={1}
              max={50}
              onChange={(v) => setCfg({ ...cfg, rerankTopK: v })}
            />
            <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-[11px]">
              <span className="font-mono text-muted-foreground">
                {t("pages.ask.serverDefaultKnobs", {
                  retrieve: serverRetrieve,
                  rerank: serverRerank,
                })}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2.5 text-[12px]"
                onClick={() => setCfg({ ...cfg, retrieveTopK: null, rerankTopK: null })}
                disabled={cfg.retrieveTopK === null && cfg.rerankTopK === null}
              >
                {t("actions.reset")}
              </Button>
            </div>
          </div>
        </div>

        {/* ── Graph toggle section ── */}
        <div className="border-t border-border/60 p-3">
          <div className="mb-2 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {t("pages.ask.knowledgeGraphThisQuestion")}
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-[13px] font-medium">{t("pages.ask.useGraphRetriever")}</Label>
            <Switch
              checked={effectiveGraph}
              onCheckedChange={(v) => setCfg({ ...cfg, graphEnabled: v })}
            />
          </div>
          <p className="mt-2 text-[12px] leading-[1.55] text-muted-foreground">
            {t("pages.ask.graphRetrieverHint")}
          </p>
          <div className="mt-2 flex items-center justify-between border-t border-border/60 pt-2 text-[11px]">
            <span className="font-mono text-muted-foreground">
              {t("pages.ask.serverDefaultState", {
                state: serverDefaultGraph ? t("pages.ask.on") : t("pages.ask.off"),
              })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[12px]"
              onClick={() => setCfg({ ...cfg, graphEnabled: null })}
              disabled={cfg.graphEnabled === null}
            >
              {t("actions.reset")}
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─────────────────────────────────────────────────────────────────
// Composer
// ─────────────────────────────────────────────────────────────────

export interface ComposerProps {
  placeholder?: string
  focused?: boolean
  streaming?: boolean
  /** Controlled input — when omitted the composer keeps its own draft. */
  value?: string
  onChange?: (next: string) => void
  /** Fires on submit (Enter without shift, or send button). */
  onSubmit?: (text: string) => void
  /** Per-question config (model + retrieval knobs + graph). */
  config?: ComposerConfig
  onConfigChange?: (next: ComposerConfig) => void
  /** Click on the paperclip — typically opens the thread's Context manager. */
  onAttach?: () => void
}

export function Composer({
  placeholder,
  focused = false,
  streaming = false,
  value,
  onChange,
  onSubmit,
  config,
  onConfigChange,
  onAttach,
}: ComposerProps) {
  const { t } = useTranslation()
  const effectivePlaceholder = placeholder ?? t("pages.ask.placeholder")
  const [draft, setDraft] = useState("")
  const controlled = value !== undefined
  const text = controlled ? value : draft
  const setText = (next: string) => {
    if (controlled) onChange?.(next)
    else setDraft(next)
  }

  // Local fallback config when the parent doesn't supply one — keeps the
  // composer usable in isolation (storybook / standalone empty state).
  const [internalCfg, setInternalCfg] = useState<ComposerConfig>(DEFAULT_COMPOSER_CONFIG)
  const cfg = config ?? internalCfg
  const setCfg = (next: ComposerConfig) => {
    if (onConfigChange) onConfigChange(next)
    else setInternalCfg(next)
  }

  // If the parent stops supplying a config mid-life, sync internal state once.
  useEffect(() => {
    if (config) setInternalCfg(config)
  }, [config])

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed || streaming) return
    onSubmit?.(trimmed)
    if (!controlled) setDraft("")
  }

  return (
    <div
      style={{
        position: "relative",
        background: "var(--card)",
        border: focused
          ? "1px solid var(--primary)"
          : "1px solid var(--border)",
        borderRadius: 12,
        boxShadow: focused
          ? "var(--shadow-md), 0 0 0 3px color-mix(in oklab, var(--primary) 20%, transparent)"
          : "var(--shadow-md)",
        transition: "border-color 120ms, box-shadow 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", padding: "12px 12px 0 16px" }}>
        <textarea
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          placeholder={effectivePlaceholder}
          className={cn(
            "min-h-7 flex-1 resize-none bg-transparent text-[14.5px] leading-[1.5] text-foreground",
            "placeholder:text-muted-foreground outline-none pt-[1px]",
          )}
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 10px 10px 12px" }}>
        <div style={{ position: "relative" }}>
          <SettingsPopover cfg={cfg} setCfg={setCfg} />
        </div>
        {onAttach && (
          <button
            type="button"
            aria-label={t("pages.ask.openContextManager")}
            className="inline-flex size-7 items-center justify-center rounded-lg text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground"
            onClick={onAttach}
            title={t("pages.ask.openContextManagerTitle")}
          >
            <Paperclip className="size-3.5" strokeWidth={2} />
          </button>
        )}
        {streaming && (
          <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
            <span
              className="size-1.5 rounded-full bg-primary"
              style={{
                boxShadow: "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)",
                animation: "sr-pulse 1.4s ease-in-out infinite",
              }}
            />
            {t("status.streaming")}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <button
          type="button"
          disabled={streaming || !text.trim()}
          aria-label={t("actions.send")}
          onClick={submit}
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            cursor: streaming || !text.trim() ? "default" : "pointer",
            opacity: streaming || !text.trim() ? 0.5 : 1,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            transition: "opacity 120ms",
          }}
        >
          {streaming ? (
            <ArrowUp className="size-[17px]" strokeWidth={2.25} style={{ opacity: 0.6 }} />
          ) : (
            <ArrowUp className="size-[17px]" strokeWidth={2.25} />
          )}
        </button>
      </div>
    </div>
  )
}
