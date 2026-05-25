import {
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  GitBranch,
  Globe,
  Layers,
  Loader2,
  Network,
  Search,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react"

import { BrandMark } from "@/components/brand-mark"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"

import { CitationChip, MonoTag } from "./citation-chip"
import { Composer } from "./composer"
import { AssistantTurn, UserTurn } from "./turns"

// ─────────────────────────────────────────────────────────────────
// Empty state — corpus stats + suggestions + centered composer
// ─────────────────────────────────────────────────────────────────

interface Suggestion {
  icon: LucideIcon
  title: string
  sub: string
}

const SUGGESTIONS: Suggestion[] = [
  {
    icon: BookOpen,
    title: "Summarize the latest RRF fusion paper in the corpus.",
    sub: "tries: graph + dense + sparse",
  },
  {
    icon: Network,
    title: "Map the entities most cited across documents about hybrid retrieval.",
    sub: "neo4j 1-hop traversal",
  },
  {
    icon: Search,
    title: "Compare chunking strategies we evaluated for this corpus.",
    sub: "fixed-window / semantic / contextual",
  },
  {
    icon: GitBranch,
    title: "What changed in the eval p@5 after we switched to bge-reranker-v2-m3?",
    sub: "evals · last 30 days",
  },
]

const CORPUS_STATS: Array<[string, string]> = [
  ["42", "documents"],
  ["12,345", "chunks"],
  ["1,284", "entities"],
  ["3,401", "relations"],
]

export interface AskEmptyProps {
  /** Optional click handler when a suggestion card is picked. */
  onPickSuggestion?: (text: string) => void
}

/** Header + suggestion cards only — caller supplies composer + stats footer. */
export function AskEmptyHeader({ onPickSuggestion }: AskEmptyProps = {}) {
  return (
    <div className="flex flex-col gap-7">
      <div className="text-center">
        <div className="inline-flex size-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <BrandMark size={28} />
        </div>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight text-foreground">
          Ask anything across your corpus.
        </h1>
        <p className="mx-auto mt-2 max-w-xl text-[15px] leading-[1.6] text-muted-foreground">
          Hybrid retrieval over graph and vector, reranked by cross-encoder,
          with inline citations back to the chunks the answer actually used.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {SUGGESTIONS.map((s, i) => {
          const Icon = s.icon
          return (
            <button
              key={i}
              type="button"
              onClick={() => onPickSuggestion?.(s.title)}
              className="group flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors duration-[120ms] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="size-4" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13.5px] font-medium leading-[1.4] text-foreground">
                  {s.title}
                </span>
                <span className="mt-1 block font-mono text-[11.5px] text-muted-foreground">
                  {s.sub}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Standalone empty state with the mock composer + hardcoded stats. Kept for
 * reference / Storybook usage; the live Ask page uses ``AskEmptyHeader``
 * plus its own composer + corpus stats.
 */
export function AskEmpty() {
  return (
    <div className="flex h-full flex-col justify-center gap-7 px-6 py-10">
      <AskEmptyHeader />
      <div>
        <Composer focused />
      </div>
      <div className="flex flex-wrap items-baseline justify-center gap-x-8 gap-y-2 pt-2 font-mono text-[12px] text-muted-foreground">
        {CORPUS_STATS.map(([n, l]) => (
          <span key={l} className="inline-flex items-baseline gap-1.5">
            <span className="text-[16px] font-semibold tabular-nums text-foreground">
              {n}
            </span>
            <span>{l}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Hero — full Q&A conversation
// ─────────────────────────────────────────────────────────────────

function CalloutKnobs() {
  return (
    <div className="mt-4 flex items-center gap-3 rounded-lg border border-border bg-muted/60 px-4 py-3 font-mono text-[12.5px] text-muted-foreground">
      <Sparkles className="size-3.5 shrink-0 text-primary" strokeWidth={2} />
      <span className="flex-1">
        Used: hybrid BM25 + dense + 1-hop graph · RRF k=60 · reranker
        bge-reranker-v2-m3
      </span>
      <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]">
        Open inspector
        <ChevronRight className="size-3" strokeWidth={2} />
      </Button>
    </div>
  )
}

export function AskHero() {
  return (
    <div className="flex flex-col gap-7 pb-32">
      <UserTurn>
        Why does RRF fusion outperform linear weighting of dense and sparse
        scores in hybrid retrieval?
      </UserTurn>

      <AssistantTurn
        meta={
          <>
            <span>sovereign-rag</span>
            <span aria-hidden>·</span>
            <span>qwen2.5:7b</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">1.2s · 5 chunks</span>
          </>
        }
      >
        <p>
          RRF fusion is rank-based rather than score-based, which makes it
          robust to differences in score calibration between retrievers{" "}
          <CitationChip
            n={1}
            kind="hybrid"
            doc="weaviate.io/blog/rrf-explained"
            snippet="Reciprocal Rank Fusion ignores the raw score magnitudes and uses ranks only — robust to differences in score scale between retrievers."
          />
          . Linear weighting fails when dense cosine scores and BM25 scores live
          on different scales — you end up tuning a query-dependent weight{" "}
          <MonoTag>α</MonoTag> per query class{" "}
          <CitationChip
            n={2}
            kind="graph"
            doc="qdrant.tech/articles/sparse-dense"
            page={4}
            snippet="Per-query α can shift drastically between navigational and exploratory queries; static weighting fails for both classes simultaneously."
          />
          . RRF instead assigns each document <MonoTag>1/(k + rank)</MonoTag>{" "}
          per list and sums across lists{" "}
          <CitationChip
            n={5}
            kind="web"
            doc="elastic.co/blog/elser-vs-bm25"
            snippet="Reciprocal Rank Fusion combines rankings from heterogeneous retrievers by summing reciprocal-rank contributions — k=60 is a common default."
          />
          .
        </p>
        <p className="mt-4">
          Empirically, documents with consistent high ranks across multiple
          retrievers win regardless of score scale{" "}
          <CitationChip
            n={3}
            kind="vector"
            doc="milvus.io/docs/hybrid_search.md"
            page={2}
          />
          . In this corpus the pipeline runs Milvus hybrid search, a 1-hop
          traversal in Neo4j, fuses via RRF with <MonoTag>k=60</MonoTag>, then
          reranks the top 50 to 5 with a cross-encoder.
        </p>

        <CalloutKnobs />
      </AssistantTurn>

      <UserTurn>When would k=60 fail you?</UserTurn>

      <AssistantTurn compact showActions={false}>
        <p>
          When one retriever is confidently right and another is confidently
          wrong, RRF averages them and you lose signal{" "}
          <CitationChip n={4} kind="graph" />. Symptom: the top-1 of the
          correct list slips to rank 3–4 after fusion. Mitigations: clip k
          downward when score gaps are large; or learn per-query
          gating.
        </p>
      </AssistantTurn>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Mid-stream — pipeline strip + streaming cursor
// ─────────────────────────────────────────────────────────────────

interface PipelineStep {
  label: string
  state: "done" | "running" | "idle"
  t: string
}

const PIPELINE_STEPS: PipelineStep[] = [
  { label: "retrieve · graph", state: "done", t: "120ms" },
  { label: "retrieve · vector", state: "done", t: "180ms" },
  { label: "rrf fusion", state: "done", t: "8ms" },
  { label: "rerank · bge-m3", state: "running", t: "—" },
  { label: "generate · qwen2.5", state: "idle", t: "—" },
]

function PipelineStrip() {
  return (
    <Card className="border-border">
      <CardContent className="p-3.5">
        <div className="mb-3 flex items-center gap-2">
          <Layers className="size-3.5 text-muted-foreground" strokeWidth={2} />
          <span className="font-mono text-[12px] text-muted-foreground">
            retrieval pipeline · step 4 of 5
          </span>
          <span className="flex-1" />
          <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[12px]">
            Inspect
            <ExternalLink className="size-3" strokeWidth={2} />
          </Button>
        </div>
        <div className="flex gap-1.5">
          {PIPELINE_STEPS.map((s, i) => (
            <div key={i} className="flex flex-1 flex-col gap-1.5">
              <div
                className="h-1 rounded-full"
                style={{
                  background:
                    s.state === "done"
                      ? "var(--primary)"
                      : s.state === "running"
                        ? "color-mix(in oklab, var(--primary) 40%, transparent)"
                        : "var(--muted)",
                }}
              />
              <div className="flex items-center gap-1.5 font-mono text-[11px]">
                {s.state === "done" && (
                  <Check className="size-2.5 text-primary" strokeWidth={2.5} />
                )}
                {s.state === "running" && (
                  <Loader2
                    className="size-2.5 animate-spin text-primary"
                    strokeWidth={2}
                  />
                )}
                <span
                  className={
                    s.state === "idle"
                      ? "flex-1 truncate text-muted-foreground"
                      : "flex-1 truncate text-foreground"
                  }
                >
                  {s.label}
                </span>
                <span className="text-muted-foreground tabular-nums">{s.t}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function AskMidStream() {
  return (
    <div className="flex flex-col gap-7 pb-32">
      <UserTurn>Compare the chunking strategies we tried with this corpus.</UserTurn>

      <PipelineStrip />

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
            <span aria-hidden>·</span>
            <span>qwen2.5:7b</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">47 tok/s</span>
          </>
        }
      >
        <p>
          In this corpus we evaluated three strategies: a fixed 512-token
          window with 64-token overlap, a semantic split using sentence
          embeddings, and contextual chunking{" "}
          <CitationChip n={1} kind="hybrid" />. Contextual chunking yields the
          highest p@5
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
      </AssistantTurn>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// HITL — URL approval card inline in the conversation
// ─────────────────────────────────────────────────────────────────

interface HitlUrl {
  url: string
  title: string
  domain: string
  q: number
  chosen: boolean
}

const HITL_URLS: HitlUrl[] = [
  {
    url: "arxiv.org/abs/2410.15244",
    title: "Contextual Retrieval at Scale",
    domain: "arxiv.org",
    q: 0.91,
    chosen: true,
  },
  {
    url: "weaviate.io/blog/rrf-explained",
    title: "Reciprocal Rank Fusion explained",
    domain: "weaviate.io",
    q: 0.87,
    chosen: true,
  },
  {
    url: "milvus.io/docs/hybrid_search.md",
    title: "Milvus 2.6 hybrid search docs",
    domain: "milvus.io",
    q: 0.83,
    chosen: true,
  },
  {
    url: "qdrant.tech/articles/sparse-dense",
    title: "Sparse + dense, learned fusion",
    domain: "qdrant.tech",
    q: 0.71,
    chosen: false,
  },
  {
    url: "elastic.co/blog/elser-vs-bm25",
    title: "ELSER vs BM25 on TREC-DL",
    domain: "elastic.co",
    q: 0.66,
    chosen: false,
  },
]

export function AskHITL() {
  return (
    <div className="flex flex-col gap-7 pb-32">
      <UserTurn>Compare RRF against learned linear fusion.</UserTurn>

      <div className="flex items-start gap-3">
        <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
          <BrandMark size={16} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="mb-2.5 font-mono text-[11px] text-muted-foreground">
            local corpus: 3 chunks · decision is yours
          </div>
          <Card className="overflow-hidden">
            <div className="flex items-start gap-3 border-b border-border p-4 pb-3.5">
              <div className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] text-[color:var(--warning)]">
                <Globe className="size-[18px]" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-[1.35] text-foreground">
                  Local sources are thin. Pick which web pages to crawl into
                  the corpus.
                </div>
                <div className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">
                  SearxNG returned 12 candidates. Check the ones to crawl into
                  the corpus; the rest are dropped.
                </div>
              </div>
              <Badge
                variant="outline"
                className="gap-1 border-[color-mix(in_oklab,var(--warning)_50%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,transparent)] text-[color:var(--warning)]"
              >
                <AlertTriangle className="size-3" strokeWidth={2.25} />
                HITL
              </Badge>
            </div>

            <div className="py-1">
              {HITL_URLS.map((u, i) => (
                <label
                  key={i}
                  className={
                    "flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors duration-[120ms] " +
                    (u.chosen
                      ? "bg-primary/[0.05] hover:bg-primary/10"
                      : "hover:bg-muted/40") +
                    (i < HITL_URLS.length - 1
                      ? " border-b border-border/60"
                      : "")
                  }
                >
                  <Checkbox defaultChecked={u.chosen} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-foreground">
                      {u.title}
                    </div>
                    <div className="mt-0.5 font-mono text-[11.5px] text-muted-foreground">
                      {u.url}
                    </div>
                  </div>
                  <Badge variant="secondary" className="font-mono text-[10.5px]">
                    {u.domain}
                  </Badge>
                  <MonoTag className="w-14 text-right">
                    q {u.q.toFixed(2)}
                  </MonoTag>
                </label>
              ))}
            </div>

            <div className="flex items-center gap-3 border-t border-border bg-muted/60 px-4 py-3">
              <MonoTag>3 of 5 selected · est. 2.4 MB crawl</MonoTag>
              <span className="flex-1" />
              <Button variant="ghost" size="sm" className="h-8">
                Skip
              </Button>
              <Button size="sm" className="h-8 gap-1.5">
                <CheckCircle2 className="size-3.5" strokeWidth={2} />
                Crawl selected
                <ArrowRight className="size-3.5" strokeWidth={2} />
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Error — service down banner + degraded answer
// ─────────────────────────────────────────────────────────────────

export function AskError() {
  return (
    <div className="flex flex-col gap-7 pb-32">
      <UserTurn>
        Which reranker models have we tried and which had the best p@5?
      </UserTurn>

      <div className="flex items-start gap-3 rounded-xl border bg-[color-mix(in_oklab,var(--warning)_8%,transparent)] p-4"
           style={{
             borderColor: "color-mix(in oklab, var(--warning) 35%, transparent)",
           }}
      >
        <AlertTriangle
          className="mt-0.5 size-[18px] shrink-0 text-[color:var(--warning)]"
          strokeWidth={2}
        />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[14px] font-semibold text-foreground">
            The reranker isn't reachable. The answer below skips reranking.
          </div>
          <div className="text-[13px] leading-[1.55] text-muted-foreground">
            The <MonoTag>tei-reranker</MonoTag> service returned{" "}
            <MonoTag>connection refused</MonoTag> on <MonoTag>:8082</MonoTag>.
            The top-50 candidates from RRF were used directly.
          </div>
        </div>
        <Button variant="outline" size="sm" className="h-8 gap-1.5">
          <Loader2 className="size-3.5" strokeWidth={2} />
          Retry with rerank
        </Button>
        <Button variant="ghost" size="icon" className="size-8" aria-label="dismiss">
          <X className="size-3.5" strokeWidth={2} />
        </Button>
      </div>

      <AssistantTurn
        showActions
        meta={
          <>
            <span>answer without rerank</span>
            <span aria-hidden>·</span>
            <span>qwen2.5:7b</span>
          </>
        }
      >
        <p>
          The run history lists three candidates:{" "}
          <MonoTag>bge-reranker-v2-m3</MonoTag>,{" "}
          <MonoTag>jina-rerank-v2</MonoTag> and <MonoTag>colbertv2.0</MonoTag>.
          Across a 240-question eval, the best p@5 belongs to{" "}
          <MonoTag>bge-reranker-v2-m3</MonoTag>{" "}
          <CitationChip n={1} kind="hybrid" />, but with rerank skipped here,
          the answer's confidence is ~12 pp below its usual band.
        </p>
      </AssistantTurn>
    </div>
  )
}
