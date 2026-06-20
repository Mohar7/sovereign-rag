import { describe, expect, it } from "vitest"

import { pickKind } from "./citation-kind"

const base = {
  chunk_id: "c1",
  doc_id: "d",
  title: "t",
  source_uri: "doc_1",
  page: null,
  score: 1,
  snippet: "s",
}

describe("pickKind", () => {
  it("prefers the backend kind when present", () => {
    expect(pickKind({ ...base, kind: "graph" })).toBe("graph")
    expect(pickKind({ ...base, kind: "vector" })).toBe("vector")
  })
  it("falls back to the url heuristic when kind is absent", () => {
    expect(pickKind({ ...base, source_uri: "https://x.com/a" })).toBe("web")
    expect(pickKind(base)).toBe("hybrid")
  })
})
