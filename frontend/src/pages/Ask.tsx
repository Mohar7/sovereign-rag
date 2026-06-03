import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import {
  Composer,
  DEFAULT_COMPOSER_CONFIG,
  type ComposerConfig,
} from "@/components/ask/composer"
import { ContextManagerSheet } from "@/components/ask/context-manager-sheet"
import {
  PipelineStrip,
  emptyStages,
  type StageName,
  type StageState,
} from "@/components/ask/pipeline-strip"
import {
  SourcesRail,
  type SourceItem,
} from "@/components/ask/sources-rail"
import { AskEmptyHeader } from "@/components/ask/states"
import { AssistantTurn, UserTurn } from "@/components/ask/turns"
import { CitationChip } from "@/components/ask/citation-chip"
import { MarkdownAnswer } from "@/components/ask/markdown-answer"
import {
  ApprovalCard,
  DeclinedChip,
  type CrawlProgressItem,
} from "@/components/ask/approval-card"
import { AgentTrace } from "@/components/ask/agent-trace"
import { ProvenanceBadge } from "@/components/crag/provenance-badge"
import { TurnInspectorSheet, type InspectableTurn } from "@/components/ask/turn-inspector-sheet"
import { SourceDrawer } from "@/components/library/source-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCorpusStats } from "@/hooks/use-ask"
import { useAskStream } from "@/hooks/use-ask-stream"
import { useThreadMessages } from "@/hooks/use-threads"
import { pickKind } from "@/lib/citation-kind"
import { formatCount } from "@/lib/format"
import i18n from "@/lib/i18n"
import type { AskOverrides, CitationModel, CandidateUrl, DocumentSummary, GradeModel } from "@/lib/api"

interface Turn {
  id: number
  question: string
  status: "pending" | "awaiting_approval" | "crawling" | "ok" | "error"
  answer?: string | null
  citations?: CitationModel[]
  retrieved?: number
  used?: number
  error?: string
  threadId?: string
  /** The overrides that were in effect when this turn was submitted. */
  overrides?: AskOverrides | null
  /** Per-node pipeline state, populated from the SSE node events. */
  stages?: Record<StageName, StageState>
  /** Total elapsed ms — populated on the final done event. */
  totalMs?: number
  /** Grade outcome from the grader node. */
  grade?: GradeModel | null
  /** Candidate URLs surfaced by the interrupt event. */
  candidateUrls?: CandidateUrl[]
  /** Per-URL crawl progress events. */
  crawlProgress?: CrawlProgressItem[]
  /** True when the answer was augmented by a web fallback crawl. */
  fallbackUsed?: boolean
  /** True when the user declined the web fallback. */
  declined?: boolean
  /** Ordered agent tool steps for this turn (ReAct mode). */
  agentSteps?: { tool: string }[]
}

/** Tag a stage name as known; everything else is a no-op. */
function isKnownStage(name: string): name is StageName {
  return (
    name === "retrieve_local" ||
    name === "rerank" ||
    name === "grade" ||
    name === "transform_query" ||
    name === "web_search" ||
    name === "crawl_index" ||
    name === "generate"
  )
}

/** Convert a composer config to the wire-shape AskOverrides (drops nulls). */
function buildOverrides(cfg: ComposerConfig): AskOverrides | null {
  const o: AskOverrides = {}
  if (cfg.model) o.model = cfg.model
  if (cfg.retrieveTopK != null) o.retrieve_top_k = cfg.retrieveTopK
  if (cfg.rerankTopK != null) o.rerank_top_k = cfg.rerankTopK
  if (cfg.graphEnabled != null) o.enable_graph_retrieval = cfg.graphEnabled
  return Object.keys(o).length > 0 ? o : null
}

