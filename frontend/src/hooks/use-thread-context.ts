import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  api,
  type PinAction,
  type PinEntry,
  type ThreadContextDoc,
} from "@/lib/api"

export function useThreadContext(threadId: string | null) {
  return useQuery<ThreadContextDoc>({
    queryKey: ["thread-context", threadId],
    queryFn: () => api.threadContext(threadId ?? ""),
    enabled: threadId != null && threadId !== "",
    staleTime: 15_000,
  })
}

export function useThreadContextUpsert(threadId: string | null) {
  const qc = useQueryClient()
  return useMutation<
    PinEntry,
    Error,
    { chunk_id: string; action: PinAction; note?: string | null }
  >({
    mutationKey: ["thread-context", threadId, "upsert"],
    mutationFn: (body) => api.threadContextUpsert(threadId ?? "", body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread-context", threadId] })
    },
  })
}

export function useThreadContextDelete(threadId: string | null) {
  const qc = useQueryClient()
  return useMutation<{ ok: boolean }, Error, string>({
    mutationKey: ["thread-context", threadId, "delete"],
    mutationFn: (chunkId) => api.threadContextDelete(threadId ?? "", chunkId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread-context", threadId] })
    },
  })
}

export function useThreadContextClear(threadId: string | null) {
  const qc = useQueryClient()
  return useMutation<{ removed: number }, Error, void>({
    mutationKey: ["thread-context", threadId, "clear"],
    mutationFn: () => api.threadContextClear(threadId ?? ""),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["thread-context", threadId] })
    },
  })
}
