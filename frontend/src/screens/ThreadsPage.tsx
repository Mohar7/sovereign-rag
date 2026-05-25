// Threads — card grid view of every conversation, wired to useThreads.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { CitationChip } from "../components/CitationChip";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { BulkBar } from "../components/controls/BulkBar";
import { ChipButton } from "../components/controls/ChipButton";
import { KebabMenu } from "../components/controls/KebabMenu";
import { Toast } from "../components/controls/Toast";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { useThreads } from "../hooks/useThreads";
import type { ThreadSummary } from "../lib/types";

type FilterKey = "active" | "needsApproval" | "webFallback" | "graphCitations";
type FilterState = Record<FilterKey, boolean>;

const EMPTY_FILTERS: FilterState = {
  active: false,
  needsApproval: false,
  webFallback: false,
  graphCitations: false,
};

/** Highlight occurrences of `needle` inside `haystack` with .hl-match spans. */
function highlight(haystack: string, needle: string): ReactNode {
  if (!needle) return haystack;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  while (i < haystack.length) {
    const idx = lowerHay.indexOf(lowerNeedle, i);
    if (idx === -1) {
      out.push(haystack.slice(i));
      break;
    }
    if (idx > i) out.push(haystack.slice(i, idx));
    out.push(
      <span key={`hl-${key++}`} className="hl-match">
        {haystack.slice(idx, idx + needle.length)}
      </span>,
    );
    i = idx + needle.length;
  }
  return <>{out}</>;
}

/** Pragmatic stand-ins until ThreadSummary carries these flags. */
function hasWebFallback(_t: ThreadSummary): boolean {
  // TODO: wire to backend — ThreadSummary lacks this field today.
  return false;
}
function hasGraphCitations(_t: ThreadSummary): boolean {
  // TODO: wire to backend — ThreadSummary lacks this field today.
  return false;
}

