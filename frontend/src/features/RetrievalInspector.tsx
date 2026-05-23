// Retrieval pipeline inspector — full-screen overlay.
// Shows the 7-stage pipeline timeline + candidate table + side panel with
// the RRF formula and retriever-set intersections. Currently fed by mock
// data; once the LangGraph runtime emits per-stage timings via `updates`
// events we'll pipe them in from useRun.
//
// Mock data is the same as in /artboards Inspector — so the design QA
// view and the live overlay are visually identical until live data lands.

import { CitationChip } from "../components/CitationChip";
import type { CitationKind } from "../lib/types";

interface Candidate {
  rank: number;
  doc: string;
  type: "web" | "pdf" | "notes";
  dense: number | "—";
  sparse: number | "—";
  graph: number | "—";
  rrf: number;
  rer: number;
  used: boolean;
  kind: CitationKind;
  delta: string;
}

const CANDIDATES: Candidate[] = [
  { rank: 1, doc: "milvus.io/docs/hybrid-search.md", type: "web", dense: 1, sparse: 3, graph: 5, rrf: 0.04918, rer: 0.992, used: true, kind: "hybrid", delta: "↑ 2" },
  { rank: 2, doc: "rrf-paper.pdf", type: "pdf", dense: 4, sparse: 1, graph: "—", rrf: 0.04722, rer: 0.961, used: true, kind: "vector", delta: "↑ 5" },
  { rank: 3, doc: "notes/hybrid-retrieval.md", type: "notes", dense: 2, sparse: 8, graph: 1, rrf: 0.04412, rer: 0.847, used: true, kind: "hybrid", delta: "—" },
  { rank: 4, doc: "blog.vespa.ai/rrf-tuning", type: "web", dense: 5, sparse: 2, graph: "—", rrf: 0.04017, rer: 0.812, used: true, kind: "web", delta: "↑ 3" },
  { rank: 5, doc: "trec-dl-2023.pdf", type: "pdf", dense: 7, sparse: 4, graph: 2, rrf: 0.03844, rer: 0.788, used: true, kind: "graph", delta: "↑ 4" },
  { rank: 6, doc: "rag-eval-protocols.pdf", type: "pdf", dense: 3, sparse: 12, graph: 9, rrf: 0.03612, rer: 0.512, used: false, kind: "vector", delta: "↓ 1" },
  { rank: 7, doc: "milvus-2.5-release-notes.md", type: "web", dense: 6, sparse: 14, graph: "—", rrf: 0.03247, rer: 0.494, used: false, kind: "vector", delta: "↓ 2" },
  { rank: 8, doc: "embeddings/bge-m3-card.md", type: "notes", dense: 11, sparse: 5, graph: 4, rrf: 0.03104, rer: 0.448, used: false, kind: "hybrid", delta: "—" },
  { rank: 9, doc: "neo4j-cookbook.pdf", type: "pdf", dense: 18, sparse: "—", graph: 3, rrf: 0.02841, rer: 0.421, used: false, kind: "graph", delta: "↑ 1" },
  { rank: 10, doc: "blog.pinecone.io/hybrid-search", type: "web", dense: 8, sparse: 9, graph: "—", rrf: 0.02712, rer: 0.408, used: false, kind: "vector", delta: "↓ 3" },
  { rank: 11, doc: "elastic-bm25-tuning.md", type: "notes", dense: 22, sparse: 6, graph: "—", rrf: 0.02611, rer: 0.382, used: false, kind: "graph", delta: "—" },
  { rank: 12, doc: "weaviate-hybrid-search.md", type: "web", dense: 9, sparse: 17, graph: "—", rrf: 0.02538, rer: 0.374, used: false, kind: "vector", delta: "↓ 4" },
];

const STAGES = [
  { num: "01", name: "embed query", cls: "", meta: [["model", "bge-m3"], ["dim", "1024"]], time: "18ms" },
  { num: "02", name: "milvus · dense", cls: "dense", meta: [["index", "HNSW"], ["fetched", "50"]], time: "122ms" },
  { num: "03", name: "milvus · BM25", cls: "sparse", meta: [["tokens", "8"], ["fetched", "50"]], time: "64ms" },
  { num: "04", name: "neo4j · graph", cls: "graph", meta: [["seeds", "3"], ["fetched", "23"]], time: "187ms" },
  { num: "05", name: "fusion · RRF", cls: "fusion", meta: [["k", "60"], ["unique", "47"]], time: "4ms" },
  { num: "06", name: "rerank · cross-encoder", cls: "rerank", meta: [["model", "bge-rr-v2"], ["used", "5"]], time: "284ms" },
  { num: "07", name: "generate", cls: "generate", meta: [["model", "kimi-k2.6"], ["tok", "92"]], time: "732ms" },
] as const;

interface Props {
  question: string;
  onClose: () => void;
}

