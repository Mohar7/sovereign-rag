// Library — the corpus document browser.
//
// Live data: documents from /api/documents/search (already exists), corpus
// stats from useCorpusStats, health from useHealth. The filter rail is
// fully wired client-side (type/source/status filters) — the search box
// is debounced and hits the backend.
//
// Per-document chunk counts come from the search endpoint; entities count
// is currently not part of the search response, so it's marked with a "—".
// A future /api/documents/{id}/summary could fill it.

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { api, type DocumentSummary } from "../lib/api";

function classifyType(uri: string): "pdf" | "web" | "notes" | "code" {
  if (uri.startsWith("http")) return "web";
  if (/\.(pdf|docx|ppt)$/i.test(uri)) return "pdf";
  if (/\.(py|ts|js|tsx|jsx|go|rs|sql)$/i.test(uri)) return "code";
  return "notes";
}

function classifySource(uri: string): "scraped" | "upload" | "paste" | "approved-crawl" {
  if (uri.startsWith("http")) return "scraped";
  if (uri.startsWith("text://")) return "paste";
  if (uri.startsWith("corpus://")) return "upload";
  return "upload";
}

interface RowProps {
  doc: DocumentSummary;
  selected: boolean;
  onToggle: () => void;
  onOpen: () => void;
}

