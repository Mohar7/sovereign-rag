/**
 * Minimal client for the sovereign-rag FastAPI backend.
 *
 * The Vite dev server proxies `/api/*` and `/ask`, `/health`, `/documents/*`,
 * `/ingest/*`, `/admin/*` to the backend (see ``vite.config.ts``). In
 * production the SPA is served from the same nginx that proxies the backend,
 * so same-origin requests work without CORS round-trips.
 */

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init)
  if (!r.ok) {
    let detail: string
    try {
      const body = await r.json()
      detail = body?.detail ?? r.statusText
    } catch {
      detail = r.statusText
    }
    throw new ApiError(r.status, detail, path)
  }
  return (await r.json()) as T
}

function postJSON<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
}

// ---------- run history ----------

export interface RunRow {
  id: number
  thread_id: string
  question: string
  answer: string | null
  retrieved: number
  used: number
  citations: CitationModel[]
  timings: {
    retrieve_local?: number
    rerank?: number
    generate?: number
    total?: number
  }
  overrides: Record<string, unknown> | null
  model: string | null
  status: "ok" | "error"
  error: string | null
  created_at: string | null
}

// ---------- graph explorer ----------

export interface GraphStats {
  entities: number
  relations: number
  mentions: number
}

export interface EntityRow {
  name: string
  type?: string | null
  description?: string | null
  mentions: number
}

export interface GraphNode {
  id: string
  label: string
  type?: string | null
  description?: string | null
  mentions: number
  distance: number
}

export interface GraphEdge {
  source: string
  target: string
  type: string
  description?: string | null
}

export interface Neighborhood {
  seed: string
  depth: number
  nodes: GraphNode[]
  edges: GraphEdge[]
}

export class ApiError extends Error {
  status: number
  detail: string
  path: string
  constructor(status: number, detail: string, path: string) {
    super(`${status} ${detail} — ${path}`)
    this.name = "ApiError"
    this.status = status
    this.detail = detail
    this.path = path
  }
}

// ---------- types (mirror the backend Pydantic schemas) ----------

export interface CorpusStats {
  documents: number
  chunks: number
  entities: number
  relations: number
  last_indexed?: string
}

export type ServiceState = "ok" | "warn" | "err"

export interface ServiceStatus {
  name: string
  state: ServiceState
  latency_ms?: number
  endpoint?: string
  note?: string
}

export interface HealthResponse {
  services: ServiceStatus[]
}

export interface DocumentSummary {
  doc_id: string
  title: string
  source_uri: string
  chunks: number
}

export interface DeleteResult {
  doc_id: string
  chunks_deleted: number
  graph_deleted: boolean
  error?: string | null
}

export interface DeleteResponse {
  ok: boolean
  total_chunks_deleted: number
  results: DeleteResult[]
}

export interface CitationModel {
  chunk_id: string
  doc_id: string
  title: string
  source_uri: string
  page: number | null
  score: number
  snippet: string
}

export interface AskOverrides {
  model?: string | null
  retrieve_top_k?: number | null
  rerank_top_k?: number | null
  enable_graph_retrieval?: boolean | null
}

export interface AskRequest {
  question: string
  doc_id?: string | null
  thread_id?: string | null
  overrides?: AskOverrides | null
}

export interface AskResponse {
  thread_id: string
  status: "ok"
  answer: string | null
  citations: CitationModel[]
  retrieved: number
  used: number
}

export interface ThreadSummary {
  thread_id: string
  question?: string | null
  answer_snippet?: string | null
  citations: number
  updated_at?: string | null
}

export interface ThreadDetail {
  thread_id: string
  question: string | null
  answer: string | null
  citations: number
  retrieved: number
  used: number
  updated_at: string | null
}

export interface ThreadMessage {
  role: "user" | "assistant"
  content: string
  citations: CitationModel[]
  retrieved: number
  used: number
}

export interface IngestUrlRequest {
  type: "url"
  value: string
  title?: string
}

export interface IngestTextRequest {
  type: "text"
  value: string
  title?: string
}

export type IngestBody = IngestUrlRequest | IngestTextRequest

export interface IngestResponse {
  doc_id: string
  title: string
  chunks_indexed: number
  source_uri?: string | null
}

export interface WebSearchHit {
  url: string
  title: string
  snippet: string
}