export function RetrievalInspector({ question, onClose }: Props) {
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="overlay-frame">
        <div className="overlay-head">
          <span className="lab">◗ inspector</span>
          <span className="title">Retrieval pipeline</span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span className="q">"{question}"</span>
          <span className="right">
            <span>
              <span style={{ color: "var(--dim)" }}>total</span>{" "}
              <span style={{ color: "var(--text)" }}>1.41s</span>
            </span>
            <span style={{ color: "var(--dim)" }}>·</span>
            <span>
              <span style={{ color: "var(--dim)" }}>run id</span>{" "}
              <span style={{ color: "var(--text-dim)" }}>r·a02c19de</span>
            </span>
            <button className="icon-btn" title="close" onClick={onClose}>
              ✕
            </button>
          </span>
        </div>

        <div className="timeline">
          {STAGES.map((s) => (
            <div key={s.num} className={`stage ${s.cls}`}>
              <span className="step-num">{s.num}</span>
              <span className="name">
                <span className="ic" />
                {s.name}
              </span>
              <span className="meta">
                {s.meta.map(([k, v]) => (
                  <span key={k}>
                    {k} <span className="v">{v}</span>
                  </span>
                ))}
              </span>
              <span
                style={{
                  position: "absolute",
                  right: "12px",
                  top: "10px",
                  fontFamily: "var(--font-mono)",
                  fontSize: "10px",
                  color: "var(--text)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {s.time}
              </span>
            </div>
          ))}
        </div>

        <div className="cand-wrap">
          <aside className="cand-side">
            <div className="h">Run summary</div>
            {[
              ["retrievers", "3"],
              ["candidates · dense", "50"],
              ["candidates · BM25", "50"],
              ["candidates · graph", "23"],
              ["unique after dedupe", "47"],
              ["passed rerank floor", "5 / 47"],
              ["cited in answer", "5"],
            ].map(([k, v]) => (
              <div key={k} className="row">
                <span className="k">{k}</span>
                <span className="v">{v}</span>
              </div>
            ))}
            <div className="row">
              <span className="k">fallback triggered</span>
              <span className="v" style={{ color: "var(--ok)" }}>
                no
              </span>
            </div>

            <div className="formula">
              <span className="lab">RRF · current setting</span>
              score(<span className="var">d</span>) = Σᵣ 1 / (<span className="var">k</span> + rₐ(<span className="var">d</span>))
              <br />
              <span style={{ color: "var(--muted)" }}>
                where k = 60, rₐ = rank in retriever a
              </span>
            </div>

            <div className="h" style={{ marginTop: "14px" }}>
              Retriever agreement
            </div>
            <div style={{ display: "flex", gap: "8px", marginTop: "6px" }}>
              {[
                { lab: "D ∩ S", val: 23 },
                { lab: "D ∩ G", val: 9 },
                { lab: "S ∩ G", val: 7 },
              ].map((x) => (
                <div
                  key={x.lab}
                  style={{
                    flex: 1,
                    padding: "8px",
                    border: "1px solid var(--hair)",
                    borderRadius: "2px",
                    background: "var(--surface-1)",
                  }}
                >
                  <div style={{ fontSize: "10px", color: "var(--muted)" }}>{x.lab}</div>
                  <div
                    style={{
                      fontSize: "15px",
                      color: "var(--text)",
                      fontWeight: 600,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {x.val}
                  </div>
                </div>
              ))}
            </div>
          </aside>

          <div className="cand-table-wrap">
            <table className="cand-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>retr</th>
                  <th>document · chunk</th>
                  <th>type</th>
                  <th className="num">dense</th>
                  <th className="num">BM25</th>
                  <th className="num">graph</th>
                  <th className="num">RRF</th>
                  <th className="num">rerank</th>
                  <th className="num">Δ post-rerank</th>
                  <th>used</th>
                </tr>
              </thead>
              <tbody>
                {CANDIDATES.map((c) => (
                  <tr key={c.rank} className={c.used ? "used" : ""}>
                    <td className="num">
                      <span className={`rank-pill ${c.used ? "top" : "dim"}`}>{c.rank}</span>
                    </td>
                    <td>{c.used && <CitationChip n={c.rank} kind={c.kind} />}</td>
                    <td className="title">{c.doc}</td>
                    <td>
                      <span className="type-cell">{c.type}</span>
                    </td>
                    <td className="num">{c.dense}</td>
                    <td className="num">{c.sparse}</td>
                    <td className="num">{c.graph}</td>
                    <td className="num">{c.rrf.toFixed(5)}</td>
                    <td className="num">{c.rer.toFixed(3)}</td>
                    <td className="num">
                      <span
                        className={
                          c.delta.startsWith("↑")
                            ? "delta-up"
                            : c.delta.startsWith("↓")
                              ? "delta-down"
                              : "dim"
                        }
                      >
                        {c.delta}
                      </span>
                    </td>
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
          </div>
        </div>

        <div className="overlay-foot">
          <span>
            <span style={{ color: "var(--dim)" }}>showing</span>{" "}
            <span style={{ color: "var(--text)" }}>12 / 47</span> candidates
          </span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span>
            <span style={{ color: "var(--dim)" }}>sort</span>{" "}
            <span style={{ color: "var(--text-dim)" }}>RRF score desc</span>
          </span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span>
            <span style={{ color: "var(--dim)" }}>filter</span>{" "}
            <span style={{ color: "var(--text-dim)" }}>any retriever</span>
          </span>
          <span style={{ marginLeft: "auto" }}>
            <span className="kbd-hint">
              <span className="kbd">J/K</span> navigate
            </span>
            <span style={{ margin: "0 12px", color: "var(--dim)" }}>·</span>
            <span className="kbd-hint">
              <span className="kbd">E</span> export csv
            </span>
            <span style={{ margin: "0 12px", color: "var(--dim)" }}>·</span>
            <span className="kbd-hint">
              <span className="kbd">⌫</span> close
            </span>
          </span>
        </div>
      </div>
    </>
  );
}
