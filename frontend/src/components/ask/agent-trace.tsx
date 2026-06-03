import { Box, Globe, Search, Sparkles } from "lucide-react"

/** Map a ReAct tool name to a short label + icon. */
const TOOL_META: Record<string, { label: string; Icon: typeof Search }> = {
  SearchCorpus: { label: "search corpus", Icon: Search },
  WebSearch: { label: "web search", Icon: Globe },
  CrawlAndIndex: { label: "crawl + index", Icon: Box },
}

export function AgentTrace({ steps }: { steps: { tool: string }[] }) {
  if (steps.length === 0) return null
  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 font-mono text-[11.5px] text-muted-foreground">
      <Sparkles className="size-3 text-primary" strokeWidth={2} />
      {steps.map((s, i) => {
        const meta = TOOL_META[s.tool] ?? { label: s.tool, Icon: Search }
        const Icon = meta.Icon
        return (
          <span key={i} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden className="text-border">→</span>}
            <span className="inline-flex items-center gap-1 rounded-sm border border-border bg-muted/50 px-1.5 py-0.5">
              <Icon className="size-3" strokeWidth={2} />
              {meta.label}
            </span>
          </span>
        )
      })}
    </div>
  )
}
