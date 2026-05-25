import { useQuery } from "@tanstack/react-query"

// These mirror the FastAPI response models exactly; declared here instead of
// in lib/api.ts so the source-detail hooks stay self-contained.
export interface ChunkSummary {
  chunk_id: string
  doc_id: string
  position: number
  page: number | null
  raw_text: string
}

export interface NeighbourResponse {
  chunk: ChunkSummary
  prev: ChunkSummary | null
  next: ChunkSummary | null
}

export interface EntityItem {
  name: string
  type: string
  description: string | null
}

export interface EntitiesResponse {
  entities: EntityItem[]
  relations: Array<[string, string, string]>
}

async function fetchJSON<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${path}`)
  return (await r.json()) as T
}

/** /api/library/{doc_id}/chunks — every chunk for one document, ordered. */
export function useDocumentChunks(docId: string | null, limit = 500) {
  return useQuery<ChunkSummary[]>({
    queryKey: ["library", docId, "chunks", limit],
    queryFn: () =>
      fetchJSON<ChunkSummary[]>(
        `/api/library/${encodeURIComponent(docId ?? "")}/chunks?limit=${limit}`,
      ),
    enabled: docId != null && docId !== "",
    staleTime: 60_000,
  })
}

/** /api/chunks/{chunk_id}/neighbours — prev/next sibling chunks. */
export function useChunkNeighbours(chunkId: string | null) {
  return useQuery<NeighbourResponse>({
    queryKey: ["chunks", chunkId, "neighbours"],
    queryFn: () => fetchJSON<NeighbourResponse>(`/api/chunks/${chunkId}/neighbours`),
    enabled: chunkId != null && chunkId !== "",
    staleTime: 60_000,
  })
}

/** /api/entities?doc_id=... — entities + relations mentioned in the doc. */
export function useEntities(docId: string | null, limit = 40) {
  return useQuery<EntitiesResponse>({
    queryKey: ["entities", docId, limit],
    queryFn: () =>
      fetchJSON<EntitiesResponse>(
        `/api/entities?doc_id=${encodeURIComponent(docId ?? "")}&limit=${limit}`,
      ),
    enabled: docId != null && docId !== "",
    staleTime: 60_000,
  })
}