function citationToSource(c: CitationModel, i: number): SourceItem {
  return {
    n: i + 1,
    kind: pickKind(c),
    title: c.title || i18n.t("common.untitled"),
    doc: c.source_uri || c.doc_id,
    page: c.page ?? undefined,
    score: c.score,
    snippet: c.snippet,
    used: true,
  }
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
  // The citation the user clicked "open in source detail" on. We hold the
  // whole CitationModel (not just the chunk_id) so we can synthesize a
  // DocumentSummary header without an extra round-trip; the drawer fetches
  // the actual chunks list lazily via /api/library/{doc_id}/chunks.
  const [sourceCitation, setSourceCitation] = useState<CitationModel | null>(null)
  const [restoredThreadId, setRestoredThreadId] = useState<string | null>(
    () => readThreadFromURL(),
  )
  const turnCounter = useRef(0)
  // The id of the currently-streaming turn — read in stream callbacks so we
  // always patch the right row even if the user submits multiple in flight.
  const currentTurnId = useRef<number | null>(null)

  const corpus = useCorpusStats()
  const history = useThreadMessages(restoredThreadId)

  // When opening Ask with ?thread=<id>, fetch the conversation and rebuild
  // ``turns`` from the server-side history. Each (user, assistant) pair
  // becomes one Turn carrying the threadId so subsequent submits continue
  // the conversation in the same checkpoint.
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

  // Sync ?thread=… when the user navigates back or replays the URL. Reset
  // ``turns`` when the thread param flips so we don't show a stale history.
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
    onNode: (name, phase, elapsedMs) => {
      const id = currentTurnId.current
      if (id == null || !isKnownStage(name)) return
      setTurns((prev) =>
        prev.map((t) => {
          if (t.id !== id) return t
          const stages = { ...(t.stages ?? emptyStages()) }
          stages[name] = {
            phase: phase === "start" ? "running" : "done",
            elapsedMs: phase === "done" ? elapsedMs : undefined,
          }
          return { ...t, stages }
        }),
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
          // Reconcile final stage timings with whatever we already have, so
          // late `done` numbers replace running placeholders.
          const stages = { ...(t.stages ?? emptyStages()) }
          if (final.timings) {
            for (const name of ["retrieve_local", "rerank", "grade", "transform_query", "web_search", "crawl_index", "generate"] as const) {
              const v = final.timings[name]
              if (typeof v === "number") {
                stages[name] = { phase: "done", elapsedMs: v }
              }
            }
          }
          return {
            ...t,
            status: "ok" as const,
            // If the backend emitted tokens, t.answer is already populated;
            // only overwrite if the streamed answer was empty.
            answer: t.answer && t.answer.length > 0 ? t.answer : final.answer,
            citations: final.citations.length > 0 ? final.citations : t.citations ?? [],
            retrieved: final.retrieved,
            used: final.used,
            threadId: final.thread_id,
            stages,
            totalMs: final.timings?.total,
            // Provenance: the done event reports whether the web fallback
            // contributed. (turn.grade is already preserved via ...t from the
            // onGrade event, so it isn't re-set here.)
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
    onGrade: (label, confidence, reason) => {
      const id = currentTurnId.current
      if (id == null) return
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id ? { ...t, grade: { label, confidence, reason } } : t,
        ),
      )
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
          // Upsert: update existing entry by URL or append new one
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
      stages: emptyStages(),
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
    // Re-run the same question against the same thread; the LangGraph
    // checkpoint history gets a fresh turn appended rather than overwritten.
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

  /** User declined the web fallback — resume with empty approved_urls (signal for decline). */
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
        stages: inspectedTurnRaw.stages,
        totalMs: inspectedTurnRaw.totalMs,
      }
    : null
  // The first turn carries the thread_id once the SSE done arrives; before
  // that we may still have a restoredThreadId (from /?thread=...). Either
  // is a valid anchor for the context manager.
  const activeThreadId = turns[0]?.threadId ?? restoredThreadId ?? null

  // Show the restoring spinner only while the history fetch is genuinely in
  // flight, or while rows have arrived but the build effect above hasn't
  // populated `turns` yet (one render tick). Once the query settles — success
  // (incl. an empty/paused thread with no answered turns) or error — stop
  // spinning and fall through to the composer. Without the query-state guard a
  // paused/answerless thread (read_thread_messages returns []) spins forever.
  const hasHistoryRows = (history.data?.length ?? 0) > 0
  const isRestoring =
    restoredThreadId !== null &&
    turns.length === 0 &&
    (history.isLoading || hasHistoryRows)
  const isEmpty = turns.length === 0 && !isRestoring
  const latestTurn = turns[turns.length - 1]
  const latestCitations = latestTurn?.citations ?? []
  const sources = useMemo<SourceItem[]>(
    () => latestCitations.map(citationToSource),
    [latestCitations],
  )
  const sourcesLoading = !!latestTurn && latestTurn.status === "pending"

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
                onAttach={undefined /* no thread yet — context manager needs one */}
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

      {!isEmpty && (
        <SourcesRail
          sources={sources}
          loading={sourcesLoading}
          title={t("pages.ask.sourcesTitle")}
          subtitle={
            sourcesLoading
              ? t("pages.ask.retrieving")
              : sources.length > 0
                ? t("pages.ask.sourcesCount", {
                    used: formatCount(sources.length),
                    total: formatCount(sources.length),
                  })
                : undefined
          }
        />
      )}

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
 * its header without a separate round-trip. The chunks count is a
 * placeholder; the drawer replaces it with the real count once the chunks
 * query resolves. */
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

function ConversationTurn({
  turn,
  onRegenerate,
  onOpenInspector,
  onOpenSource,
  onApprove,
  onDecline,
}: {
  turn: Turn
  onRegenerate?: () => void
  onOpenInspector?: () => void
  onOpenSource?: (cite: CitationModel) => void
  onApprove?: (urls: string[]) => void
  onDecline?: () => void
}) {
  const { t } = useTranslation()

  // Detect whether the corrective path ran
  const corrective =
    turn.stages != null &&
    (turn.stages.transform_query.phase !== "idle" ||
      turn.stages.web_search.phase !== "idle" ||
      turn.stages.crawl_index.phase !== "idle")

  return (
    <>
      <UserTurn>{turn.question}</UserTurn>

      {turn.status === "pending" && (
        <AssistantTurn
          showActions={false}
          meta={
            <>
              <span
                aria-hidden
                className="size-1.5 rounded-full bg-primary"
                style={{
                  boxShadow:
                    "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)",
                  animation: "sr-pulse 1.4s ease-in-out infinite",
                }}
              />
              <span className="text-primary">{t("status.streaming")}</span>
            </>
          }
        >
          {turn.agentSteps && turn.agentSteps.length > 0 && <AgentTrace steps={turn.agentSteps} />}
          {turn.stages && (
            <div className="mb-3">
              <PipelineStrip
                stages={turn.stages}
                grade={turn.grade}
                corrective={corrective}
              />
            </div>
          )}
          {turn.answer && turn.answer.length > 0 ? (
            <MarkdownAnswer
              answer={turn.answer + "▍"}
              citations={turn.citations ?? []}
              onOpenSource={onOpenSource}
            />
          ) : (
            <p className="text-muted-foreground">
              {t("pages.ask.retrievingReranking")}
              <span
                aria-hidden
                className="ml-1 inline-block align-[-3px]"
                style={{
                  background: "var(--primary)",
                  width: 8,
                  height: 16,
                  animation: "sr-blink 1.1s steps(2) infinite",
                }}
              />
            </p>
          )}
        </AssistantTurn>
      )}

      {turn.status === "awaiting_approval" && (
        <AssistantTurn
          showActions={false}
          meta={
            <>
              <span>sovereign-rag</span>
              <span aria-hidden>·</span>
              <span>{t("pages.ask.pipeline.grade")}</span>
            </>
          }
        >
          {turn.agentSteps && turn.agentSteps.length > 0 && <AgentTrace steps={turn.agentSteps} />}
          {turn.stages && (
            <div className="mb-3">
              <PipelineStrip
                stages={turn.stages}
                grade={turn.grade}
                corrective={corrective}
              />
            </div>
          )}
          <ApprovalCard
            state="deciding"
            candidates={turn.candidateUrls ?? []}
            grade={turn.grade}
            question={turn.question}
            onApprove={onApprove ?? (() => {})}
            onDecline={onDecline ?? (() => {})}
          />
        </AssistantTurn>
      )}

      {turn.status === "crawling" && (
        <AssistantTurn
          showActions={false}
          meta={
            <>
              <span>sovereign-rag</span>
              <span aria-hidden>·</span>
              <span className="text-primary">{t("crag.crawling.crawling")}</span>
            </>
          }
        >
          {turn.agentSteps && turn.agentSteps.length > 0 && <AgentTrace steps={turn.agentSteps} />}
          {turn.stages && (
            <div className="mb-3">
              <PipelineStrip
                stages={turn.stages}
                grade={turn.grade}
                corrective
              />
            </div>
          )}
          <ApprovalCard state="crawling" progress={turn.crawlProgress ?? []} />
        </AssistantTurn>
      )}

      {turn.status === "error" && (
        <ErrorBanner message={turn.error ?? t("pages.ask.requestFailed")} />
      )}

      {turn.status === "ok" && (
        <AssistantTurn
          copyText={turn.answer ?? ""}
          onRegenerate={onRegenerate}
          onOpenInspector={onOpenInspector}
          meta={
            <>
              <span>sovereign-rag</span>
              <span aria-hidden>·</span>
              <span className="tabular-nums">
                {t("pages.ask.chunksUsed", {
                  used: formatCount(turn.used ?? 0),
                  total: formatCount(turn.retrieved ?? 0),
                })}
              </span>
              {turn.totalMs !== undefined && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">
                    {turn.totalMs < 1000
                      ? `${turn.totalMs}ms`
                      : `${(turn.totalMs / 1000).toFixed(1)}s`}
                  </span>
                </>
              )}
              {turn.overrides?.model && (
                <>
                  <span aria-hidden>·</span>
                  <span className="text-primary/80">{turn.overrides.model}</span>
                </>
              )}
              {turn.fallbackUsed && (
                <>
                  <span aria-hidden>·</span>
                  <ProvenanceBadge />
                </>
              )}
            </>
          }
        >
          {turn.declined && (
            <div className="mb-3">
              <DeclinedChip />
            </div>
          )}
          {turn.agentSteps && turn.agentSteps.length > 0 && <AgentTrace steps={turn.agentSteps} />}
          {turn.stages && (
            <div className="mb-3">
              <PipelineStrip
                stages={turn.stages}
                grade={turn.grade}
                corrective={corrective}
              />
            </div>
          )}
          <MarkdownAnswer
            answer={turn.answer ?? ""}
            citations={turn.citations ?? []}
            onOpenSource={onOpenSource}
          />
          {turn.fallbackUsed && (turn.citations ?? []).length > 0 && (
            <CitationLegend citations={turn.citations ?? []} />
          )}
        </AssistantTurn>
      )}
    </>
  )
}

/**
 * Small provenance legend below the answer when fallbackUsed is true.
 * Distinguishes web-crawled citations from local corpus citations.
 */
function CitationLegend({ citations }: { citations: CitationModel[] }) {
  const { t } = useTranslation()
  const hasWeb = citations.some((c) => pickKind(c) === "web")
  const hasLocal = citations.some((c) => pickKind(c) !== "web")
  if (!hasWeb && !hasLocal) return null
  return (
    <div className="mt-4 flex flex-wrap items-center gap-4 rounded-lg border border-border bg-muted px-3.5 py-3">
      <span className="font-mono text-[11.5px] text-muted-foreground">
        {t("crag.citationLegend.title")}
      </span>
      {hasWeb && (
        <span className="inline-flex items-center gap-1.5 text-[12.5px]">
          <CitationChip n={2} kind="web" />
          <span className="text-muted-foreground">{t("crag.citationLegend.webCrawled")}</span>
        </span>
      )}
      {hasLocal && (
        <span className="inline-flex items-center gap-1.5 text-[12.5px]">
          <CitationChip n={1} kind="vector" />
          <span className="text-muted-foreground">{t("crag.citationLegend.localCorpus")}</span>
        </span>
      )}
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-4"
      style={{
        background: "color-mix(in oklab, var(--destructive) 6%, transparent)",
        borderColor: "color-mix(in oklab, var(--destructive) 35%, transparent)",
      }}
    >
      <AlertTriangle
        className="mt-0.5 size-[18px] shrink-0 text-[color:var(--destructive)]"
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-foreground">
          {t("pages.ask.askCallFailed")}
        </div>
        <div className="mt-1 break-words font-mono text-[12px] leading-[1.55] text-muted-foreground">
          {message}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-8" aria-label={t("pages.ask.dismiss")}>
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
  )
}

