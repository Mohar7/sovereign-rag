import { useQuery } from "@tanstack/react-query"

import { api, type EntityRow, type GraphStats, type Neighborhood } from "@/lib/api"

export function useGraphStats() {
  return useQuery<GraphStats>({
    queryKey: ["graph", "stats"],
    queryFn: api.graphStats,
    staleTime: 60_000,
  })
}

export function useGraphEntities(q: string, limit = 20) {
  return useQuery<EntityRow[]>({
    queryKey: ["graph", "entities", q, limit],
    queryFn: () => api.graphEntities(q, limit),
    staleTime: 30_000,
    placeholderData: (prev) => prev,
  })
}

export function useGraphNeighborhood(
  seed: string | null,
  depth = 2,
  limit = 80,
) {
  return useQuery<Neighborhood>({
    queryKey: ["graph", "neighborhood", seed, depth, limit],
    queryFn: () => api.graphNeighborhood(seed ?? "", depth, limit),
    enabled: seed != null && seed.length > 0,
    staleTime: 30_000,
  })
}
