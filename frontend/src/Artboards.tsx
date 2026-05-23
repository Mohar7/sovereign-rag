// Portfolio view — renders the five Ask-screen states from the original
// design bundle, side by side, with mock data. Useful for screenshots,
// design QA, and showing the system before standing up a backend.
//
// Visit /artboards in dev (or set ?artboards=1) to see this view.

import { useState } from "react";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { Empty } from "./components/Empty";
import { ErrorBanner } from "./components/ErrorBanner";
import { PipelineStatus as PipelineStatusBar } from "./components/PipelineStatus";
import { SourceCard } from "./components/SourceCard";
import { SourcesRail } from "./components/SourcesRail";
import { ThreadHead } from "./components/ThreadHead";
import { ThreadsRail } from "./components/ThreadsRail";
import { TopBar } from "./components/TopBar";
import { Turn } from "./components/Turn";
import type { Citation, PipelineStatus as PipelineStep, ThreadSummary, Turn as TurnT } from "./lib/types";

const MOCK_THREADS: ThreadSummary[] = [
  { thread_id: "01", title: "Milvus hybrid search", question_count: 3, last_activity: "2m" },
  { thread_id: "02", title: "Why use a graph index?", question_count: 7, last_activity: "yesterday" },
  { thread_id: "03", title: "FERRET activation codeword", question_count: 1, last_activity: "3h", paused_at_interrupt: true },
  { thread_id: "04", title: "Random LangGraph notes", question_count: 12, last_activity: "4d" },
  { thread_id: "05", title: "Embedding model comparison: bge-m3 vs e5", question_count: 4, last_activity: "5d" },
  { thread_id: "06", title: "Reranker latency on M-series", question_count: 2, last_activity: "1w" },
  { thread_id: "07", title: "Docling vs unstructured.io", question_count: 9, last_activity: "1w" },
  { thread_id: "08", title: "Neo4j community plugin issues", question_count: 5, last_activity: "2w" },
];

const HERO_CITATIONS: Citation[] = [
  {
    chunk_id: "0f69e9bf-7f95-457e-9294-e791e785b531",
    doc_id: "milvus-docs",
    title: "Milvus 2.6 — Hybrid Search",
    source_uri: "https://milvus.io/docs/hybrid-search.md",
    page: null,
    score: 0.992,
    snippet:
      "Milvus 2.6 introduces native BM25 as a built-in function on text fields. A single hybrid_search call can issue both dense ANN and BM25 sub-queries, then fuse them server-side",
    kind: "hybrid",
  },
  {
    chunk_id: "595deda9-addd-47fb-b8ab-262f1f1b3bcf",
    doc_id: "rrf-paper",
    title: "Reciprocal Rank Fusion outperforms Condorcet…",
    source_uri: "corpus://rrf-paper.pdf",
    page: 3,
    score: 0.961,
    snippet:
      "The RRF score for a document d under rankings R is the sum over r ∈ R of 1 / (k + r(d)). The constant k is set to 60 in our experiments",
    kind: "vector",
  },
  {
    chunk_id: "f8a3b41c",
    doc_id: "notes",
    title: "Hybrid Retrieval — sovereign-rag internal notes",
    source_uri: "smoke://notes/hybrid-retrieval.md",
    page: null,
    score: 0.847,
    snippet:
      "We chose Milvus's native hybrid over a Pinecone-side BM25 because the second index would double our ingest cost and complicate eviction policy",
    kind: "hybrid",
  },
  {
    chunk_id: "a02c19de",
    doc_id: "vespa-blog",
    title: "RRF Tuning in Production — Vespa Blog",
    source_uri: "https://blog.vespa.ai/rrf-tuning",
    page: null,
    score: 0.812,
    snippet:
      "Practitioners tend to lower k when the dense retriever is dominant. We saw recall improve 4pp at k=20 on a customer corpus where BM25 was noisy",
    kind: "web",
  },
  {
    chunk_id: "7be1d4f2",
    doc_id: "trec-dl-2023",
    title: "TREC-DL 2023 — Rank Fusion baselines",
    source_uri: "corpus://trec-dl-2023.pdf",
    page: 12,
    score: 0.788,
    snippet:
      "Across 43 runs submitted to TREC-DL 2023, RRF with k ∈ [40, 80] was within one standard error of the per-track optimum on every track but one",
    kind: "graph",
  },
];

