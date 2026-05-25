import { useState } from "react"
import {
  ArrowUp,
  ChevronDown,
  CircuitBoard,
  Globe2,
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
import { cn } from "@/lib/utils"

interface ChipButtonProps {
  icon: React.ReactNode
  children: React.ReactNode
  active?: boolean
}

function ChipButton({ icon, children, active }: ChipButtonProps) {
  return (
    <button
      type="button"
      className={cn(
        "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px]",
        "font-mono tabular-nums transition-colors duration-[120ms]",
        active
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          : "border-border bg-card text-foreground hover:bg-muted",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
      )}
    >
      <span className="flex size-3 items-center justify-center [&_svg]:size-3">
        {icon}
      </span>
      <span>{children}</span>
      <ChevronDown className="size-3 opacity-60" strokeWidth={2} />
    </button>
  )
}

const MODELS = [
  { id: "qwen2.5", name: "qwen2.5:7b", ctx: "32k", host: "local" },
  { id: "kimi", name: "kimi-k2.6", ctx: "256k", host: "cloud" },
  { id: "gpt5.5", name: "gpt-5.5", ctx: "200k", host: "cloud" },
  { id: "claude47", name: "claude-opus-4.7", ctx: "1M", host: "cloud" },
] as const

function ModelPickerPopover({ value }: { value: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <ChipButton icon={<Sparkles strokeWidth={2} />}>{value}</ChipButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-72 p-1.5">
        <div className="px-2.5 pb-1.5 pt-1 text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          model · per question
        </div>
        <div className="flex flex-col">
          {MODELS.map((m) => {
            const selected = m.name === value
            return (
              <button
                key={m.id}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-[120ms]",
                  "hover:bg-accent focus-visible:bg-accent focus-visible:outline-none",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-3.5 place-items-center rounded-full border",
                    selected ? "border-primary" : "border-border",
                  )}
                >
                  {selected && (
                    <span className="size-1.5 rounded-full bg-primary" />
                  )}
                </span>
                <span className="flex flex-1 flex-col">
                  <span className="text-[13px] font-medium text-foreground">
                    {m.name}
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    ctx {m.ctx}
                  </span>
                </span>
                <Badge
                  variant={m.host === "local" ? "secondary" : "outline"}
                  className="font-mono text-[10px] tracking-wide"
                >
                  {m.host}
                </Badge>
              </button>
            )
          })}
        </div>
      </PopoverContent>
    </Popover>
  )
}

function RetrievalKnobsPopover() {
  const [kRetrieve, setKRetrieve] = useState(32)
  const [kRerank, setKRerank] = useState(5)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <ChipButton icon={<Settings2 strokeWidth={2} />}>
            retrieve {kRetrieve} · rerank {kRerank}
          </ChipButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          retrieval knobs · per question
        </div>
        <div className="mt-3 space-y-4">
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-[12.5px] font-medium">k_retrieve</Label>
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                {kRetrieve}
              </span>
            </div>
            <Slider
              value={[kRetrieve]}
              min={1}
              max={100}
              step={1}
              onValueChange={(v) => setKRetrieve(v[0])}
            />
          </div>
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <Label className="text-[12.5px] font-medium">k_rerank</Label>
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                {kRerank}
              </span>
            </div>
            <Slider
              value={[kRerank]}
              min={1}
              max={32}
              step={1}
              onValueChange={(v) => setKRerank(v[0])}
            />
          </div>
          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <span className="font-mono text-[11px] text-muted-foreground">
              RRF k = 60
            </span>
            <Button variant="ghost" size="sm" className="h-7 px-2.5 text-[12px]">
              save as default
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function GraphTogglePopover() {
  const [on, setOn] = useState(true)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <ChipButton icon={<CircuitBoard strokeWidth={2} />} active={on}>
            graph {on ? "on" : "off"}
          </ChipButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-64 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          knowledge graph · per question
        </div>
        <div className="mt-3 flex items-center justify-between">
          <Label className="text-[13px] font-medium">use graph retriever</Label>
          <Switch checked={on} onCheckedChange={setOn} />
        </div>
        <p className="mt-2 text-[12px] leading-[1.55] text-muted-foreground">
          Neo4j 1-hop traversal joined into RRF fusion. Off when you only want
          dense + sparse.
        </p>
      </PopoverContent>
    </Popover>
  )
}

function FallbackPopover() {
  const [thr, setThr] = useState(62)
  return (
    <Popover>
      <PopoverTrigger asChild>
        <span>
          <ChipButton icon={<Globe2 strokeWidth={2} />}>
            fallback · {(thr / 100).toFixed(2)}
          </ChipButton>
        </span>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={10} className="w-80 p-4">
        <div className="text-[10.5px] font-mono uppercase tracking-wide text-muted-foreground">
          web fallback · per question
        </div>
        <div className="mt-3 space-y-2">
          <div className="flex items-baseline justify-between">
            <Label className="text-[12.5px] font-medium">trigger threshold</Label>
            <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
              {(thr / 100).toFixed(2)}
            </span>
          </div>
          <Slider
            value={[thr]}
            min={0}
            max={100}
            step={1}
            onValueChange={(v) => setThr(v[0])}
          />
          <p className="text-[12px] leading-[1.55] text-muted-foreground">
            When local rerank scores stay below this floor, SearxNG is queried
            and HITL approval is required before any URL is crawled.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export interface ComposerProps {
  placeholder?: string
  focused?: boolean
  streaming?: boolean
  /** Controlled input — when omitted the composer keeps its own draft. */
  value?: string
  onChange?: (next: string) => void
  /** Fires on submit (Enter without shift, or send button). */
  onSubmit?: (text: string) => void
}

export function Composer({
  placeholder = "Ask anything across your corpus.",
  focused = false,
  streaming = false,
  value,
  onChange,
  onSubmit,
}: ComposerProps) {
  const [draft, setDraft] = useState("")
  const controlled = value !== undefined
  const text = controlled ? value : draft
  const setText = (next: string) => {
    if (controlled) onChange?.(next)
    else setDraft(next)
  }

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
        focused ? "border-primary/40 ring-2 ring-ring/30 ring-offset-2 ring-offset-background" : "border-border",
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
          aria-label="attach"
          className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-[120ms] hover:bg-muted hover:text-foreground"
        >
          <Paperclip className="size-3.5" strokeWidth={2} />
        </button>
        <ModelPickerPopover value="qwen2.5:7b" />
        <RetrievalKnobsPopover />
        <GraphTogglePopover />
        <FallbackPopover />
        {streaming && (
          <span className="ml-auto inline-flex items-center gap-1.5 font-mono text-[11px] text-primary">
            <span
              className="size-1.5 rounded-full bg-primary"
              style={{
                boxShadow:
                  "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)",
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
