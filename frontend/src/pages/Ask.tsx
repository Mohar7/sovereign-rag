import { useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  Composer,
  DEFAULT_COMPOSER_CONFIG,
  type ComposerConfig,
} from "@/components/ask/composer"
import { ContextManagerSheet } from "@/components/ask/context-manager-sheet"
import { ConversationTurn, type Turn } from "@/components/ask/conversation-turn"
import { AskEmptyHeader } from "@/components/ask/states"
import { TurnInspectorSheet, type InspectableTurn } from "@/components/ask/turn-inspector-sheet"
import { SourceDrawer } from "@/components/library/source-drawer"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCorpusStats } from "@/hooks/use-ask"
import { useAskStream } from "@/hooks/use-ask-stream"
import { useThreadMessages } from "@/hooks/use-threads"
import { formatCount } from "@/lib/format"
import i18n from "@/lib/i18n"
import type { AskOverrides, CitationModel, DocumentSummary } from "@/lib/api"
import type { CrawlProgressItem } from "@/components/ask/approval-card"

/** Convert a composer config to the wire-shape AskOverrides (drops nulls). */
function buildOverrides(cfg: ComposerConfig): AskOverrides | null {
  const o: AskOverrides = {}
  if (cfg.model) o.model = cfg.model
  if (cfg.retrieveTopK != null) o.retrieve_top_k = cfg.retrieveTopK
  if (cfg.rerankTopK != null) o.rerank_top_k = cfg.rerankTopK
  if (cfg.graphEnabled != null) o.enable_graph_retrieval = cfg.graphEnabled
  return Object.keys(o).length > 0 ? o : null
}

function readThreadFromURL(): string | null {
  if (typeof window === "undefined") return null
  return new URLSearchParams(window.location.search).get("thread")
}