const HERO_TURNS: TurnT[] = [
  {
    id: "u1",
    role: "user",
    timestamp: "2026-05-23T14:22:08",
    content: "How does Milvus 2.6's hybrid search combine dense vectors and BM25?",
  },
  {
    id: "a1",
    role: "assistant",
    timestamp: "2026-05-23T14:22:09",
    status: "done",
    ttf_ms: 1400,
    total_ms: 3200,
    retrieved: 47,
    used: 5,
    fallback_used: false,
    citations: HERO_CITATIONS,
    content:
      "Milvus 2.6 implements hybrid search by issuing a dense ANN search and a sparse BM25 search _server-side in the same_ `hybrid_search` _call_, then fusing the two ranked lists with **Reciprocal Rank Fusion** [1]. The RRF constant defaults to `k = 60`, controlling how much weight low-ranked candidates retain in the fused list [2].\n\nBecause BM25 is computed natively over the same collection, you avoid maintaining a separate sparse index alongside Milvus — a real operational win [1][3].",
  },
  {
    id: "u2",
    role: "user",
    timestamp: "2026-05-23T14:24:51",
    content: "What's the default RRF constant, and what does changing it do?",
  },
  {
    id: "a2",
    role: "assistant",
    timestamp: "2026-05-23T14:24:52",
    status: "done",
    ttf_ms: 900,
    total_ms: 2700,
    retrieved: 52,
    used: 5,
    fallback_used: true,
    citations: HERO_CITATIONS,
    content:
      "The default `k` in the RRF formula is **60** [2]. Lowering it aggressively favours top-ranked candidates from each list — at `k = 10` the fusion behaves almost like a strict intersection of the top-N. Raising it (e.g. `k = 120`) gives lower-ranked candidates more influence, producing a softer blend that's useful when neither retriever dominates [4].\n\nEmpirically Milvus 2.6 ships with 60 because it lands close to the original RRF paper's reported optimum across TREC tracks [2][5].",
  },
];

const STREAMING_TURNS: TurnT[] = [
  {
    id: "u1",
    role: "user",
    timestamp: "2026-05-23T14:22:08",
    content: "How does Milvus 2.6's hybrid search combine dense vectors and BM25?",
  },
  {
    id: "a1",
    role: "assistant",
    timestamp: "2026-05-23T14:22:09",
    status: "streaming",
    citations: HERO_CITATIONS.slice(0, 2),
    content:
      "Milvus 2.6 implements hybrid search by issuing a dense ANN search and a sparse BM25 search _server-side in the same_ `hybrid_search` _call_, then fusing the two ranked lists with **Reciprocal Rank Fusion** [1]. The RRF constant defaults to `k = 60`, controlling how much weight low-ranked candidates retain in the fused list [2].\n\nBecause BM25 is computed natively over the same collection",
  },
];

const STREAMING_PIPELINE: PipelineStep[] = [
  { step: "embed query", state: "done" },
  { step: "milvus", state: "done", count: 50 },
  { step: "neo4j", state: "done", count: 23 },
  { step: "dedupe", state: "done", count: 47 },
  { step: "rerank", state: "done", count: 5 },
  { step: "generate", state: "live" },
];

const HITL_TURNS: TurnT[] = [
  {
    id: "u1",
    role: "user",
    timestamp: "2026-05-23T11:22:08",
    content: "What is the FERRET activation codeword, and how is it used?",
  },
  {
    id: "a1",
    role: "assistant",
    timestamp: "2026-05-23T11:22:09",
    status: "interrupted",
    content:
      "Your indexed corpus has only **2 chunks** mentioning _FERRET_, both from a third-party blog dated 2021 with low rerank scores (`0.41`, `0.38`). That's below the `web_fallback_min_chunks` threshold of 3 — I'd rather not guess. _I can search the web and ingest the pages you approve below._",
    interrupt: {
      reason: "approve_urls",
      candidate_urls: [
        {
          url: "https://anthropic.com/research/activations",
          title: "Anthropic — Activation passes",
          snippet: "…FERRET is one of three internal activation phrases used in evals for…",
        },
        {
          url: "https://arxiv.org/abs/2403.18421",
          title: "arXiv 2403.18421 — Codeword Triggers in LLM Evaluations",
          snippet:
            "…we survey codeword-based activation patterns including FERRET and CANARY across six labs…",
        },
        {
          url: "https://support.1password.com/secret-key/",
          title: "1Password — Secret Key (probable false positive)",
          snippet:
            "…activation phrase used during initial sign-in to derive… — unrelated to FERRET",
        },
        {
          url: "https://reddit.com/r/MachineLearning/comments/1k2/",
          title: "Reddit r/MachineLearning thread (low signal)",
          snippet: "someone heard FERRET on a podcast and is speculating, no primary source attached",
        },
      ],
    },
  },
];

