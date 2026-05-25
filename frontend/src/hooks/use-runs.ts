import { useQuery } from "@tanstack/react-query"

import { api, type RunRow } from "@/lib/api"

export function useRunsList(limit = 100) {
  return useQuery<RunRow[]>({
    queryKey: ["runs", "list", limit],
    queryFn: () => api.runsList(limit),
    staleTime: 10_000,
  })
}
