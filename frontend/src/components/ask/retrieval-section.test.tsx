import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { RetrievalSection } from "./retrieval-section"
import type { RetrievalTrace } from "@/lib/api"

const trace: RetrievalTrace = {
  legs: { dense: [{ chunkId: "c1", rank: 1, score: 0.9 }], bm25: [], graph: [] },
  chunks: [
    {
      chunkId: "c1",
      title: "Alpha",
      snippet: "a",
      origin: "local",
      denseRank: 1,
      bm25Rank: null,
      graphRank: null,
      rerankRank: 1,
      rerankScore: 5,
      inTopK: true,
      cited: true,
    },
    {
      chunkId: "c2",
      title: "Beta",
      snippet: "b",
      origin: "web",
      denseRank: null,
      bm25Rank: 3,
      graphRank: null,
      rerankRank: 2,
      rerankScore: 2,
      inTopK: false,
      cited: false,
    },
  ],
  poolSize: 2,
  topK: 1,
}

describe("RetrievalSection", () => {
  it("renders chunk titles and a cited marker", () => {
    render(<RetrievalSection trace={trace} />)
    expect(screen.getByText("Alpha")).toBeDefined()
    expect(screen.getByText("Beta")).toBeDefined()
    expect(screen.getAllByTestId("rs-row").length).toBe(2)
    expect(screen.getByTestId("rs-cited-c1")).toBeDefined()
  })
})
