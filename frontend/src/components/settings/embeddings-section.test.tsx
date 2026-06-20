import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import type { ReactElement } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { EmbeddingsSection } from "./embeddings-section"
import { api } from "@/lib/api"

vi.mock("@/lib/api", () => ({
  api: {
    getEmbedModels: vi.fn(),
    patchSettings: vi.fn(),
    getReindexStatus: vi.fn(),
  },
}))

function renderWithClient(ui: ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>)
}

describe("EmbeddingsSection", () => {
  beforeEach(() => {
    vi.mocked(api.getEmbedModels).mockResolvedValue([
      { id: "text-embedding-3-small", provider: "openai", dim: 1536, label: "3-small (1536)" },
      { id: "text-embedding-3-large", provider: "openai", dim: 3072, label: "3-large (3072)" },
    ])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(api.patchSettings).mockResolvedValue({} as any)
    vi.mocked(api.getReindexStatus).mockResolvedValue({
      status: "done",
      total: 0,
      doneCount: 0,
      error: null,
    })
  })

  it("lists models and patches on confirm with the derived model", async () => {
    renderWithClient(
      <EmbeddingsSection provider="openai" model="text-embedding-3-small" dim={1536} />,
    )
    const largeBtn = await screen.findByTestId("embed-model-text-embedding-3-large")
    fireEvent.click(largeBtn)
    const saveBtn = await screen.findByTestId("embed-save")
    fireEvent.click(saveBtn)
    await waitFor(() =>
      expect(api.patchSettings).toHaveBeenCalledWith({
        embed_provider: "openai",
        openai_embed_model: "text-embedding-3-large",
      }),
    )
  })
})
