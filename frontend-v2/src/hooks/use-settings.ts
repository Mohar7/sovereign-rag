import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import {
  api,
  type ModelChoice,
  type SettingsPatch,
  type SettingsResponse,
} from "@/lib/api"

export function useSettings() {
  return useQuery<SettingsResponse>({
    queryKey: ["settings"],
    queryFn: api.getSettings,
    staleTime: 60_000,
  })
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  return useMutation<SettingsResponse, Error, SettingsPatch>({
    mutationKey: ["settings", "patch"],
    mutationFn: (patch) => api.patchSettings(patch),
    onSuccess: (data) => {
      qc.setQueryData(["settings"], data)
    },
  })
}

export function useModels(provider: "ollama" | "openai") {
  return useQuery<ModelChoice[]>({
    queryKey: ["models", provider],
    queryFn: () => api.listModels(provider),
    staleTime: 30_000,
    retry: 1,
  })
}
