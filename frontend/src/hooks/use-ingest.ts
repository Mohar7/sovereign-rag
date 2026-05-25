import { useMutation, useQuery } from "@tanstack/react-query"

import {
  api,
  type IngestBody,
  type IngestResponse,
  type WebSearchHit,
} from "@/lib/api"

/** POST /api/ingest — polymorphic URL or text ingest. */
export function useIngest() {
  return useMutation<IngestResponse, Error, IngestBody>({
    mutationKey: ["ingest"],
    mutationFn: (body) => api.ingest(body),
  })
}

/** POST /documents/file — upload a PDF/DOCX and index it. */
export function useFileIngest() {
  return useMutation<IngestResponse, Error, File>({
    mutationKey: ["ingest-file"],
    mutationFn: (file) => api.ingestFile(file),
  })
}

/** GET /api/search — SearxNG proxy used by the Web ingest tab. */
export function useWebSearch(q: string, enabled: boolean = true) {
  return useQuery<WebSearchHit[]>({
    queryKey: ["web-search", q],
    queryFn: () => api.webSearch(q),
    enabled: enabled && q.trim().length >= 2,
    staleTime: 30_000,
  })
}