const HITL_LOCAL_SOURCES: Citation[] = [
  {
    chunk_id: "ai-watch-1",
    doc_id: "ai-watch-2021",
    title: "Stale blog post — vague reference",
    source_uri: "https://ai-watch.io/posts/2021/codewords",
    page: null,
    score: 0.412,
    snippet:
      "Researchers occasionally surface internal phrases like FERRET or CANARY when discussing how labs activate hidden eval modes — the details are usually scrubbed before publication",
    kind: "vector",
  },
  {
    chunk_id: "notes-2023-10",
    doc_id: "notes",
    title: "Personal notes — unrelated mention",
    source_uri: "smoke://notes/2023-10-tooling.md",
    page: null,
    score: 0.384,
    snippet:
      "I keep confusing FERRET (the activation codeword from Anthropic's eval harness) with Apple's FERRET multimodal model — they're different",
    kind: "graph",
  },
];

const ERROR_TURNS: TurnT[] = [
  {
    id: "u1",
    role: "user",
    timestamp: "2026-05-23T14:22:08",
    content: "How does Milvus 2.6's hybrid search combine dense vectors and BM25?",
  },
  {
    id: "a1",
    role: "assistant",
    timestamp: "2026-05-23T14:22:11",
    status: "done",
    ttf_ms: 3400,
    total_ms: 3400,
    retrieved: 12,
    used: 3,
    citations: HERO_CITATIONS.slice(0, 2),
    content:
      "Based on indexed sources only: Milvus 2.6 combines dense ANN and BM25 inside a single `hybrid_search` call and fuses results with Reciprocal Rank Fusion [1]. The default RRF constant is `k = 60` [2].",
  },
];

function Frame({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="ab">
      <div className="ab-label">
        <span>{label}</span>
        <span className="badge">1440 × 900</span>
      </div>
      <div className="frame">{children}</div>
    </div>
  );
}

