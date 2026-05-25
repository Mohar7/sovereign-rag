import { useEffect, useMemo, useRef, useState } from "react"
import { AlertTriangle, Loader2, X } from "lucide-react"
import { toast } from "sonner"

import {
  Composer,
  DEFAULT_COMPOSER_CONFIG,
  type ComposerConfig,
} from "@/components/ask/composer"
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
import { CitationChip, MonoTag } from "@/components/ask/citation-chip"
import { TurnInspectorSheet } from "@/components/ask/turn-inspector-sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useCorpusStats } from "@/hooks/use-ask"
import { useAskStream } from "@/hooks/use-ask-stream"
import { useThreadMessages } from "@/hooks/use-threads"
import type { AskOverrides, CitationModel } from "@/lib/api"
import type { CitationKind } from "@/components/ask/citation-chip"

interface Turn {
  id: number
  question: string
  status: "pending" | "ok" | "error"
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
}

/** Tag a stage name as known; everything else is a no-op. */
function isKnownStage(name: string): name is StageName {
  return name === "retrieve_local" || name === "rerank" || name === "generate"
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

/** Backend doesn't yet tag citations with a retrieval kind — default hybrid. */
function pickKind(_c: CitationModel): CitationKind {
  return "hybrid"
}

function citationToSource(c: CitationModel, i: number): SourceItem {
  return {
    n: i + 1,
    kind: pickKind(c),
    title: c.title || "untitled",
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
  const [turns, setTurns] = useState<Turn[]>([])
  const [composerText, setComposerText] = useState("")
  const [composerConfig, setComposerConfig] = useState<ComposerConfig>(
    DEFAULT_COMPOSER_CONFIG,
  )
  const [inspectorTurnId, setInspectorTurnId] = useState<number | null>(null)
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
            for (const name of ["retrieve_local", "rerank", "generate"] as const) {
              const v = final.timings[name]
              if (typeof v === "number") {
                stages[name] = { phase: "done", elapsedMs: v }
              }
            }
          }
          return {
            ...t,
            status: "ok",
            // If the backend emitted tokens, t.answer is already populated;
            // only overwrite if the streamed answer was empty.
            answer: t.answer && t.answer.length > 0 ? t.answer : final.answer,
            citations: final.citations.length > 0 ? final.citations : t.citations ?? [],
            retrieved: final.retrieved,
            used: final.used,
            threadId: final.thread_id,
            stages,
            totalMs: final.timings?.total,
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

  const inspectedTurn = turns.find((t) => t.id === inspectorTurnId) ?? null

  const isRestoring = restoredThreadId !== null && turns.length === 0
  const isEmpty = turns.length === 0 && !isRestoring
  const latestTurn = turns[turns.length - 1]
  const latestCitations = latestTurn?.citations ?? []
  const sources = useMemo<SourceItem[]>(
    () => latestCitations.map(citationToSource),
    [latestCitations],
  )
  const sourcesLoading = !!latestTurn && latestTurn.status === "pending"

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 w-full overflow-hidden">
      <div className="flex min-w-0 flex-1 flex-col">
        {isEmpty ? (
          <ScrollArea className="flex-1">
            <div className="mx-auto h-full w-full max-w-3xl px-6">
              <AskEmptyControlled
                value={composerText}
                onChange={setComposerText}
                onSubmit={handleSubmit}
                stats={corpus.data}
                config={composerConfig}
                onConfigChange={setComposerConfig}
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
                      resuming
                    </Badge>
                    <span className="truncate font-mono text-[11.5px] text-muted-foreground">
                      {restoredThreadId}
                    </span>
                    <button
                      type="button"
                      onClick={startFresh}
                      className="ml-auto text-[12px] text-primary hover:underline"
                    >
                      Start fresh
                    </button>
                  </div>
                )}
                {isRestoring && (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" />
                    Restoring conversation history…
                  </div>
                )}
                {turns.map((t) => (
                  <ConversationTurn
                    key={t.id}
                    turn={t}
                    onRegenerate={() => handleRegenerate(t)}
                    onOpenInspector={() => setInspectorTurnId(t.id)}
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
          title="Sources"
          subtitle={
            sourcesLoading
              ? "retrieving"
              : sources.length > 0
                ? `${sources.length} of ${sources.length}`
                : undefined
          }
        />
      )}

      <TurnInspectorSheet
        turn={inspectedTurn}
        open={inspectorTurnId !== null}
        onOpenChange={(o) => !o && setInspectorTurnId(null)}
      />
    </div>
  )
}

interface AskEmptyControlledProps {
  value: string
  onChange: (next: string) => void
  onSubmit: (text: string) => void
  stats: ReturnType<typeof useCorpusStats>["data"]
  config: ComposerConfig
  onConfigChange: (next: ComposerConfig) => void
}

function AskEmptyControlled({
  value,
  onChange,
  onSubmit,
  stats,
  config,
  onConfigChange,
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
  if (!stats) {
    return (
      <div
        aria-hidden
        className="flex items-center justify-center gap-2 font-mono text-[12px] text-muted-foreground"
      >
        <Loader2 className="size-3.5 animate-spin" />
        loading corpus stats…
      </div>
    )
  }
  const rows: Array<[string, string]> = [
    [stats.documents.toLocaleString(), "documents"],
    [stats.chunks.toLocaleString(), "chunks"],
    [stats.entities.toLocaleString(), "entities"],
    [stats.relations.toLocaleString(), "relations"],
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
}: {
  turn: Turn
  onRegenerate?: () => void
  onOpenInspector?: () => void
}) {
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
              <span className="text-primary">streaming</span>
            </>
          }
        >
          {turn.stages && (
            <div className="mb-3">
              <PipelineStrip stages={turn.stages} />
            </div>
          )}
          {turn.answer && turn.answer.length > 0 ? (
            <AnswerWithCitations
              answer={turn.answer + "▍"}
              citations={turn.citations ?? []}
            />
          ) : (
            <p className="text-muted-foreground">
              Retrieving and reranking
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

      {turn.status === "error" && (
        <ErrorBanner message={turn.error ?? "Request failed."} />
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
                {turn.used} of {turn.retrieved} chunks
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
            </>
          }
        >
          <AnswerWithCitations
            answer={turn.answer ?? ""}
            citations={turn.citations ?? []}
          />
        </AssistantTurn>
      )}
    </>
  )
}

function EmptyAnswerFallback({ citations }: { citations: CitationModel[] }) {
  if (citations.length === 0) {
    return (
      <Card className="bg-muted/50">
        <CardContent className="p-4 text-sm text-muted-foreground">
          The model returned no answer and no sources matched.
        </CardContent>
      </Card>
    )
  }
  return (
    <div className="space-y-3">
      <p className="text-sm italic text-muted-foreground">
        The model returned no answer text. Showing the {citations.length}{" "}
        retrieved chunk{citations.length === 1 ? "" : "s"} instead.
      </p>
      <ol className="space-y-2.5">
        {citations.map((c, i) => (
          <li
            key={c.chunk_id}
            className="rounded-lg border border-border bg-card p-3"
          >
            <div className="flex items-baseline gap-2 text-[12px] text-muted-foreground">
              <span className="font-mono font-semibold text-primary">
                [{i + 1}]
              </span>
              <span className="truncate font-medium text-foreground">
                {c.title || "untitled"}
              </span>
              {c.page !== null && c.page !== undefined && (
                <span className="font-mono tabular-nums">p.{c.page}</span>
              )}
              <span className="ml-auto font-mono tabular-nums">
                {c.score.toFixed(2)}
              </span>
            </div>
            <p className="mt-1.5 line-clamp-4 text-[13.5px] leading-[1.55] text-muted-foreground">
              {c.snippet}
            </p>
          </li>
        ))}
      </ol>
    </div>
  )
}

function ErrorBanner({ message }: { message: string }) {
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
          The /ask call failed.
        </div>
        <div className="mt-1 break-words font-mono text-[12px] leading-[1.55] text-muted-foreground">
          {message}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-8" aria-label="dismiss">
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
  )
}

function AnswerWithCitations({
  answer,
  citations,
}: {
  answer: string
  citations: CitationModel[]
}) {
  if (!answer) {
    return <EmptyAnswerFallback citations={citations} />
  }

  const parts: React.ReactNode[] = []
  const re = /\[(\d+)\]/g
  let lastIdx = 0
  let match: RegExpExecArray | null
  let key = 0
  while ((match = re.exec(answer)) !== null) {
    if (match.index > lastIdx) parts.push(answer.slice(lastIdx, match.index))
    const n = parseInt(match[1], 10)
    const cite = citations[n - 1]
    parts.push(
      cite ? (
        <CitationChip
          key={`c-${key++}`}
          n={n}
          kind={pickKind(cite)}
          doc={cite.title}
          page={cite.page ?? undefined}
          snippet={cite.snippet}
        />
      ) : (
        <MonoTag key={`m-${key++}`}>[{n}]</MonoTag>
      ),
    )
    lastIdx = re.lastIndex
  }
  if (lastIdx < answer.length) parts.push(answer.slice(lastIdx))

  const paragraphs = parts.reduce<React.ReactNode[][]>(
    (acc, node) => {
      if (typeof node === "string") {
        const segs = node.split(/\n{2,}/)
        segs.forEach((seg, i) => {
          if (i > 0) acc.push([])
          if (seg) acc[acc.length - 1].push(seg)
        })
      } else {
        acc[acc.length - 1].push(node)
      }
      return acc
    },
    [[]],
  )

  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={i} className={i === 0 ? "" : "mt-4"}>
          {p}
        </p>
      ))}
    </>
  )
}
