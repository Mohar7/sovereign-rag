// Source-detail drawer — opens when a citation chip is clicked.
// Shows the chunk text with highlights, prev/next neighbour chunks,
// extracted entities, and graph relations from Neo4j — all fetched
// live from /api/chunks/{id}/neighbours and /api/entities?doc_id=….
//
// All footer actions write to real backend state:
//   - ↗ open               opens the source URI in a new tab
//   - ⌖ pin / unpin        POSTs to /api/threads/{id}/context
//   - exclude from thread  POSTs the same with action=excluded
//   - re-rerank            asks the same question again (composer
//                          callback) — caller decides what to do.
//   - open in library      triggers a route change to /documents
//                          (caller handles routing).

import { useEffect, useState } from "react";
import { CitationChip } from "../components/CitationChip";
import { api, type ChunkSummary, type EntitiesResponse, type Settings } from "../lib/api";
import type { Citation } from "../lib/types";

interface Props {
  n: number;
  citation: Citation;
  settings?: Settings | null;
  /** Whether this chunk is pinned in the active thread (drives the pin button label). */
  pinned?: boolean;
  /** Whether this chunk is excluded in the active thread. */
  excluded?: boolean;
  /** Pin/unpin in the active thread. Caller wires this to useThreadContext. */
  onPin?: (chunkId: string) => Promise<void> | void;
  onUnpin?: (chunkId: string) => Promise<void> | void;
  onExclude?: (chunkId: string) => Promise<void> | void;
  /** Re-fire the last question — caller decides which question and with what knobs. */
  onRerank?: () => void;
  /** Open the document in the library overlay or route. */
  onOpenInLibrary?: (docId: string) => void;
  onClose: () => void;
}

function splitUri(uri: string): { scheme: string; path: string } {
  const i = uri.indexOf("://");
  return i === -1
    ? { scheme: "", path: uri }
    : { scheme: uri.slice(0, i + 3), path: uri.slice(i + 3) };
}

export function SourceDetailDrawer({
  n,
  citation,
  settings,
  pinned,
  excluded,
  onPin,
  onUnpin,
  onExclude,
  onRerank,
  onOpenInLibrary,
  onClose,
}: Props) {
  const embedLabel = settings
    ? settings.embed_provider === "openai"
      ? `openai · ${settings.embed_dim}d`
      : `${settings.embed_model} · ${settings.embed_dim}d`
    : "—";
  const { scheme, path } = splitUri(citation.source_uri);
  const kind: "hybrid" | "vector" | "graph" | "web" =
    scheme.startsWith("http") ? "web" : "vector";

  // Live neighbours + entities fetched from FastAPI for this chunk.
  const [prev, setPrev] = useState<ChunkSummary | null>(null);
  const [next, setNext] = useState<ChunkSummary | null>(null);
  const [neigErr, setNeigErr] = useState<string | null>(null);
  const [graph, setGraph] = useState<EntitiesResponse>({ entities: [], relations: [] });
  const [entErr, setEntErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .chunkNeighbours(citation.chunk_id)
      .then((n) => {
        if (cancelled) return;
        setPrev(n.prev);
        setNext(n.next);
        setNeigErr(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setNeigErr(err instanceof Error ? err.message : String(err));
      });
    api
      .entities(citation.doc_id)
      .then((r) => {
        if (!cancelled) {
          setGraph(r);
          setEntErr(null);
        }
      })
      .catch((err) => {
        if (!cancelled) setEntErr(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [citation.chunk_id, citation.doc_id]);
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
                disabled={!scheme.startsWith("http")}
                title={scheme.startsWith("http") ? "Open source URL" : "Local chunk — nothing to open"}
                onClick={() => {
                  if (scheme.startsWith("http")) window.open(citation.source_uri, "_blank");
                }}
              >
                ↗ open
              </button>
              <button
                className={`chip-btn ${pinned ? "on" : ""}`}
                type="button"
                onClick={() => {
                  if (!onPin || !onUnpin) return;
                  void (pinned ? onUnpin(citation.chunk_id) : onPin(citation.chunk_id));
                }}
                title={pinned ? "Unpin from thread" : "Pin to thread"}
              >
                ⌖ {pinned ? "pinned" : "pin"}
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
              {prev && (
                <div className="neighbor">
                  <div className="nstrip">
                    <span className="arrow">↑ prev</span>
                    <span>
                      chunk {prev.chunk_id.slice(0, 8)} · position {prev.position}
                    </span>
                  </div>
                  {prev.raw_text.slice(0, 240)}…
                </div>
              )}
              {next && (
                <div className="neighbor next">
                  <div className="nstrip">
                    <span className="arrow">↓ next</span>
                    <span>
                      chunk {next.chunk_id.slice(0, 8)} · position {next.position}
                    </span>
                  </div>
                  {next.raw_text.slice(0, 240)}…
                </div>
              )}
              {!prev && !next && (
                <div
                  style={{
                    color: "var(--muted)",
                    fontSize: "11px",
                    fontFamily: "var(--font-mono)",
                    fontStyle: "italic",
                    padding: "6px 0",
                  }}
                >
                  {neigErr
                    ? `couldn't load neighbours — ${neigErr}`
                    : "no adjacent chunks in this document"}
                </div>
              )}
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ entities in this document{" "}
              <span className="count">· {graph.entities.length}</span>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
              {graph.entities.length === 0 && (
                <span
                  style={{
                    color: "var(--muted)",
                    fontSize: "11px",
                    fontStyle: "italic",
                  }}
                >
                  {entErr ? `couldn't load entities — ${entErr}` : "—"}
                </span>
              )}
              {graph.entities.map((e) => (
                <span key={`${e.type}:${e.name}`} className="entity" title={e.description ?? ""}>
                  <span className="kind">{e.type.toLowerCase()}</span>
                  {e.name}
                </span>
              ))}
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ graph relations <span className="count">· {graph.relations.length}</span>{" "}
              <span className="right" style={{ color: "var(--graph)" }}>
                neo4j
              </span>
            </div>
            {graph.relations.length === 0 ? (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "11px",
                  fontStyle: "italic",
                  padding: "4px 0",
                }}
              >
                no relations extracted for this document
              </div>
            ) : (
              graph.relations.map((r, i) => (
                <div key={i} className="relation">
                  <span className="ent">{r[0]}</span>
                  <span className="pred">{r[1]}</span>
                  <span className="ent">{r[2]}</span>
                </div>
              ))
            )}
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
                  <td>{embedLabel}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <div className="drawer-foot">
          <span className="scope">
            cited as <span style={{ color: "var(--text)" }}>[{n}]</span>
            {excluded && (
              <span style={{ color: "var(--err)", marginLeft: "8px" }}>· excluded next turn</span>
            )}
          </span>
          <div className="right">
            <button
              className={`btn ghost ${excluded ? "on" : ""}`}
              type="button"
              disabled={!onExclude || !onUnpin}
              onClick={() => {
                if (!onExclude || !onUnpin) return;
                void (excluded ? onUnpin(citation.chunk_id) : onExclude(citation.chunk_id));
              }}
            >
              {excluded ? "stop excluding" : "exclude from thread"}
            </button>
            <button
              className="btn ghost"
              type="button"
              disabled={!onRerank}
              onClick={() => onRerank?.()}
              title="Re-ask the same question; useful after changing rerank settings"
            >
              re-rerank
            </button>
            <button
              className="btn warm"
              type="button"
              disabled={!onOpenInLibrary}
              onClick={() => onOpenInLibrary?.(citation.doc_id)}
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