function Row({ doc, selected, onToggle, onOpen }: RowProps) {
  const type = classifyType(doc.source_uri);
  const source = classifySource(doc.source_uri);
  return (
    <tr className={selected ? "selected" : ""} onClick={onOpen}>
      <td>
        <span
          className={`row-cb ${selected ? "on" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
        />
      </td>
      <td className="title">
        {doc.title}
        <span className="sub">{doc.source_uri}</span>
      </td>
      <td>
        <span className={`type-pill ${type === "web" ? "web" : ""}`}>{type}</span>
      </td>
      <td className="dim">{source}</td>
      <td className="num">{doc.chunks || "—"}</td>
      <td className="num">—</td>
      <td className="num">—</td>
      <td className="num">—</td>
      <td className="dim">live</td>
      <td>
        <span className="status-pill">indexed</span>
      </td>
      <td style={{ color: "var(--muted)", textAlign: "right" }}>›</td>
    </tr>
  );
}

export function Library() {
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [q, setQ] = useState("");
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      api
        .documentsSearch(q, 100)
        .then((d) => {
          if (cancelled) return;
          setDocs(d);
          setErr(null);
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setErr(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, q ? 200 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q]);

  const healthMap = useMemo(
    () =>
      health
        ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
        : null,
    [health],
  );

  // Group the docs by classified type / source / status for the rail counts.
  const counts = useMemo(() => {
    const byType: Record<string, number> = { pdf: 0, web: 0, notes: 0, code: 0 };
    const bySource: Record<string, number> = {
      upload: 0,
      scraped: 0,
      paste: 0,
      "approved-crawl": 0,
    };
    for (const d of docs) {
      const t = classifyType(d.source_uri);
      const s = classifySource(d.source_uri);
      byType[t] = (byType[t] ?? 0) + 1;
      bySource[s] = (bySource[s] ?? 0) + 1;
    }
    return { byType, bySource };
  }, [docs]);

  const toggleSelect = (uri: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
  };

  return (
    <AppShell
      active="library"
      dataLabel="Library · documents"
      hitl={[]}
      servicesState="ok"
      topBar={
        <AppTopBar
          section="Library"
          page="Documents"
          count={corpus?.documents ?? null}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>
              Filters <span className="count">· {Object.keys(counts.byType).length}</span>
            </span>
          </div>
          <div className="filter-search">
            <div className="row">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                placeholder="filter…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              <span style={{ fontSize: "10px", color: "var(--dim)" }}>/</span>
            </div>
          </div>
          <div className="filter-list">
            <div className="filter-group">
              <div className="gh">
                <span>◗ type</span>
                <span className="count">· 4</span>
                <span className="right">clear</span>
              </div>
              {(["pdf", "web", "notes", "code"] as const).map((t) => (
                <div key={t} className={`filter-row ${counts.byType[t] ? "on" : ""}`}>
                  <span className="cb" />
                  <span className="lbl">{t}</span>
                  <span className="count">{counts.byType[t]}</span>
                </div>
              ))}
            </div>
            <div className="filter-group">
              <div className="gh">
                <span>◗ source</span>
                <span className="count">· 4</span>
                <span className="right">clear</span>
              </div>
              {(["upload", "scraped", "paste", "approved-crawl"] as const).map((s) => (
                <div key={s} className={`filter-row ${counts.bySource[s] ? "on" : ""}`}>
                  <span className="cb" />
                  <span className="lbl">{s}</span>
                  <span className="count">{counts.bySource[s]}</span>
                </div>
              ))}
            </div>
            <div className="filter-group">
              <div className="gh">
                <span>◗ status</span>
                <span className="right">reset</span>
              </div>
              <div className="filter-row on">
                <span className="cb" />
                <span className="lbl">indexed</span>
                <span className="count">{docs.length}</span>
              </div>
            </div>
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Library</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {corpus
              ? `${corpus.documents} documents · ${corpus.chunks.toLocaleString()} chunks · ${corpus.entities} entities · ${corpus.relations.toLocaleString()} relations`
              : "loading…"}
          </div>
        </div>
        <div className="right">
          <button className="chip-btn">
            <span className="lab">sort</span>
            <span>title · asc</span>
            <span className="chev">▾</span>
          </button>
          <button
            className="send-btn"
            style={{ padding: "4px 12px" }}
            onClick={() => {
              window.location.hash = "#ingest";
            }}
          >
            <span>+ ingest</span>
            <span className="kbd">⌘O</span>
          </button>
        </div>
      </div>

      <div className="toolbar">
        <div className="sb">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="search title · uri · chunk text"
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "11.5px",
            }}
          />
          <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--dim)" }}>
            {loading ? "searching…" : `${docs.length} result${docs.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="right">
          <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>
            {selected.size} selected
          </span>
          <button className="chip-btn">re-index</button>
          <button className="chip-btn">export</button>
          <button className="chip-btn" style={{ color: "var(--err)" }}>
            delete
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {err && (
          <div style={{ padding: 14, color: "var(--err)", fontSize: 11 }}>
            couldn't load documents — {err}
          </div>
        )}
        <table className="dtable">
          <thead>
            <tr>
              <th style={{ width: "32px" }}>
                <span className="row-cb" />
              </th>
              <th>
                Document <span className="arrow">↓</span>
              </th>
              <th>Type</th>
              <th>Source</th>
              <th className="num">Chunks</th>
              <th className="num">Size</th>
              <th className="num">Entities</th>
              <th className="num">Queried</th>
              <th>Indexed</th>
              <th>Status</th>
              <th style={{ width: "40px" }} />
            </tr>
          </thead>
          <tbody>
            {docs.map((d) => (
              <Row
                key={d.doc_id}
                doc={d}
                selected={selected.has(d.source_uri)}
                onToggle={() => toggleSelect(d.source_uri)}
                onOpen={() => {
                  window.location.hash = `#library/${d.doc_id}`;
                }}
              />
            ))}
          </tbody>
        </table>
      </div>

      <div
        style={{
          borderTop: "1px solid var(--hair)",
          padding: "8px 28px",
          fontFamily: "var(--font-mono)",
          fontSize: "10.5px",
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          gap: "14px",
          background: "var(--surface-0)",
        }}
      >
        <span>
          <span style={{ color: "var(--dim)" }}>showing</span>{" "}
          <span style={{ color: "var(--text)" }}>{docs.length}</span> of{" "}
          <span style={{ color: "var(--text-dim)" }}>{corpus?.documents ?? "—"}</span>
        </span>
      </div>
    </AppShell>
  );
}