export function AskPage() {
  const { t } = useTranslation()
  const [turns, setTurns] = useState<Turn[]>([])
  const [composerText, setComposerText] = useState("")
  const [composerConfig, setComposerConfig] = useState<ComposerConfig>(
    DEFAULT_COMPOSER_CONFIG,
  )
  const [inspectorTurnId, setInspectorTurnId] = useState<number | null>(null)
  const [contextOpen, setContextOpen] = useState(false)
  // The citation the user clicked "open in source detail" on.
  const [sourceCitation, setSourceCitation] = useState<CitationModel | null>(null)
  const [restoredThreadId, setRestoredThreadId] = useState<string | null>(
    () => readThreadFromURL(),
  )
  const turnCounter = useRef(0)
  // The id of the currently-streaming turn.
  const currentTurnId = useRef<number | null>(null)

  const corpus = useCorpusStats()
  const history = useThreadMessages(restoredThreadId)

  // Restore conversation from ?thread=<id>
  useEffect(() => {
    if (!restoredThreadId || !history.data) return
    const built: Turn[] = []
    for (let i = 0; i < history.data.length; i += 2) {
      const u = history.data[i]
      const a = history.data[i + 1]
      if (!u || u.role !== "user") continue
      const id = ++turnCounter.current
      built.push({
        id,
        question: u.content,
        status: "ok",
        answer: a?.content ?? "",
        citations: a?.citations ?? [],
        retrieved: a?.retrieved ?? 0,
        used: a?.used ?? 0,
        threadId: restoredThreadId,
      })
    }
    if (built.length > 0) setTurns(built)
  }, [restoredThreadId, history.data])

  // Sync ?thread=… when the user navigates back.
  useEffect(() => {
    const onPop = () => {
      const next = readThreadFromURL()
      setRestoredThreadId(next)
      setTurns([])
    }
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const startFresh = () => {
    window.history.pushState({}, "", "/")
    setRestoredThreadId(null)
    setTurns([])
    setComposerText("")
  }

  const stream = useAskStream({
    onToken: (delta) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, answer: (t.answer ?? "") + delta } : t,
        ),
      )
    },
    onCitations: (items) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) => (t.id === id ? { ...t, citations: items } : t)),
      )
    },
    onDone: (final) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          return {
            ...t,
            status: "ok" as const,
            answer: t.answer && t.answer.length > 0 ? t.answer : final.answer,
            citations: final.citations.length > 0 ? final.citations : t.citations ?? [],
            retrieved: final.retrieved,
            used: final.used,
            threadId: final.thread_id,
            totalMs: final.timings?.total,
            fallbackUsed: final.fallback_used ?? t.fallbackUsed,
          }
        }),
      )
    },
    onError: (msg) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, status: "error", error: msg } : t,
        ),
      )
      toast.error(msg)
    },
    onInterrupt: (payload) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? {
                ...t,
                status: "awaiting_approval",
                candidateUrls: payload.candidate_urls,
                threadId: payload.thread_id,
              }
            : t,
        ),
      )
    },
    onCrawlProgress: (ev) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          const existing = t.crawlProgress ?? []
          const idx = existing.findIndex((p) => p.url === ev.url)
          const updated: CrawlProgressItem[] =
            idx >= 0
              ? existing.map((p, i) =>
                  i === idx ? { url: ev.url, status: ev.status, chunks: ev.chunks } : p,
                )
              : [...existing, { url: ev.url, status: ev.status, chunks: ev.chunks }]
          return { ...t, status: "crawling", crawlProgress: updated }
        }),
      )
    },
    onAgentStep: (ev) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, agentSteps: [...(t.agentSteps ?? []), { tool: ev.tool }] }
            : t,
        ),
      )
    },
  })

  const submitWithConfig = (text: string, cfg: ComposerConfig) => {
    const id = ++turnCounter.current
    currentTurnId.current = id
    const overrides = buildOverrides(cfg)
    const placeholder: Turn = {
      id,
      question: text,
      status: "pending",
      answer: "",
      citations: [],
      overrides,
    }
    setTurns((prev) => [...prev, placeholder])
    setComposerText("")
    stream.submit({
      question: text,
      thread_id: turns[0]?.threadId,
      overrides,
    })
  }

  const handleSubmit = (text: string) => submitWithConfig(text, composerConfig)

  const handleRegenerate = (turn: Turn) => {
    submitWithConfig(turn.question, {
      model: turn.overrides?.model ?? null,
      retrieveTopK: turn.overrides?.retrieve_top_k ?? null,
      rerankTopK: turn.overrides?.rerank_top_k ?? null,
      graphEnabled: turn.overrides?.enable_graph_retrieval ?? null,
    })
  }

  /** User approved the web fallback — resume the stream with selected URLs. */
  const handleApprove = (turn: Turn, urls: string[]) => {
    if (!turn.threadId) return
    currentTurnId.current = turn.id
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turn.id ? { ...t, status: "crawling", crawlProgress: [] } : t,
      ),
    )
    stream.submitResume({ thread_id: turn.threadId, approved_urls: urls })
  }

  /** User declined the web fallback — resume with empty approved_urls. */
  const handleDecline = (turn: Turn) => {
    if (!turn.threadId) return
    currentTurnId.current = turn.id
    setTurns((prev) =>
      prev.map((t) =>
        t.id === turn.id
          ? { ...t, status: "crawling", crawlProgress: [], declined: true }
          : t,
      ),
    )
    stream.submitResume({ thread_id: turn.threadId, approved_urls: [] })
  }

  const inspectedTurnRaw = turns.find((t) => t.id === inspectorTurnId) ?? null
  const inspectedTurn: InspectableTurn | null = inspectedTurnRaw
    ? {
        id: inspectedTurnRaw.id,
        question: inspectedTurnRaw.question,
        answer: inspectedTurnRaw.answer ?? null,
        citations: inspectedTurnRaw.citations ?? [],
        retrieved: inspectedTurnRaw.retrieved ?? 0,
        used: inspectedTurnRaw.used ?? 0,
        threadId: inspectedTurnRaw.threadId,
        overrides: inspectedTurnRaw.overrides,
        agentSteps: inspectedTurnRaw.agentSteps,
        totalMs: inspectedTurnRaw.totalMs,
      }
    : null

  const activeThreadId = turns[0]?.threadId ?? restoredThreadId ?? null

  const hasHistoryRows = (history.data?.length ?? 0) > 0
  const isRestoring =
    restoredThreadId !== null &&
    turns.length === 0 &&
    (history.isLoading || hasHistoryRows)
  const isEmpty = turns.length === 0 && !isRestoring

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {isEmpty ? (
          <ScrollArea className="flex-1 min-h-0">
            <div className="mx-auto h-full w-full max-w-3xl px-6">
              <AskEmptyControlled
                value={composerText}
                onChange={setComposerText}
                onSubmit={handleSubmit}
                stats={corpus.data}
                config={composerConfig}
                onConfigChange={setComposerConfig}
                onAttach={undefined}
              />
            </div>
          </ScrollArea>
        ) : (
          <div className="relative flex-1 overflow-hidden">
            <ScrollArea className="h-full">
              <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-6 pb-32 pt-8">
                {restoredThreadId && (
                  <div className="flex items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-[12px]">
                    <Badge variant="outline" className="font-mono text-[10.5px]">
                      {t("pages.ask.resuming")}
                    </Badge>
                    <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                      {restoredThreadId}
                    </span>
                    <button
                      type="button"
                      onClick={startFresh}
                      className="ml-auto text-[12px] text-primary hover:underline"
                    >
                      {t("actions.startFresh")}
                    </button>
                  </div>
                )}
                {isRestoring && (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    {t("pages.ask.restoring")}
                  </div>
                )}
                {turns.map((t) => (
                  <ConversationTurn
                    key={t.id}
                    turn={t}
                    onRegenerate={() => handleRegenerate(t)}
                    onOpenInspector={() => setInspectorTurnId(t.id)}
                    onOpenSource={setSourceCitation}
                    onApprove={(urls) => handleApprove(t, urls)}
                    onDecline={() => handleDecline(t)}
                  />
                ))}
              </div>
            </ScrollArea>
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-0 bottom-0 h-40"
              style={{
                background:
                  "linear-gradient(to top, var(--background) 35%, color-mix(in oklab, var(--background) 60%, transparent) 70%, transparent)",
              }}
            />
            <div className="absolute inset-x-0 bottom-0 px-6 pb-6">
              <div className="mx-auto w-full max-w-3xl">
                <Composer
                  streaming={stream.isStreaming}
                  value={composerText}
                  onChange={setComposerText}
                  onSubmit={handleSubmit}
                  config={composerConfig}
                  onConfigChange={setComposerConfig}
                  onAttach={activeThreadId ? () => setContextOpen(true) : undefined}
                />
              </div>
            </div>
          </div>
        )}
      </div>

      <TurnInspectorSheet
        turn={inspectedTurn}
        open={inspectorTurnId !== null}
        onOpenChange={(o) => !o && setInspectorTurnId(null)}
      />

      <ContextManagerSheet
        threadId={activeThreadId}
        open={contextOpen}
        onOpenChange={setContextOpen}
      />

      <SourceDrawer
        doc={citationToDocSummary(sourceCitation)}
        focusChunkId={sourceCitation?.chunk_id}
        open={sourceCitation !== null}
        onOpenChange={(o) => !o && setSourceCitation(null)}
      />
    </div>
  )
}