export function ThreadsPage() {
  const { threads } = useThreads();
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [q, setQ] = useState("");
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const lowered = q.trim().toLowerCase();
  const filtered = useMemo(() => {
    return threads.filter((t) => {
      if (lowered && !t.title.toLowerCase().includes(lowered)) return false;
      if (filters.active && t.paused_at_interrupt) return false;
      if (filters.needsApproval && !t.paused_at_interrupt) return false;
      if (filters.webFallback && !hasWebFallback(t)) return false;
      if (filters.graphCitations && !hasGraphCitations(t)) return false;
      return true;
    });
  }, [threads, lowered, filters]);

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;
  const hitlCount = threads.filter((t) => t.paused_at_interrupt).length;

  const toggleFilter = (k: FilterKey) => {
    setFilters((f) => ({ ...f, [k]: !f[k] }));
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearSelection = () => {
    setSelected(new Set());
    setDeleteArmed(false);
  };

  const fireToast = (msg: string) => {
    setToast(msg);
  };

  // ---- Bulk action stubs ----
  const archiveThreads = (ids: string[]) => {
    // TODO: wire to backend
    console.log("[threads] archive", ids);
    fireToast(`${ids.length} thread${ids.length === 1 ? "" : "s"} archived`);
    clearSelection();
  };
  const forkThreads = (ids: string[]) => {
    // TODO: wire to backend
    console.log("[threads] fork", ids);
    fireToast(`${ids.length} thread${ids.length === 1 ? "" : "s"} forked`);
    clearSelection();
  };
  const exportThreads = (ids: string[]) => {
    // TODO: wire to backend
    console.log("[threads] export json", ids);
    fireToast(`exported ${ids.length} thread${ids.length === 1 ? "" : "s"}`);
    clearSelection();
  };
  const deleteThreads = (ids: string[]) => {
    if (!deleteArmed) {
      setDeleteArmed(true);
      return;
    }
    // TODO: wire to backend
    console.log("[threads] delete", ids);
    fireToast(`${ids.length} thread${ids.length === 1 ? "" : "s"} deleted`);
    clearSelection();
  };

  // ---- Per-card kebab stubs ----
  const kebabOptions = (t: ThreadSummary) => [
    {
      label: "rename",
      onSelect: () => {
        // TODO: wire to backend
        console.log("[thread] rename", t.thread_id);
      },
    },
    {
      label: "fork",
      kbd: "⌘D",
      onSelect: () => {
        // TODO: wire to backend
        console.log("[thread] fork", t.thread_id);
      },
    },
    {
      label: "archive",
      onSelect: () => {
        // TODO: wire to backend — toggle archive/unarchive
        console.log("[thread] archive", t.thread_id);
      },
    },
    {
      label: "export JSON",
      onSelect: () => {
        // TODO: wire to backend
        console.log("[thread] export", t.thread_id);
      },
    },
    {
      label: "delete",
      divider: true,
      danger: true,
      onSelect: () => {
        // TODO: wire to backend
        console.log("[thread] delete", t.thread_id);
      },
    },
  ];

  const selectedIds = Array.from(selected);

  return (
    <AppShell
      active="threads"
      dataLabel="Threads · all conversations"
      hitl={hitlCount > 0 ? ["threads"] : []}
      topBar={
        <AppTopBar
          section="Threads"
          page="All"
          count={threads.length}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>
              Filters <span className="count">· {threads.length}</span>
            </span>
          </div>
          <div className="filter-search">
            <div className="row">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="7" />
                <path d="m20 20-3.5-3.5" />
              </svg>
              <input
                placeholder="filter threads…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {(q || filtered.length !== threads.length) && (
                <span style={{ marginLeft: "auto" }}>
                  <ChipButton>
                    {filtered.length} of {threads.length}
                  </ChipButton>
                </span>
              )}
            </div>
          </div>
          <div className="filter-list">
            <div className="filter-group">
              <div className="gh">
                <span>◗ state</span>
              </div>
              <div
                className={`filter-row${filters.active ? " on" : ""}`}
                onClick={() => toggleFilter("active")}
                style={{ cursor: "pointer" }}
              >
                <span className="cb" />
                <span className="lbl">active</span>
                <span className="count">{threads.length - hitlCount}</span>
              </div>
              {hitlCount > 0 && (
                <div
                  className={`filter-row${filters.needsApproval ? " on" : ""}`}
                  onClick={() => toggleFilter("needsApproval")}
                  style={{ cursor: "pointer" }}
                >
                  <span className="cb" />
                  <span className="swatch" style={{ background: "var(--human)" }} />
                  <span className="lbl">needs approval</span>
                  <span className="count">{hitlCount}</span>
                </div>
              )}
            </div>
            <div className="filter-group">
              <div className="gh">
                <span>◗ contains</span>
              </div>
              <div
                className={`filter-row${filters.webFallback ? " on" : ""}`}
                onClick={() => toggleFilter("webFallback")}
                style={{ cursor: "pointer" }}
              >
                <span className="cb" />
                <span className="swatch" style={{ background: "var(--human)" }} />
                <span className="lbl">web fallback</span>
              </div>
              <div
                className={`filter-row${filters.graphCitations ? " on" : ""}`}
                onClick={() => toggleFilter("graphCitations")}
                style={{ cursor: "pointer" }}
              >
                <span className="cb" />
                <span className="lbl">graph citations</span>
              </div>
            </div>
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Threads</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {threads.length} conversations · {hitlCount} awaiting approval
          </div>
        </div>
        <div className="right">
          <button
            className="send-btn"
            style={{ padding: "4px 12px" }}
            onClick={() => {
              window.location.hash = "";
            }}
          >
            <span>+ new thread</span>
          </button>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 20px 20px" }}>
        {selectedIds.length > 0 && (
          <BulkBar count={selectedIds.length} noun="threads selected">
            <ChipButton onClick={() => archiveThreads(selectedIds)}>
              ⊞ archive
            </ChipButton>
            <ChipButton onClick={() => forkThreads(selectedIds)}>
              ⎘ fork
            </ChipButton>
            <ChipButton onClick={() => exportThreads(selectedIds)}>
              ⤓ export
            </ChipButton>
            <ChipButton
              danger
              onClick={() => deleteThreads(selectedIds)}
            >
              {deleteArmed ? "✕ confirm delete" : "✕ delete"}
            </ChipButton>
            <span className="right">
              <span
                style={{ color: "var(--muted)", cursor: "pointer" }}
                onClick={clearSelection}
              >
                esc to clear
              </span>
            </span>
          </BulkBar>
        )}

        <div className="threads-grid">
          {filtered.map((t, i) => {
            const isSelected = selected.has(t.thread_id);
            return (
              <div
                key={t.thread_id}
                className={`tcard${isSelected ? " selected" : ""}`}
                style={{ position: "relative" }}
                onClick={(e) => {
                  if (e.shiftKey || selectedIds.length > 0) {
                    e.preventDefault();
                    toggleSelect(t.thread_id);
                    return;
                  }
                  window.location.hash = "";
                  window.dispatchEvent(
                    new CustomEvent("sovereign:open-thread", { detail: t.thread_id }),
                  );
                }}
              >
                <div className="tc-head">
                  <span
                    role="checkbox"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSelect(t.thread_id);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === " " || e.key === "Enter") {
                        e.preventDefault();
                        e.stopPropagation();
                        toggleSelect(t.thread_id);
                      }
                    }}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 12,
                      height: 12,
                      border: "1px solid var(--hair-strong)",
                      borderRadius: 2,
                      background: isSelected ? "var(--vector)" : "transparent",
                      color: "#0b0b0b",
                      fontSize: 9,
                      lineHeight: 1,
                      cursor: "pointer",
                    }}
                    title="select thread"
                  >
                    {isSelected ? "✓" : ""}
                  </span>
                  <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                  <span className="ttitle">
                    {q ? highlight(t.title || "untitled", q) : (t.title || "untitled")}
                  </span>
                  {t.paused_at_interrupt && <span className="hitl-ribbon">HITL</span>}
                  <span className="right" style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span className="ago">{t.last_activity ? "live" : "—"}</span>
                    <span
                      onClick={(e) => e.stopPropagation()}
                      style={{ display: "inline-flex" }}
                    >
                      <KebabMenu options={kebabOptions(t)} ariaLabel={`actions for ${t.title || "thread"}`} />
                    </span>
                  </span>
                </div>
                <div className="tc-body">
                  {t.question_count} question{t.question_count === 1 ? "" : "s"} ·{" "}
                  thread {t.thread_id.slice(0, 8)}
                </div>
                <div className="tc-foot">
                  {/* No citation preview in ThreadSummary — emit a default chip set */}
                  {Array.from({ length: Math.min(3, t.question_count) }).map((_, k) => (
                    <CitationChip key={k} n={k + 1} kind="hybrid" />
                  ))}
                  <span className="model">·</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {toast && (
        <Toast kind="ok" autoDismissMs={3000} onClose={() => setToast(null)}>
          {toast}
        </Toast>
      )}
    </AppShell>
  );
}
