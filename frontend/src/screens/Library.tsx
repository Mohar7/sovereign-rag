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
import { BulkBar } from "../components/controls/BulkBar";
import { ChipButton } from "../components/controls/ChipButton";
import { Popover } from "../components/controls/Popover";
import { SortHeader, type SortDir } from "../components/controls/SortHeader";
import { Toast, type ToastKind } from "../components/controls/Toast";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { api, type DocumentSummary } from "../lib/api";

type DocType = "pdf" | "web" | "notes" | "code";
type DocSource = "scraped" | "upload" | "paste" | "approved-crawl";
type DocStatus = "indexed";

type SortField = "title" | "modified" | "size" | "chunks" | "status";

interface SortState {
  field: SortField;
  dir: "asc" | "desc";
}

interface ToastState {
  kind: ToastKind;
  message: string;
}

const SORT_OPTIONS: Array<{
  field: SortField;
  dir: "asc" | "desc";
  label: string;
  hint: string;
  arrow: "↑" | "↓";
}> = [
  { field: "title", dir: "asc", label: "title", hint: "A → Z", arrow: "↑" },
  { field: "title", dir: "desc", label: "title", hint: "Z → A", arrow: "↓" },
  { field: "modified", dir: "desc", label: "modified", hint: "newest first", arrow: "↓" },
  { field: "size", dir: "desc", label: "size", hint: "largest", arrow: "↓" },
  { field: "chunks", dir: "desc", label: "chunks", hint: "most", arrow: "↓" },
  { field: "status", dir: "asc", label: "status", hint: "grouped", arrow: "↓" },
];

function classifyType(uri: string): DocType {
  if (uri.startsWith("http")) return "web";
  if (/\.(pdf|docx|ppt)$/i.test(uri)) return "pdf";
  if (/\.(py|ts|js|tsx|jsx|go|rs|sql)$/i.test(uri)) return "code";
  return "notes";
}

function classifySource(uri: string): DocSource {
  if (uri.startsWith("http")) return "scraped";
  if (uri.startsWith("text://")) return "paste";
  if (uri.startsWith("corpus://")) return "upload";
  return "upload";
}