/** Synthesize a DocumentSummary from a citation so SourceDrawer can render
 * its header without a separate round-trip. */
function citationToDocSummary(c: CitationModel | null): DocumentSummary | null {
  if (!c) return null
  return {
    doc_id: c.doc_id,
    title: c.title || i18n.t("common.untitled"),
    source_uri: c.source_uri || "",
    chunks: 0,
  }
}

interface AskEmptyControlledProps {
  value: string
  onChange: (next: string) => void
  onSubmit: (text: string) => void
  stats: ReturnType<typeof useCorpusStats>["data"]
  config: ComposerConfig
  onConfigChange: (next: ComposerConfig) => void
  onAttach?: () => void
}

function AskEmptyControlled({
  value,
  onChange,
  onSubmit,
  stats,
  config,
  onConfigChange,
  onAttach,
}: AskEmptyControlledProps) {
  return (
    <div className="flex h-full flex-col justify-center gap-7 py-10">
      <AskEmptyHeader onPickSuggestion={(text) => { onChange(text); onSubmit(text) }} />
      <div>
        <Composer
          focused
          value={value}
          onChange={onChange}
          onSubmit={onSubmit}
          config={config}
          onConfigChange={onConfigChange}
          onAttach={onAttach}
        />
      </div>
      <CorpusStatsFooter stats={stats} />
    </div>
  )
}

function CorpusStatsFooter({
  stats,
}: {
  stats: ReturnType<typeof useCorpusStats>["data"]
}) {
  const { t } = useTranslation()
  if (!stats) {
    return (
      <div
        aria-hidden
        className="flex items-center justify-center gap-2 font-mono text-[12px] text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        {t("pages.ask.loadingCorpusStats")}
      </div>
    )
  }
  const rows: Array<[string, string]> = [
    [formatCount(stats.documents), t("pages.ask.statDocuments")],
    [formatCount(stats.chunks), t("pages.ask.statChunks")],
    [formatCount(stats.entities), t("pages.ask.statEntities")],
    [formatCount(stats.relations), t("pages.ask.statRelations")],
  ]
  return (
    <div className="flex flex-wrap items-baseline justify-center gap-x-8 gap-y-2 pt-2 font-mono text-[12px] text-muted-foreground">
      {rows.map(([n, l]) => (
        <span key={l} className="inline-flex items-baseline gap-1.5">
          <span className="text-[16px] font-semibold tabular-nums text-foreground">
            {n}
          </span>
          <span>{l}</span>
        </span>
      ))}
    </div>
  )
}
