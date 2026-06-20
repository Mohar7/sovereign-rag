import { useTranslation } from "react-i18next"

import type { RetrievalTrace, TraceChunk } from "@/lib/api"

function rankCell(n: number | null): string {
  return n === null ? "—" : `#${n}`
}

/** A compact provenance table: per-leg ranks + rerank reordering + cited. */
export function RetrievalSection({ trace }: { trace: RetrievalTrace }) {
  const { t } = useTranslation()
  const counts = `dense ${trace.legs.dense.length} · bm25 ${trace.legs.bm25.length} · graph ${trace.legs.graph.length}`
  return (
    <section className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-medium">
          {t("pages.ask.inspector.retrieval.title")}
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {counts} ·{" "}
          {t("pages.ask.inspector.retrieval.poolToTop", {
            pool: trace.poolSize,
            top: trace.topK,
          })}
        </span>
      </div>
      <div className="overflow-hidden rounded-lg border">
        <table className="w-full text-[12px]">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr>
              <th className="px-2 py-1 text-left">#</th>
              <th className="px-2 py-1 text-left">
                {t("pages.ask.inspector.retrieval.chunk")}
              </th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.dense")}</th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.bm25")}</th>
              <th className="px-2 py-1 text-center">{t("pages.ask.inspector.retrieval.graph")}</th>
              <th className="px-2 py-1 text-right">{t("pages.ask.inspector.retrieval.score")}</th>
            </tr>
          </thead>
          <tbody>
            {trace.chunks.map((c: TraceChunk, i) => {
              const cutoff = i === trace.topK && trace.topK < trace.chunks.length
              return (
                <tr
                  key={c.chunkId}
                  data-testid="rs-row"
                  className={`border-t ${cutoff ? "border-t-primary/50" : ""} ${
                    c.inTopK ? "" : "opacity-60"
                  }`}
                >
                  <td className="px-2 py-1 font-mono">{rankCell(c.rerankRank)}</td>
                  <td className="px-2 py-1">
                    <span className="font-medium">{c.title || c.chunkId}</span>
                    {c.origin === "web" && (
                      <span className="ml-1 rounded bg-muted px-1 text-[10px]">web</span>
                    )}
                    {c.cited && (
                      <span
                        data-testid={`rs-cited-${c.chunkId}`}
                        className="ml-1 rounded bg-primary/15 px-1 text-[10px] text-primary"
                      >
                        {t("pages.ask.inspector.retrieval.cited")}
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.denseRank)}</td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.bm25Rank)}</td>
                  <td className="px-2 py-1 text-center font-mono">{rankCell(c.graphRank)}</td>
                  <td className="px-2 py-1 text-right font-mono">
                    {c.rerankScore === null ? "—" : c.rerankScore.toFixed(2)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
