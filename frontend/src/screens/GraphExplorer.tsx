// Graph explorer — Neo4j knowledge graph visualisation.
//
// We don't yet ship a /api/graph endpoint, so the layout is a hand-placed
// preview drawn from the entity counts we DO have (/api/corpus/stats gives
// us entity + relation totals; /api/entities?doc_id gives per-doc detail).
// Selecting a known doc on the left fans out its entities + relations into
// the canvas; choosing "all" shows the summary numbers from corpus/stats.

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { api, type DocumentSummary, type EntitiesResponse } from "../lib/api";

interface NodePos {
  id: string;
  name: string;
  type: string;
  x: number;
  y: number;
}

function layout(entities: EntitiesResponse["entities"]): NodePos[] {
  // Simple deterministic circle layout — enough to give the user a sense of
  // shape without dragging in a force-graph library for a prototype panel.
  const cx = 360;
  const cy = 230;
  const r = 170;
  return entities.slice(0, 18).map((e, i, arr) => {
    const a = (i / Math.max(1, arr.length)) * Math.PI * 2;
    return {
      id: `${e.type}:${e.name}`,
      name: e.name,
      type: e.type,
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    };
  });
}

const TYPE_COLORS: Record<string, string> = {
  TECHNOLOGY: "var(--vector)",
  CONCEPT: "var(--graph)",
  PERSON: "var(--human)",
  ORG: "var(--ok)",
};

export function GraphExplorer() {
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [graph, setGraph] = useState<EntitiesResponse>({ entities: [], relations: [] });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .documentsSearch("", 30)
      .then((d) => {
        setDocs(d);
        if (d.length > 0 && !activeDoc) setActiveDoc(d[0]!.doc_id);
      })
      .catch(() => setDocs([]));
  }, [activeDoc]);

  useEffect(() => {
    if (!activeDoc) {
      setGraph({ entities: [], relations: [] });
      return;
    }
    api
      .entities(activeDoc)
      .then(setGraph)
      .catch((e: unknown) => setErr(e instanceof Error ? e.message : String(e)));
  }, [activeDoc]);

  const nodes = useMemo(() => layout(graph.entities), [graph]);
  const nodeIndex = useMemo(
    () => Object.fromEntries(nodes.map((n) => [n.name, n])),
    [nodes],
  );

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  return (
    <AppShell
      active="graph"
      dataLabel="Graph · knowledge graph explorer"
      topBar={
        <AppTopBar
          section="Graph"
          page="Knowledge graph"
          count={corpus?.entities ?? null}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>
              Documents <span className="count">· {docs.length}</span>
            </span>
          </div>
          <div className="filter-list" style={{ padding: "6px 0" }}>
            {docs.map((d) => (
              <div
                key={d.doc_id}
                className={`filter-row ${activeDoc === d.doc_id ? "on" : ""}`}
                style={{ padding: "8px 14px", cursor: "pointer" }}
                onClick={() => setActiveDoc(d.doc_id)}
              >
                <span className="lbl" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {d.title}
                </span>
                <span className="count">{d.chunks}</span>
              </div>
            ))}
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Graph explorer</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {corpus
              ? `${corpus.entities} entities · ${corpus.relations.toLocaleString()} relations across ${corpus.documents} documents`
              : "loading corpus…"}
          </div>
        </div>
      </div>

      <div className="graph-wrap">
        <div className="graph-canvas">
          {err && (
            <div style={{ position: "absolute", inset: 12, color: "var(--err)", fontSize: 11 }}>
              {err}
            </div>
          )}
          <svg width="100%" height="100%" viewBox="0 0 720 460">
            {graph.relations.slice(0, 60).map((r, i) => {
              const a = nodeIndex[r[0]];
              const b = nodeIndex[r[2]];
              if (!a || !b) return null;
              return (
                <line
                  key={i}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="var(--hair-strong)"
                  strokeWidth={1}
                  opacity={0.55}
                />
              );
            })}
            {nodes.map((n) => (
              <g key={n.id} transform={`translate(${n.x},${n.y})`}>
                <circle r={6} fill={TYPE_COLORS[n.type] ?? "var(--text-dim)"} />
                <text
                  x={10}
                  y={4}
                  fill="var(--text)"
                  fontSize={10}
                  fontFamily="var(--font-mono)"
                  style={{ textShadow: "0 0 4px var(--bg)" }}
                >
                  {n.name}
                </text>
              </g>
            ))}
            {nodes.length === 0 && !err && (
              <text
                x={360}
                y={230}
                fill="var(--muted)"
                fontSize={11}
                fontFamily="var(--font-mono)"
                textAnchor="middle"
              >
                Pick a document on the left to expand its entity neighbourhood.
              </text>
            )}
          </svg>
        </div>

        <aside className="graph-detail">
          <div className="h">◗ Type legend</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {Object.entries(TYPE_COLORS).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 8, height: 8, borderRadius: 4, background: v, display: "inline-block" }} />
                <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{k.toLowerCase()}</span>
              </div>
            ))}
          </div>

          <div className="h" style={{ marginTop: 18 }}>
            ◗ Entities <span className="count">· {graph.entities.length}</span>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {graph.entities.slice(0, 30).map((e) => (
              <span key={`${e.type}-${e.name}`} className="entity" title={e.description ?? ""}>
                <span className="kind">{e.type.toLowerCase()}</span>
                {e.name}
              </span>
            ))}
          </div>

          <div className="h" style={{ marginTop: 18 }}>
            ◗ Relations <span className="count">· {graph.relations.length}</span>
          </div>
          <div style={{ marginTop: 6 }}>
            {graph.relations.slice(0, 12).map((r, i) => (
              <div key={i} className="relation">
                <span className="ent">{r[0]}</span>
                <span className="pred">{r[1]}</span>
                <span className="ent">{r[2]}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </AppShell>
  );
}
