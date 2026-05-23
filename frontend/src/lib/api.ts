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
  reranker_model: string;
  reranker_device: string;
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
};