export interface SettingsResponse {
  // LLM
  llm_provider: "ollama" | "openai"
  llm_model: string
  llm_model_light: string
  llm_model_nano: string
  openai_chat_model: string
  openai_chat_model_light: string
  openai_chat_model_nano: string
  llm_temperature: number
  // Embeddings
  embed_provider: string
  embed_model: string
  embed_dim: number
  // Retrieval
  retrieve_top_k: number
  rerank_top_k: number
  rrf_k: number
  enable_graph_retrieval: boolean
  enable_contextual_retrieval: boolean
  dense_enabled: boolean
  sparse_enabled: boolean
  fusion_strategy: string
  fusion_graph_weight: number
  fusion_vector_weight: number
  graph_depth: number
  graph_max_nodes: number
  // Rerank
  rerank_score_floor: number
  adaptive_rerank: boolean
  reranker_model: string
  reranker_device: "auto" | "mps" | "cuda" | "cpu"
}

export type SettingsPatch = Partial<SettingsResponse>

export interface ModelChoice {
  id: string
  label: string
  family?: string | null
  size?: string | null
  note?: string | null
}

// ---------- api ----------

export const api = {
  // /api/*
  corpusStats: () => request<CorpusStats>("/api/corpus/stats"),
  health: () => request<HealthResponse>("/api/health"),
  documentsSearch: (q: string, limit = 20) =>
    request<DocumentSummary[]>(
      `/api/documents/search?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  documentDelete: (docId: string) =>
    request<DeleteResult>(`/api/library/${encodeURIComponent(docId)}`, {
      method: "DELETE",
    }),
  documentsDeleteBulk: (doc_ids: string[]) =>
    postJSON<DeleteResponse>("/api/library/delete", { doc_ids }),
  documentChunks: (docId: string, limit = 2000) =>
    request<
      Array<{
        chunk_id: string
        doc_id: string
        position: number
        page: number | null
        raw_text: string
      }>
    >(`/api/library/${encodeURIComponent(docId)}/chunks?limit=${limit}`),
  threadsList: (limit = 50) =>
    request<ThreadSummary[]>(`/api/threads?limit=${limit}`),
  threadDetail: (id: string) =>
    request<ThreadDetail>(`/api/threads/${encodeURIComponent(id)}`),
  threadMessages: (id: string) =>
    request<ThreadMessage[]>(`/api/threads/${encodeURIComponent(id)}/messages`),
  threadDelete: (id: string) =>
    request<Record<string, unknown>>(`/api/threads/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }),

  ingest: (body: IngestBody) => postJSON<IngestResponse>("/api/ingest", body),
  ingestFile: (file: File) => {
    const fd = new FormData()
    fd.append("file", file)
    return request<IngestResponse>("/documents/file", { method: "POST", body: fd })
  },
  webSearch: (q: string, max_results = 10) =>
    request<WebSearchHit[]>(
      `/api/search?q=${encodeURIComponent(q)}&max_results=${max_results}`,
    ),

  getSettings: () => request<SettingsResponse>("/api/settings"),
  patchSettings: (patch: SettingsPatch) =>
    request<SettingsResponse>("/api/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }),
  listModels: (provider: "ollama" | "openai") =>
    request<ModelChoice[]>(`/api/models?provider=${provider}`),

  // run history
  runsList: (limit = 50) => request<RunRow[]>(`/api/runs?limit=${limit}`),

  // graph explorer
  graphStats: () => request<GraphStats>("/api/graph/stats"),
  graphEntities: (q: string, limit = 20) =>
    request<EntityRow[]>(
      `/api/graph/entities?q=${encodeURIComponent(q)}&limit=${limit}`,
    ),
  graphNeighborhood: (seed: string, depth = 2, limit = 80) =>
    request<Neighborhood>(
      `/api/graph/neighborhood?seed=${encodeURIComponent(seed)}&depth=${depth}&limit=${limit}`,
    ),

  // root-mounted (no /api prefix)
  ask: (body: AskRequest) => postJSON<AskResponse>("/ask", body),

  // admin
  wipe: (scope: "all" | "corpus" | "threads" = "all") =>
    postJSON<Record<string, unknown>>("/admin/wipe", { scope, confirm: "wipe" }),
}