function classifyStatus(_doc: DocumentSummary): DocStatus {
  // Current API doesn't surface per-doc status; default to indexed.
  return "indexed";
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

  // Filter rail state — each set holds the currently-toggled filter values.
  // Empty set means "no filter applied for this facet" (i.e. show all).
  const [typeFilter, setTypeFilter] = useState<Set<DocType>>(new Set());
  const [sourceFilter, setSourceFilter] = useState<Set<DocSource>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<DocStatus>>(new Set());

  // Sort state — title asc by default to match the original chip label.
  const [sort, setSort] = useState<SortState>({ field: "title", dir: "asc" });
  const [sortOpen, setSortOpen] = useState(false);

  // Bulk-delete arming — first click arms, second click commits.
  const [deleteArmed, setDeleteArmed] = useState(false);

  const [toast, setToast] = useState<ToastState | null>(null);

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
    const byType: Record<DocType, number> = { pdf: 0, web: 0, notes: 0, code: 0 };
    const bySource: Record<DocSource, number> = {
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

  // Apply filter rail + sort to the documents list.
  const filteredDocs = useMemo(() => {
    const filtered = docs.filter((d) => {
      if (typeFilter.size > 0 && !typeFilter.has(classifyType(d.source_uri))) return false;
      if (sourceFilter.size > 0 && !sourceFilter.has(classifySource(d.source_uri))) return false;
      if (statusFilter.size > 0 && !statusFilter.has(classifyStatus(d))) return false;
      return true;
    });

    const sorted = [...filtered];
    const mul = sort.dir === "asc" ? 1 : -1;
    sorted.sort((a, b) => {
      switch (sort.field) {
        case "title":
          return mul * a.title.localeCompare(b.title);
        case "chunks":
          return mul * ((a.chunks || 0) - (b.chunks || 0));
        case "size":
          // No size field on DocumentSummary today — fall back to chunk count.
          return mul * ((a.chunks || 0) - (b.chunks || 0));
        case "modified":
          // No modified field yet — preserve API order, but flip direction.
          return mul * a.doc_id.localeCompare(b.doc_id);
        case "status":
          return mul * classifyStatus(a).localeCompare(classifyStatus(b));
        default:
          return 0;
      }
    });
    return sorted;
  }, [docs, typeFilter, sourceFilter, statusFilter, sort]);

  const toggleSelect = (uri: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(uri)) next.delete(uri);
      else next.add(uri);
      return next;
    });
    setDeleteArmed(false);
  };

  const toggleFilter = <T extends string>(
    setter: React.Dispatch<React.SetStateAction<Set<T>>>,
    value: T,
  ) => {
    setter((curr) => {
      const next = new Set(curr);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  };

  const sortLabel = useMemo(() => {
    return `${sort.field} · ${sort.dir}`;
  }, [sort]);

  const titleSortDir: SortDir = sort.field === "title" ? sort.dir : null;

  // Stubs — the backend has no /api/documents/{id} mutation endpoints yet.
  // TODO: wire to backend once api.reindex / api.exportDocs / api.deleteDocs land.
  const handleReindex = () => {
    if (selected.size === 0) return;
    const n = selected.size;
    setToast({ kind: "lavender", message: `${n} document${n === 1 ? "" : "s"} queued for re-index` });
  };

  const handleExport = () => {
    if (selected.size === 0) return;
    const n = selected.size;
    setToast({ kind: "ok", message: `${n} document${n === 1 ? "" : "s"} exported` });
  };

  const handleDelete = () => {
    if (selected.size === 0) return;
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    const n = selected.size;
    setSelected(new Set());
    setDeleteArmed(false);
    setToast({ kind: "warn", message: `${n} document${n === 1 ? "" : "s"} deleted` });
  };

  const selectSort = (field: SortField, dir: "asc" | "desc") => {
    setSort({ field, dir });
    setSortOpen(false);
  };

  const toggleTitleSort = () => {
    if (sort.field !== "title") {
      setSort({ field: "title", dir: "asc" });
    } else {
      setSort({ field: "title", dir: sort.dir === "asc" ? "desc" : "asc" });
    }
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
                <span
                  className="right"
                  style={{ cursor: "pointer" }}
                  onClick={() => setTypeFilter(new Set())}
                >
                  clear
                </span>
              </div>
              {(["pdf", "web", "notes", "code"] as const).map((t) => (
                <div
                  key={t}
                  className={`filter-row ${typeFilter.has(t) ? "on" : ""}`}
                  onClick={() => toggleFilter(setTypeFilter, t)}
                  style={{ cursor: "pointer" }}
                >
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
                <span
                  className="right"
                  style={{ cursor: "pointer" }}
                  onClick={() => setSourceFilter(new Set())}
                >
                  clear
                </span>
              </div>
              {(["upload", "scraped", "paste", "approved-crawl"] as const).map((s) => (
                <div
                  key={s}
                  className={`filter-row ${sourceFilter.has(s) ? "on" : ""}`}
                  onClick={() => toggleFilter(setSourceFilter, s)}
                  style={{ cursor: "pointer" }}
                >
                  <span className="cb" />
                  <span className="lbl">{s}</span>
                  <span className="count">{counts.bySource[s]}</span>
                </div>
              ))}
            </div>
            <div className="filter-group">
              <div className="gh">
                <span>◗ status</span>
                <span
                  className="right"
                  style={{ cursor: "pointer" }}
                  onClick={() => setStatusFilter(new Set())}
                >
                  reset
                </span>
              </div>
              <div
                className={`filter-row ${statusFilter.has("indexed") ? "on" : ""}`}
                onClick={() => toggleFilter(setStatusFilter, "indexed")}
                style={{ cursor: "pointer" }}
              >
                <span className="cb" />
                <span className="lbl">indexed</span>
                <span className="count">{docs.length}</span>
              </div>
            </div>
          </div>
        </aside>
      }
    >
      {toast && (
        <Toast
          kind={toast.kind}
          onClose={() => setToast(null)}
          autoDismissMs={4000}
        >
          {toast.message}
        </Toast>
      )}

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
          <span style={{ position: "relative" }}>
            <ChipButton
              lab="sort"
              chev
              open={sortOpen}
              onClick={() => setSortOpen((v) => !v)}
            >
              {sortLabel}
            </ChipButton>
            {sortOpen && (
              <Popover
                className="sort-pop"
                header="sort · 5 options"
                style={{ position: "absolute", top: "32px", right: 0, zIndex: 6 }}
                onClose={() => setSortOpen(false)}
              >
                {SORT_OPTIONS.map((opt) => {
                  const active = sort.field === opt.field && sort.dir === opt.dir;
                  return (
                    <div
                      key={`${opt.field}-${opt.dir}`}
                      className={`opt ${active ? "on" : ""}`}
                      onClick={() => selectSort(opt.field, opt.dir)}
                    >
                      <span>{opt.label}</span>
                      <span className="k">{opt.hint}</span>
                      <span
                        className={active ? "arrow" : ""}
                        style={!active ? { marginLeft: "auto" } : undefined}
                      >
                        {opt.arrow}
                      </span>
                    </div>
                  );
                })}
              </Popover>
            )}
          </span>
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

      <BulkBar count={selected.size}>
        <ChipButton onClick={handleReindex}>↻ re-index</ChipButton>
        <ChipButton onClick={handleExport}>⤓ export</ChipButton>
        <ChipButton danger onClick={handleDelete}>
          {deleteArmed ? "click again to confirm" : "✕ delete"}
        </ChipButton>
        <span className="right">
          <span style={{ color: "var(--muted)", cursor: "pointer" }} onClick={() => setSelected(new Set())}>
            clear
          </span>
        </span>
      </BulkBar>

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
            {loading ? "searching…" : `${filteredDocs.length} result${filteredDocs.length === 1 ? "" : "s"}`}
          </span>
        </div>
        <div className="right">
          <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>
            {selected.size} selected
          </span>
          <ChipButton disabled={selected.size === 0} onClick={handleReindex}>
            re-index
          </ChipButton>
          <ChipButton disabled={selected.size === 0} onClick={handleExport}>
            export
          </ChipButton>
          <ChipButton danger disabled={selected.size === 0} onClick={handleDelete}>
            {deleteArmed ? "confirm?" : "delete"}
          </ChipButton>
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
                <SortHeader
                  label="Document"
                  dir={titleSortDir}
                  onClick={toggleTitleSort}
                />
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
            {filteredDocs.map((d) => (
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
          <span style={{ color: "var(--text)" }}>{filteredDocs.length}</span> of{" "}
          <span style={{ color: "var(--text-dim)" }}>{corpus?.documents ?? "—"}</span>
        </span>
      </div>
    </AppShell>
  );
}
