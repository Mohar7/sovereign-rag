// Library detail — single document. Lists every chunk, the extracted
// entities, and graph relations. Wired to /api/documents/search (to find
// the doc's title from the id) and /api/entities (to list entities +
// relations). A future /api/documents/{id}/chunks would give the chunk
// bodies; today we fall back to "(N chunks indexed)".

import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { api, type DocumentSummary, type EntitiesResponse } from "../lib/api";

interface Props {
  docId: string;
}

export function LibraryDetail({ docId }: Props) {
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [doc, setDoc] = useState<DocumentSummary | null>(null);
  const [graph, setGraph] = useState<EntitiesResponse>({ entities: [], relations: [] });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .documentsSearch("", 200)
      .then((all) => {
        const match = all.find((d) => d.doc_id === docId) ?? null;
        setDoc(match);
      })
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
    api
      .entities(docId)
      .then(setGraph)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [docId]);

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  return (
    <AppShell
      active="library"
      dataLabel="Library · detail"
      variant="with-right"
      topBar={
        <AppTopBar
          section="Library"
          page={doc?.title ?? "(loading)"}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>
              Chunks <span className="count">· {doc?.chunks ?? "—"}</span>
            </span>
          </div>
          <div className="filter-list" style={{ padding: "10px 14px", color: "var(--muted)", fontSize: 11 }}>
            Per-chunk listing requires the future <code className="mono">/api/documents/{"{id}"}/chunks</code>{" "}
            endpoint. Use the source-detail drawer from a citation in the Ask view for full chunk content
            today.
          </div>
        </aside>
      }
      right={
        <aside className="filter-rail" style={{ borderLeft: "1px solid var(--hair)", borderRight: "none" }}>
          <div className="rail-head">
            <span>Metadata</span>
          </div>
          <div style={{ padding: "12px 14px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>
            <div>
              <span style={{ color: "var(--dim)" }}>doc_id</span>{" "}
              {doc?.doc_id ?? docId}
            </div>
            <div>
              <span style={{ color: "var(--dim)" }}>source</span>{" "}
              {doc?.source_uri ?? "—"}
            </div>
            <div>
              <span style={{ color: "var(--dim)" }}>chunks</span> {doc?.chunks ?? "—"}
            </div>
            <div>
              <span style={{ color: "var(--dim)" }}>entities</span> {graph.entities.length}
            </div>
            <div>
              <span style={{ color: "var(--dim)" }}>relations</span> {graph.relations.length}
            </div>
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">{doc?.title ?? "Loading…"}</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {doc?.source_uri ?? ""}
          </div>
        </div>
        <div className="right">
          <button
            className="chip-btn"
            onClick={() => {
              window.location.hash = "#library";
            }}
          >
            ← back
          </button>
        </div>
      </div>

      {err && (
        <div style={{ padding: 14, color: "var(--err)", fontSize: 11 }}>
          {err}
        </div>
      )}

      <div style={{ flex: 1, overflow: "auto", padding: "0 28px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="ingest-panel">
          <div className="h">
            ◗ entities <span className="count">· {graph.entities.length}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
            {graph.entities.length === 0 && (
              <span style={{ color: "var(--muted)", fontSize: 11, fontStyle: "italic" }}>
                no extracted entities (or the document doesn't exist any more)
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

        <div className="ingest-panel">
          <div className="h">
            ◗ graph relations <span className="count">· {graph.relations.length}</span>{" "}
            <span className="right" style={{ color: "var(--graph)" }}>
              neo4j
            </span>
          </div>
          <div style={{ marginTop: 8 }}>
            {graph.relations.length === 0 ? (
              <span style={{ color: "var(--muted)", fontSize: 11, fontStyle: "italic" }}>
                no relations extracted
              </span>
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
        </div>
      </div>
    </AppShell>
  );
}
