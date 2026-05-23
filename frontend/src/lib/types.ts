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