export function Artboards() {
  const [composer, setComposer] = useState("");
  return (
    <div className="artboards">
      <Frame label="01 · Hero · full conversation">
        <div className="ask">
          <TopBar threadTitle="Milvus hybrid search" />
          <ThreadsRail threads={MOCK_THREADS} activeId="01" onSelect={() => {}} onNew={() => {}} />
          <main className="center">
            <ThreadHead title="Milvus hybrid search" />
            <div className="conversation">
              {HERO_TURNS.map((t, i) => (
                <Turn key={t.id} turn={t} index={i} />
              ))}
            </div>
            <Composer value="" onChange={() => {}} onSubmit={() => {}} state="idle" />
          </main>
          <SourcesRail count={5} retrieved={52} used={5}>
            {HERO_CITATIONS.map((c, i) => (
              <SourceCard key={c.chunk_id} n={i + 1} citation={c} active={i === 1} />
            ))}
          </SourcesRail>
        </div>
      </Frame>

      <Frame label="02 · Empty · new thread">
        <div className="ask">
          <TopBar threadTitle="new thread · untitled" />
          <ThreadsRail threads={MOCK_THREADS} activeId={null} onSelect={() => {}} onNew={() => {}} />
          <main className="center">
            <ThreadHead title="untitled" />
            <Empty onSuggestion={setComposer} />
            <Composer value={composer} onChange={setComposer} onSubmit={() => {}} state="idle" />
          </main>
          <SourcesRail count={0} retrieved={0} used={0} showFusion={false}>
            <div className="sources-empty">
              <div className="head">— no citations yet —</div>
              Sources surface here as the model cites them. Each card shows the chunk text,
              document, page, and cross-encoder score.
            </div>
          </SourcesRail>
        </div>
      </Frame>

      <Frame label="03 · Mid-stream · streaming answer">
        <div className="ask">
          <TopBar threadTitle="Milvus hybrid search" state="streaming" />
          <ThreadsRail threads={MOCK_THREADS} activeId="01" onSelect={() => {}} onNew={() => {}} />
          <main className="center">
            <ThreadHead title="Milvus hybrid search" />
            <div className="conversation">
              {STREAMING_TURNS.map((t, i) => (
                <Turn
                  key={t.id}
                  turn={t}
                  index={i}
                  extra={
                    i === STREAMING_TURNS.length - 1 && t.role === "assistant" ? (
                      <PipelineStatusBar steps={STREAMING_PIPELINE} timer="02.8 / ~04.5s" />
                    ) : null
                  }
                />
              ))}
            </div>
            <Composer value="" onChange={() => {}} onSubmit={() => {}} state="streaming" />
          </main>
          <SourcesRail title="Sources · streaming" count={2} retrieved={47} used={5}>
            {HERO_CITATIONS.slice(0, 2).map((c, i) => (
              <SourceCard key={c.chunk_id} n={i + 1} citation={c} active={i === 0} />
            ))}
            {[0, 1].map((i) => (
              <div key={`sk-${i}`} className="skeleton-source">
                <div className="bar short" />
                <div className="bar med" />
                <div className="bar" />
              </div>
            ))}
          </SourcesRail>
        </div>
      </Frame>

      <Frame label="04 · HITL · approve URLs">
        <div className="ask">
          <TopBar threadTitle="FERRET activation codeword" state="hitl" />
          <ThreadsRail threads={MOCK_THREADS} activeId="03" onSelect={() => {}} onNew={() => {}} />
          <main className="center">
            <ThreadHead title="FERRET activation codeword" />
            <div className="conversation">
              {HITL_TURNS.map((t, i) => (
                <Turn
                  key={t.id}
                  turn={t}
                  index={i}
                  extra={
                    t.interrupt && (
                      <ApprovalCard
                        question="FERRET activation codeword"
                        candidates={t.interrupt.candidate_urls}
                        onApprove={() => {}}
                        onSkip={() => {}}
                      />
                    )
                  }
                />
              ))}
            </div>
            <Composer value="" onChange={() => {}} onSubmit={() => {}} state="idle" />
          </main>
          <SourcesRail title="Local sources · thin" count={2} retrieved={2} used={2} showFusion={false}>
            {HITL_LOCAL_SOURCES.map((c, i) => (
              <SourceCard key={c.chunk_id} n={i + 1} citation={c} />
            ))}
            <div className="fallback-note">
              <div className="head">◗ fallback active</div>
              Local rerank scores are below <span className="v">min = 0.50</span> and chunk count
              below <span className="v">min = 3</span>.<br />
              Crawl will append <span className="v">2 documents</span> to the corpus and re-rank.
            </div>
          </SourcesRail>
        </div>
      </Frame>

      <Frame label="05 · Error · backend unreachable">
        <div className="ask">
          <TopBar
            threadTitle="Milvus hybrid search"
            state="error"
            health={{ searxng: "err", openai: "warn" }}
          />
          <ThreadsRail threads={MOCK_THREADS} activeId="01" onSelect={() => {}} onNew={() => {}} />
          <main className="center">
            <ThreadHead title="Milvus hybrid search" />
            <div className="conversation">
              <ErrorBanner
                label="SearXNG · 503"
                message="Web fallback failed mid-flight"
                code="SearXNG_UNREACHABLE"
                endpoint="localhost:8888"
                onRetry={() => {}}
                onDisable={() => {}}
              />
              {ERROR_TURNS.map((t, i) => (
                <Turn key={t.id} turn={t} index={i} />
              ))}
              <div className="trace">
                <div className="head">◗ trace · 4 events</div>
                <div>
                  <span className="ts">14:22:08.412</span>{" "}
                  <span className="lvl-ok">OK</span> embed_query · bge-m3 · 18ms
                </div>
                <div>
                  <span className="ts">14:22:08.604</span>{" "}
                  <span className="lvl-ok">OK</span> milvus.hybrid_search · 12 candidates · 184ms
                </div>
                <div>
                  <span className="ts">14:22:09.219</span>{" "}
                  <span className="lvl-warn">WARN</span> neo4j.graph_retrieve · 0 candidates ·
                  empty seed set
                </div>
                <div>
                  <span className="ts">14:22:09.811</span>{" "}
                  <span className="lvl-err">ERR</span> searxng.search · ECONNREFUSED ·
                  localhost:8888 · retry 3/3 exhausted
                </div>
              </div>
            </div>
            <Composer value="" onChange={() => {}} onSubmit={() => {}} state="idle" />
          </main>
          <SourcesRail title="Sources · degraded" count={2} retrieved={12} used={3} showFusion={false}>
            {HERO_CITATIONS.slice(0, 2).map((c, i) => (
              <SourceCard key={c.chunk_id} n={i + 1} citation={c} active={i === 0} />
            ))}
            <div className="degraded-note">
              <div className="head">◗ web fallback unavailable</div>
              <span className="v">SearXNG</span> didn't respond in <span className="v">5.0s</span>{" "}
              (3 retries).
              <br />
              Last healthy: <span className="v">11 minutes ago</span>.<br />
              endpoint localhost:8888
            </div>
          </SourcesRail>
        </div>
      </Frame>
    </div>
  );
}
