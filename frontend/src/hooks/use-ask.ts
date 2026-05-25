import { useMutation, useQuery } from "@tanstack/react-query"

import {
  api,
  type AskRequest,
  type AskResponse,
  type CorpusStats,
  type HealthResponse,
} from "@/lib/api"

/**
 * Submit a question to /ask. The mutation status drives the Ask page's
 * state machine: `idle` → empty/hero, `pending` → midstream, `success`
 * → hero with citations, `error` → error banner.
 */
export function useAsk() {
  return useMutation<AskResponse, Error, AskRequest>({
    mutationKey: ["ask"],
    mutationFn: (body) => api.ask(body),
  })
}

/** Corpus counts for the Ask empty-state footer + Library header. */
export function useCorpusStats() {
  return useQuery<CorpusStats>({
    queryKey: ["corpus-stats"],
    queryFn: api.corpusStats,
    staleTime: 60_000,
  })
}

/** Service-health pills in the topbar. Refetched every 30s. */
export function useHealth() {
  return useQuery<HealthResponse>({
    queryKey: ["health"],
    queryFn: api.health,
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}
