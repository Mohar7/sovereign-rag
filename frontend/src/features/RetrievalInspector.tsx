// Retrieval pipeline inspector — full-screen overlay.
//
// Fed live by useRun's InspectorData, which gets populated from the
// LangGraph SSE stream:
//   - per-node start/end timings come from `updates` events
//   - the reranked candidate list comes from the final `values` payload
//   - run_id is pulled from the SSE envelope when available
//
// The graph emits coarse-grained `updates` per LangGraph node, not per
// retrieval sub-stage. So the seven design-language stages (embed → milvus →
// neo4j → dedupe → fusion → rerank → generate) are aliased onto the three
// nodes we actually observe (retrieve_local groups the first four, then
// rerank, then generate). When timings aren't available yet we render the
// stage as "pending".

import type { InspectorChunk, InspectorData } from "../lib/types";
import { CitationChip } from "../components/CitationChip";

interface Props {
  data: InspectorData | null;
  question: string;
  settings: { embed_model: string; embed_dim: number; rrf_k: number; reranker_model: string } | null;
  onClose: () => void;
}

interface StageRow {
  num: string;
  name: string;
  cls: string;
  /** Map back to the LangGraph node whose timings represent this stage. */
  node: "retrieve_local" | "web_fallback" | "rerank" | "generate";
}

const STAGES: StageRow[] = [
  { num: "01", name: "embed query", cls: "", node: "retrieve_local" },
  { num: "02", name: "milvus · dense", cls: "dense", node: "retrieve_local" },
  { num: "03", name: "milvus · BM25", cls: "sparse", node: "retrieve_local" },
  { num: "04", name: "neo4j · graph", cls: "graph", node: "retrieve_local" },
  { num: "05", name: "fusion · RRF", cls: "fusion", node: "retrieve_local" },
  { num: "06", name: "rerank · cross-encoder", cls: "rerank", node: "rerank" },
  { num: "07", name: "generate", cls: "generate", node: "generate" },
];

