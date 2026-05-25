import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  api,
  type ThreadDetail,
  type ThreadMessage,
  type ThreadSummary,
} from "@/lib/api"

export function useThreadsList(limit = 100) {
  return useQuery<ThreadSummary[]>({
    queryKey: ["threads", "list", limit],
    queryFn: () => api.threadsList(limit),
    staleTime: 15_000,
  })
}

export function useThreadDetail(id: string | null) {
  return useQuery<ThreadDetail>({
    queryKey: ["threads", "detail", id],
    queryFn: () => api.threadDetail(id ?? ""),
    enabled: id != null && id !== "",
    staleTime: 30_000,
  })
}

export function useThreadMessages(id: string | null) {
  return useQuery<ThreadMessage[]>({
    queryKey: ["threads", "messages", id],
    queryFn: () => api.threadMessages(id ?? ""),
    enabled: id != null && id !== "",
    staleTime: 30_000,
  })
}

export function useDeleteThread() {
  const qc = useQueryClient()
  return useMutation<Record<string, unknown>, Error, string>({
    mutationKey: ["threads", "delete"],
    mutationFn: (id) => api.threadDelete(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["threads", "list"] })
    },
  })
}
