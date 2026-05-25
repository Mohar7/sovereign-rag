import { useEffect, useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  CircuitBoard,
  Loader2,
  Paperclip,
  Settings2,
  Sparkles,
} from "lucide-react"

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
// ModelPickerPopover — queries /api/models for the active provider
// ─────────────────────────────────────────────────────────────────

function ModelPickerPopover({
  selected,
  onSelect,
}: {
  selected: string | null
  onSelect: (next: string | null) => void
}) {
  const settings = useSettings()
  const provider = settings.data?.llm_provider ?? "ollama"
  const models = useModels(provider)
  const serverDefault =
    provider === "openai"
      ? settings.data?.openai_chat_model || settings.data?.llm_model || ""
      : settings.data?.llm_model || ""
  const displayed = selected ?? serverDefault ?? "default"

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="pick model">
          <ChipButton icon={<Sparkles strokeWidth={2} />} active={selected !== null}>
            {displayed || "model"}
          </ChipButton>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 p-1.5">
        <div className="flex items-center justify-between px-2.5 pb-1.5 pt-1">
          <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            model · this question
          </span>
          <Badge variant="outline" className="font-mono text-[10px]">
            {provider}
          </Badge>
        </div>
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left",
            "hover:bg-accent",
            selected === null && "bg-accent/50",
          )}
        >
          <Dot selected={selected === null} />
          <span className="flex flex-1 flex-col">
            <span className="text-[13px] font-medium">Server default</span>
            <span className="font-mono text-[11px] text-muted-foreground">
              {serverDefault || "(unset)"}
            </span>
          </span>
        </button>
        <div className="my-1 border-t border-border/40" />
        {models.isLoading && (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted-foreground">
            <Loader2 className="size-3 animate-spin" /> loading models…
          </div>
        )}
        {models.error && (
          <div className="rounded-md px-2.5 py-2 text-[12px] text-destructive">
            {models.error.message}
          </div>
        )}
        <div className="max-h-72 overflow-y-auto">
          {(models.data ?? []).map((m) => {
            const isSelected = selected === m.id
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => onSelect(m.id)}
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
      </PopoverContent>
    </Popover>
  )
}

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

// ─────────────────────────────────────────────────────────────────
// RetrievalKnobsPopover — k_retrieve / k_rerank with server defaults
// ─────────────────────────────────────────────────────────────────

function RetrievalKnobsPopover({
  kRetrieve,
  kRerank,
  onChange,
}: {
  kRetrieve: number | null
  kRerank: number | null
  onChange: (next: { kRetrieve: number | null; kRerank: number | null }) => void
}) {
  const settings = useSettings()
  const serverRetrieve = settings.data?.retrieve_top_k ?? 50
  const serverRerank = settings.data?.rerank_top_k ?? 5
  const effRetrieve = kRetrieve ?? serverRetrieve
  const effRerank = kRerank ?? serverRerank
  const dirty = kRetrieve !== null || kRerank !== null
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="retrieval knobs">
          <ChipButton icon={<Settings2 strokeWidth={2} />} active={dirty}>
            retrieve {effRetrieve} · rerank {effRerank}
          </ChipButton>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          retrieval · this question
        </div>
        <div className="mt-3 space-y-4">
          <SliderRow
            label="k_retrieve"
            value={effRetrieve}
            min={1}
            max={200}
            onChange={(v) => onChange({ kRetrieve: v, kRerank })}
          />
          <SliderRow
            label="k_rerank"
            value={effRerank}
            min={1}
            max={50}
            onChange={(v) => onChange({ kRetrieve, kRerank: v })}
          />
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3 text-[11px]">
            <span className="font-mono text-muted-foreground">
              server default · {serverRetrieve}/{serverRerank}
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2.5 text-[12px]"
              onClick={() => onChange({ kRetrieve: null, kRerank: null })}
              disabled={!dirty}
            >
              Reset
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
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
// GraphTogglePopover
// ─────────────────────────────────────────────────────────────────

function GraphTogglePopover({
  graphEnabled,
  onChange,
}: {
  graphEnabled: boolean | null
  onChange: (next: boolean | null) => void
}) {
  const settings = useSettings()
  const serverDefault = settings.data?.enable_graph_retrieval ?? true
  const effective = graphEnabled ?? serverDefault
  const dirty = graphEnabled !== null && graphEnabled !== serverDefault
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button type="button" aria-label="graph toggle">
          <ChipButton icon={<CircuitBoard strokeWidth={2} />} active={dirty}>
            graph {effective ? "on" : "off"}
          </ChipButton>
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-72 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          knowledge graph · this question
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Label className="text-[13px] font-medium">Use graph retriever</Label>
          <Switch checked={effective} onCheckedChange={(v) => onChange(v)} />
        </div>
        <p className="mt-2 text-[12px] leading-[1.55] text-muted-foreground">
          Neo4j 1-hop traversal joined into RRF fusion. Off when you only want dense + sparse.
        </p>
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-3 text-[11px]">
          <span className="font-mono text-muted-foreground">
            server default · {serverDefault ? "on" : "off"}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 px-2.5 text-[12px]"
            onClick={() => onChange(null)}
            disabled={graphEnabled === null}
          >
            Reset
          </Button>
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
  placeholder = "Ask anything across your corpus.",
  focused = false,
  streaming = false,
  value,
  onChange,
  onSubmit,
  config,
  onConfigChange,
  onAttach,
}: ComposerProps) {
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
      className={cn(
        "relative flex flex-col gap-2 rounded-[18px] border bg-card p-3 pl-4 shadow-sm",
        "transition-colors duration-[120ms]",
        focused
          ? "border-primary/40 ring-2 ring-ring/30 ring-offset-2 ring-offset-background"
          : "border-border",
      )}
    >
      <div className="flex items-start gap-3">
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
          placeholder={placeholder}
          className={cn(
            "min-h-7 flex-1 resize-none bg-transparent text-[15px] leading-[1.55] text-foreground",
            "placeholder:text-muted-foreground outline-none",
          )}
        />
        <Button
          size="icon"
          disabled={streaming || !text.trim()}
          aria-label="send"
          className="size-9 rounded-full"
          onClick={submit}
        >
          <ArrowUp className="size-4" strokeWidth={2.25} />
        </Button>
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label={onAttach ? "open context manager" : "attach"}
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground disabled:opacity-40"
          onClick={onAttach}
          disabled={!onAttach}
          title={onAttach ? "Open context manager (pins + exclusions)" : "Attach"}
        >
          <Paperclip className="size-3.5" strokeWidth={2} />
        </button>
        <ModelPickerPopover
          selected={cfg.model}
          onSelect={(next) => setCfg({ ...cfg, model: next })}
        />
        <RetrievalKnobsPopover
          kRetrieve={cfg.retrieveTopK}
          kRerank={cfg.rerankTopK}
          onChange={({ kRetrieve, kRerank }) =>
            setCfg({ ...cfg, retrieveTopK: kRetrieve, rerankTopK: kRerank })
          }
        />
        <GraphTogglePopover
          graphEnabled={cfg.graphEnabled}
          onChange={(next) => setCfg({ ...cfg, graphEnabled: next })}
        />
        {streaming && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
            <span
              className="size-1.5 rounded-full bg-primary"
              style={{
                boxShadow: "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)",
                animation: "sr-pulse 1.4s ease-in-out infinite",
              }}
            />
            streaming
          </span>
        )}
      </div>
    </div>
  )
}
