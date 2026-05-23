// Shared front-end contracts. Mirror what the LangGraph server's
// `sovereign_qa` graph emits in its state — see
// `src/sovereign_rag/agent/state.py` on the back-end side.

export type CitationKind = "hybrid" | "graph" | "vector" | "web";

export interface Citation {
  chunk_id: string;
  doc_id: string;
  title: string;
  source_uri: string;
  page: number | null;
  score: number;
  snippet: string;
  kind?: CitationKind;
}

export interface CandidateURL {
  url: string;
  title: string;
  snippet: string;
}

export interface AskInterrupt {
  reason: "approve_urls";
  candidate_urls: CandidateURL[];
}

export interface Turn {
  id: string;
  role: "user" | "assistant";
  timestamp: string;
  /** Markdown-ish text the assistant streamed. Contains `[1]`, `[2]`, …
   *  inline; the renderer replaces those with CitationChip components. */
  content: string;
  citations?: Citation[];
  retrieved?: number;
  used?: number;
  fallback_used?: boolean;
  ttf_ms?: number;
  total_ms?: number;
  /** When the assistant is paused at an HITL interrupt. */
  interrupt?: AskInterrupt;
  status?: "streaming" | "done" | "interrupted" | "error";
  error?: string;
}

export interface ThreadSummary {
  thread_id: string;
  title: string;
  question_count: number;
  last_activity: string;
  paused_at_interrupt?: boolean;
}

export interface RetrievalKnobs {
  retrieve_top_k: number;
  rerank_top_k: number;
  web_fallback_min_chunks: number;
  web_fallback_max_urls: number;
  enable_graph_retrieval: boolean;
  enable_contextual_retrieval: boolean;
}

export interface ServiceHealth {
  milvus: "ok" | "warn" | "err";
  neo4j: "ok" | "warn" | "err";
  postgres: "ok" | "warn" | "err";
  searxng: "ok" | "warn" | "err";
  ollama: "ok" | "warn" | "err";
  openai: "ok" | "warn" | "err";
}

/** Pipeline step labels emitted by the graph during a run. */
export type PipelineStep =
  | "embed query"
  | "milvus"
  | "neo4j"
  | "dedupe"
  | "rerank"
  | "generate";

export interface PipelineStatus {
  step: PipelineStep;
  state: "pending" | "live" | "done";
  count?: number;
}

/** Per-LangGraph-node timing captured client-side from the stream events.
 * Only nodes the graph actually emits as `updates` are observable here —
 * which means retrieve_local / web_fallback / rerank / generate. The
 * inspector aliases these onto the design's seven sub-stages. */
export interface NodeTiming {
  node: string;
  started_at_ms: number;
  ended_at_ms: number | null;
}

/** Live snapshot of the most recently observed inspector data — populated
 * by useRun from the `values` + `updates` SSE events as the run progresses,
 * consumed by <RetrievalInspector>. */
export interface InspectorData {
  question: string | null;
  /** LangGraph run id, surfaced in the inspector header when present. */
  run_id: string | null;
  /** Wall-clock ms total once the run is finished. */
  total_ms: number | null;
  /** Per-node start/end timings. */
  node_timings: NodeTiming[];
  /** Final reranked + cited list (best information we have client-side
   * about which chunks made it in). */
  reranked: InspectorChunk[];
  /** Aggregate counters mirrored from graph state. */
  retrieved: number;
  used: number;
  fallback_used: boolean;
}

export interface InspectorChunk {
  rank: number;
  doc_id: string;
  chunk_id: string;
  title: string;
  source_uri: string;
  score: number;
  kind: CitationKind;
  used: boolean;
}
