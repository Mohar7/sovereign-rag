import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  api,
  type DeleteResponse,
  type DeleteResult,
  type DocumentSummary,
} from "@/lib/api"

/** Title-substring search over the indexed corpus. */
export function useLibrarySearch(q: string, limit = 100) {
  return useQuery<DocumentSummary[]>({
    queryKey: ["library", "search", q, limit],
    queryFn: () => api.documentsSearch(q, limit),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

/** Delete one document by id. Invalidates the library search cache on success. */
export function useDeleteDocument() {
  const qc = useQueryClient()
  return useMutation<DeleteResult, Error, string>({
    mutationKey: ["library", "delete"],
    mutationFn: (docId) => api.documentDelete(docId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["library", "search"] })
      void qc.invalidateQueries({ queryKey: ["corpus", "stats"] })
    },
  })
}

/** Delete N documents in a single round-trip. */
export function useDeleteDocumentsBulk() {
  const qc = useQueryClient()
  return useMutation<DeleteResponse, Error, string[]>({
    mutationKey: ["library", "delete", "bulk"],
    mutationFn: (docIds) => api.documentsDeleteBulk(docIds),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["library", "search"] })
      void qc.invalidateQueries({ queryKey: ["corpus", "stats"] })
    },
  })
}
