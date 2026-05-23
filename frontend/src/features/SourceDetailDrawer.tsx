// Source-detail drawer — opens when a citation chip is clicked.
// Shows the chunk text with highlights, prev/next neighbour chunks,
// extracted entities, graph relations from Neo4j, and a metadata table.
//
// Wires `citation` from the active assistant turn; the neighbour / entities /
// relations blocks render the design's mock data until a `/chunks/{id}` and
// `/graph/local` endpoint exist on the backend (filed as roadmap).

import type { Citation } from "../lib/types";
import { CitationChip } from "../components/CitationChip";

interface Props {
  n: number;
  citation: Citation;
  onClose: () => void;
}

interface Neighbour {
  position: "prev" | "next";
  chunk_id: string;
  page?: number | string;
  rerank: number;
  text: string;
}

const MOCK_NEIGHBOURS: Neighbour[] = [
  {
    position: "prev",
    chunk_id: "7be1d4f2",
    page: 3,
    rerank: 0.412,
    text:
      "We compare several rank-fusion strategies including CombSUM, CombMNZ, and Condorcet voting against the proposed RRF on a battery of TREC tracks…",
  },
  {
    position: "next",
    chunk_id: "a02c19de",
    page: 4,
    rerank: 0.529,
    text:
      "The constant k acts as a soft cap on the contribution of low-ranked candidates. In our sweep we tried k ∈ {10, 30, 60, 90, 120} and found 60 within 0.5pp of the per-task optimum…",
  },
];

const MOCK_ENTITIES = [
  { kind: "algo", name: "Reciprocal Rank Fusion" },
  { kind: "algo", name: "CombSUM" },
  { kind: "algo", name: "Condorcet" },
  { kind: "org", name: "TREC" },
  { kind: "person", name: "Cormack G." },
  { kind: "var", name: "k = 60" },
];

const MOCK_RELATIONS = [
  { s: "Reciprocal Rank Fusion", p: "cited by", o: "Milvus 2.6 docs" },
  { s: "Reciprocal Rank Fusion", p: "outperforms", o: "CombSUM" },
  { s: "k = 60", p: "default in", o: "Milvus / Vespa / Weaviate" },
  { s: "Cormack G.", p: "co-authored", o: "TREC-COVID overview" },
];

function splitUri(uri: string): { scheme: string; path: string } {
  const i = uri.indexOf("://");
  return i === -1
    ? { scheme: "", path: uri }
    : { scheme: uri.slice(0, i + 3), path: uri.slice(i + 3) };
}

export function SourceDetailDrawer({ n, citation, onClose }: Props) {
  const { scheme, path } = splitUri(citation.source_uri);
  const kind: "hybrid" | "vector" | "graph" | "web" =
    scheme.startsWith("http") ? "web" : "vector";
  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer-right" style={{ width: "640px" }}>
        <div className="drawer-head">
          <CitationChip n={n} kind={kind} />
          <span className="lab" style={{ marginLeft: "6px" }}>
            ◗ source
          </span>
          <span className="title">{citation.title || "untitled"}</span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              fontFamily: "var(--font-mono)",
              fontSize: "10.5px",
              color: "var(--muted)",
              marginBottom: "12px",
            }}
          >
            <span>
              {scheme}
              {path}
            </span>
            {citation.page != null && (
              <>
                <span style={{ color: "var(--dim)" }}>·</span>
                <span>
                  page <span style={{ color: "var(--text)" }}>{citation.page}</span>
                </span>
              </>
            )}
            <span style={{ color: "var(--dim)" }}>·</span>
            <span>
              chunk{" "}
              <span style={{ color: "var(--text)" }}>{citation.chunk_id.slice(0, 8)}</span>
            </span>
            <span style={{ marginLeft: "auto", display: "flex", gap: "6px" }}>
              <button
                className="chip-btn"
                onClick={() => {
                  if (scheme.startsWith("http")) window.open(citation.source_uri, "_blank");
                }}
              >
                ↗ open
              </button>
              <button className="chip-btn" type="button">
                ⌖ pin
              </button>
            </span>
          </div>

          <div className="chunk-display">
            <div className="label-strip">
              ◗ chunk {citation.chunk_id.slice(0, 8)} · the one cited in answer
            </div>
            <p style={{ margin: 0 }}>{citation.snippet}…</p>
          </div>

          <div className="drawer-section">
            <div className="h">◗ neighbouring chunks</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              {MOCK_NEIGHBOURS.map((nb) => (
                <div
                  key={nb.chunk_id}
                  className={nb.position === "next" ? "neighbor next" : "neighbor"}
                >
                  <div className="nstrip">
                    <span className="arrow">{nb.position === "prev" ? "↑ prev" : "↓ next"}</span>
                    <span>
                      chunk {nb.chunk_id} · page {nb.page ?? "—"}
                    </span>
                    <span style={{ marginLeft: "auto" }} className="score">
                      rerank {nb.rerank.toFixed(3)}
                    </span>
                  </div>
                  {nb.text}
                </div>
              ))}
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ entities in this chunk <span className="count">· {MOCK_ENTITIES.length}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {MOCK_ENTITIES.map((e) => (
                <span key={e.name} className="entity">
                  <span className="kind">{e.kind}</span>
                  {e.name}
                </span>
              ))}
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ graph relations <span className="count">· {MOCK_RELATIONS.length}</span>{" "}
              <span className="right" style={{ color: "var(--graph)" }}>
                neo4j
              </span>
            </div>
            {MOCK_RELATIONS.map((r, i) => (
              <div key={i} className="relation">
                <span className="ent">{r.s}</span>
                <span className="pred">{r.p}</span>
                <span className="ent">{r.o}</span>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <div className="h">◗ metadata</div>
            <table className="meta-table">
              <tbody>
                <tr>
                  <td>chunk_id</td>
                  <td>{citation.chunk_id}</td>
                </tr>
                <tr>
                  <td>document_id</td>
                  <td>{citation.doc_id}</td>
                </tr>
                <tr>
                  <td>rerank_score</td>
                  <td>{citation.score.toFixed(3)}</td>
                </tr>
                {citation.page != null && (
                  <tr>
                    <td>page</td>
                    <td>{citation.page}</td>
                  </tr>
                )}
                <tr>
                  <td>embedding</td>
                  <td>bge-m3 · 1024d</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="drawer-foot">
          <span className="scope">
            cited as <span style={{ color: "var(--text)" }}>[{n}]</span>
          </span>
          <div className="right">
            <button className="btn ghost" type="button">
              exclude from thread
            </button>
            <button className="btn ghost" type="button">
              re-rerank
            </button>
            <button
              className="btn warm"
              type="button"
              style={{ background: "var(--vector)", color: "#0a0612" }}
            >
              open in library
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
