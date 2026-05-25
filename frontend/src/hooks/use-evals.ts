import { useQuery } from "@tanstack/react-query"

import { api, type EvalsResults } from "@/lib/api"

export function useEvalsLatest() {
  return useQuery<EvalsResults>({
    queryKey: ["evals", "latest"],
    queryFn: api.evalsLatest,
    staleTime: 60_000,
  })
}
