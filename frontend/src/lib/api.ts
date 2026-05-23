// Thin client for the FastAPI /api/* surface.
// Used by useCorpusStats / useHealth / useSettings / useDocumentsSearch /
// useChunkNeighbours / useEntities — see ../hooks/.

const BASE = "/api";

export interface CorpusStats {
  documents: number;
  chunks: number;
  entities: number;
  relations: number;
  last_indexed: string | null;
}

export interface ServiceStatus {
  name: string;
  state: "ok" | "warn" | "err";
  latency_ms: number | null;
  endpoint: string | null;
  note: string | null;
}

export interface HealthResponse {
  services: ServiceStatus[];
}

export type FusionStrategy = "rrf" | "weighted" | "borda";
export type RerankerDevice = "auto" | "mps" | "cuda" | "cpu";

export interface Settings {
  llm_model: string;
  embed_provider: string;
  embed_model: string;
  embed_dim: number;
  retrieve_top_k: number;
  rerank_top_k: number;
  rrf_k: number;
  enable_graph_retrieval: boolean;
  enable_contextual_retrieval: boolean;
  dense_enabled: boolean;
  sparse_enabled: boolean;
  fusion_strategy: FusionStrategy;
  fusion_graph_weight: number;
  fusion_vector_weight: number;
  graph_depth: number;
  graph_max_nodes: number;
  rerank_score_floor: number;
  adaptive_rerank: boolean;
  reranker_model: string;
  reranker_device: RerankerDevice;
  web_fallback_min_chunks: number;
  web_fallback_max_urls: number;
}

export type SettingsPatch = Partial<
  Pick<
    Settings,
    | "retrieve_top_k"
    | "rerank_top_k"
    | "rrf_k"
    | "enable_graph_retrieval"
    | "enable_contextual_retrieval"
    | "dense_enabled"
    | "sparse_enabled"
    | "fusion_strategy"
    | "fusion_graph_weight"
    | "fusion_vector_weight"
    | "graph_depth"
    | "graph_max_nodes"
    | "rerank_score_floor"
    | "adaptive_rerank"
    | "reranker_device"
    | "web_fallback_min_chunks"
    | "web_fallback_max_urls"
  >
>;

export interface DocumentSummary {
  doc_id: string;
  title: string;
  source_uri: string;
  chunks: number;
}

export interface ChunkSummary {
  chunk_id: string;
  doc_id: string;
  position: number;
  page: number | null;
  raw_text: string;
}

export interface NeighbourResponse {
  chunk: ChunkSummary;
  prev: ChunkSummary | null;
  next: ChunkSummary | null;
}

export interface EntityItem {
  name: string;
  type: string;
  description: string | null;
}

export interface EntitiesResponse {
  entities: EntityItem[];
  /** [subject, predicate, object] triples. */
  relations: [string, string, string][];
}

export type PinAction = "pinned" | "excluded";

export interface PinEntry {
  chunk_id: string;
  action: PinAction;
  note: string | null;
  created_at: string;
}

export interface ThreadContextDoc {
  thread_id: string;
  pins: PinEntry[];
}

export interface IngestResponse {
  doc_id: string;
  title: string;
  chunks_indexed: number;
  source_uri: string;
}

export interface WebSearchHit {
  url: string;
  title: string;
  snippet: string;
}

async function getJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, init);
  if (!res.ok) {
    throw new Error(`${init?.method || "GET"} /api${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export const api = {
  corpusStats: () => getJSON<CorpusStats>("/corpus/stats"),
  health: () => getJSON<HealthResponse>("/health"),
  settings: () => getJSON<Settings>("/settings"),
  patchSettings: (patch: SettingsPatch) =>
    getJSON<Settings>("/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  documentsSearch: (q: string, limit = 10) =>
    getJSON<DocumentSummary[]>(
      `/documents/search?q=${encodeURIComponent(q)}&limit=${limit}`
    ),
  chunkNeighbours: (chunkId: string) =>
    getJSON<NeighbourResponse>(`/chunks/${chunkId}/neighbours`),
  entities: (docId: string) =>
    getJSON<EntitiesResponse>(`/entities?doc_id=${encodeURIComponent(docId)}`),
  threadContext: (threadId: string) =>
    getJSON<ThreadContextDoc>(`/threads/${encodeURIComponent(threadId)}/context`),
  pinChunk: (threadId: string, chunkId: string, action: PinAction = "pinned", note?: string) =>
    getJSON<PinEntry>(`/threads/${encodeURIComponent(threadId)}/context`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chunk_id: chunkId, action, note }),
    }),
  unpinChunk: (threadId: string, chunkId: string) =>
    getJSON<{ ok: boolean }>(
      `/threads/${encodeURIComponent(threadId)}/context/${encodeURIComponent(chunkId)}`,
      { method: "DELETE" },
    ),
  clearThreadContext: (threadId: string) =>
    getJSON<{ removed: number }>(`/threads/${encodeURIComponent(threadId)}/context`, {
      method: "DELETE",
    }),
  ingest: (body: { type: "url" | "text"; value: string; title?: string }) =>
    getJSON<IngestResponse>("/ingest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  searchWeb: (q: string, maxResults = 8) =>
    getJSON<WebSearchHit[]>(
      `/search?q=${encodeURIComponent(q)}&max_results=${maxResults}`,
    ),
};