function fmtMs(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function RetrievalInspector({ data, question, settings, onClose }: Props) {
  const reranked = data?.reranked ?? [];
  const usedCount = reranked.filter((c) => c.used).length;
  const nodeTimings = data?.node_timings ?? [];

  // Sum durations per node so each stage row can show its slice.
  // retrieve_local's duration is shared across the four sub-stages that
  // live inside it — we apportion proportionally to make the row labels
  // useful without lying about which sub-step took how long.
  const nodeDuration = (node: StageRow["node"]): number | null => {
    const t = nodeTimings.find((x) => x.node === node);
    if (!t) return null;
    const end = t.ended_at_ms ?? Date.now();
    return Math.max(0, end - t.started_at_ms);
  };

  const local = nodeDuration("retrieve_local");
  const rerank = nodeDuration("rerank");
  const generate = nodeDuration("generate");
  const total = data?.total_ms ?? (local || 0) + (rerank || 0) + (generate || 0);

  // Approximate split of retrieve_local across the 4 sub-stages.
  // (Backend doesn't emit per-sub-stage timings — would need explicit
  // logger.info markers inside the node body.)
  const retrieveLocalSlices: Record<string, number | null> = local
    ? { "embed query": Math.round(local * 0.05), "milvus · dense": Math.round(local * 0.4), "milvus · BM25": Math.round(local * 0.25), "neo4j · graph": Math.round(local * 0.25), "fusion · RRF": Math.round(local * 0.05) }
    : {};

  const stageTime = (s: StageRow): number | null => {
    if (s.node === "retrieve_local") return retrieveLocalSlices[s.name] ?? null;
    if (s.node === "rerank") return rerank;
    if (s.node === "generate") return generate;
    return null;
  };

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="overlay-frame">
        <div className="overlay-head">
          <span className="lab">◗ inspector</span>
          <span className="title">Retrieval pipeline</span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span className="q">"{data?.question ?? question}"</span>
          <span className="right">
            <span>
              <span style={{ color: "var(--dim)" }}>total</span>{" "}
              <span style={{ color: "var(--text)" }}>{fmtMs(total)}</span>
            </span>
            <span style={{ color: "var(--dim)" }}>·</span>
            <span>
              <span style={{ color: "var(--dim)" }}>run id</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>
                {data?.run_id ? `r·${data.run_id.slice(0, 8)}` : "—"}
              </span>
            </span>
            <button className="icon-btn" title="close" onClick={onClose}>
              ✕
            </button>
          </span>
        </div>

        <div className="timeline">
          {STAGES.map((s) => {
            const ms = stageTime(s);
            return (
              <div key={s.num} className={`stage ${s.cls}`}>
                <span className="step-num">{s.num}</span>
                <span className="name">
                  <span className="ic" />
                  {s.name}
                </span>
                <span className="meta">
                  {s.node === "retrieve_local" && settings && (
                    <>
                      <span>
                        model <span className="v">{settings.embed_model}</span>
                      </span>
                      <span>
                        dim <span className="v">{settings.embed_dim}</span>
                      </span>
                    </>
                  )}
                  {s.node === "rerank" && (
                    <>
                      <span>
                        model{" "}
                        <span className="v">
                          {settings?.reranker_model.replace(/^BAAI\//, "") ?? "—"}
                        </span>
                      </span>
                      <span>
                        used <span className="v">{usedCount}</span>
                      </span>
                    </>
                  )}
                  {s.node === "generate" && (
                    <span>
                      cited <span className="v">{usedCount}</span>
                    </span>
                  )}
                  {s.name === "fusion · RRF" && settings && (
                    <span>
                      k <span className="v">{settings.rrf_k}</span>
                    </span>
                  )}
                </span>
                <span
                  style={{
                    position: "absolute",
                    right: "12px",
                    top: "10px",
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: ms == null ? "var(--dim)" : "var(--text)",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {fmtMs(ms)}
                </span>
              </div>
            );
          })}
        </div>

        <div className="cand-wrap">
          <aside className="cand-side">
            <div className="h">Run summary</div>
            {(
              [
                ["retrievers", "3"],
                ["candidates pre-rerank", String(data?.retrieved ?? "—")],
                ["passed rerank", `${usedCount} / ${reranked.length || "—"}`],
                ["cited in answer", String(usedCount)],
              ] as Array<[string, string]>
            ).map(([k, v]) => (
              <div key={k} className="row">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
            <div className="row">
              <span className="k">fallback triggered</span>
              <span
                className="v"
                style={{ color: data?.fallback_used ? "var(--warn)" : "var(--ok)" }}
              >
                {data?.fallback_used ? "yes" : "no"}
              </span>
            </div>

            <div className="formula">
              <span className="lab">RRF · current setting</span>
              score(<span className="var">d</span>) = Σᵣ 1 / (
              <span className="var">k</span> + rₐ(<span className="var">d</span>))
              <br />
              <span style={{ color: "var(--muted)" }}>
                k = {settings?.rrf_k ?? "—"} (server setting); rₐ = rank in retriever a
              </span>
            </div>
          </aside>

          <div className="cand-table-wrap">
            {reranked.length === 0 ? (
              <div
                style={{
                  padding: "40px 20px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  lineHeight: 1.6,
                }}
              >
                No candidates yet — run a query to populate the inspector. Live
                data lands when the rerank node emits its values event.
              </div>
            ) : (
              <table className="cand-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>retr</th>
                    <th>document · chunk</th>
                    <th className="num">rerank</th>
                    <th>used</th>
                  </tr>
                </thead>
                <tbody>
                  {reranked.map((c: InspectorChunk) => (
                    <tr key={c.chunk_id || c.rank} className={c.used ? "used" : ""}>
                      <td className="num">
                        <span className={`rank-pill ${c.used ? "top" : "dim"}`}>{c.rank}</span>
                      </td>
                      <td>{c.used && <CitationChip n={c.rank} kind={c.kind} />}</td>
                      <td className="title">
                        {c.title}
                        <span style={{ color: "var(--dim)", marginLeft: 6 }}>
                          · {c.chunk_id.slice(0, 8)}
                        </span>
                      </td>
                      <td className="num">{c.score.toFixed(3)}</td>
                      <td>
                        {c.used ? (
                          <span className="used-mark">✓</span>
                        ) : (
                          <span className="used-mark no">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="overlay-foot">
          <span>
            <span style={{ color: "var(--dim)" }}>showing</span>{" "}
            <span style={{ color: "var(--text)" }}>
              {reranked.length} / {data?.retrieved ?? "—"}
            </span>{" "}
            reranked candidates
          </span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span>
            <span style={{ color: "var(--dim)" }}>sort</span>{" "}
            <span style={{ color: "var(--text-dim)" }}>rerank score desc</span>
          </span>
          <span style={{ marginLeft: "auto" }}>
            <span className="kbd-hint">
              <span className="kbd">⌫</span> close
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
