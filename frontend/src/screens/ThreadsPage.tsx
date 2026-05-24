// Threads — card grid view of every conversation, wired to useThreads.

import { useMemo, useState } from "react";
import { CitationChip } from "../components/CitationChip";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { useThreads } from "../hooks/useThreads";

export function ThreadsPage() {
  const { threads } = useThreads();
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [q, setQ] = useState("");

  const lowered = q.trim().toLowerCase();
  const filtered = useMemo(
    () => (lowered ? threads.filter((t) => t.title.toLowerCase().includes(lowered)) : threads),
    [threads, lowered],
  );

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;
  const hitlCount = threads.filter((t) => t.paused_at_interrupt).length;

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
            </div>
          </div>
          <div className="filter-list">
            <div className="filter-group">
              <div className="gh">
                <span>◗ state</span>
              </div>
              <div className="filter-row on">
                <span className="cb" />
                <span className="lbl">active</span>
                <span className="count">{threads.length - hitlCount}</span>
              </div>
              {hitlCount > 0 && (
                <div className="filter-row on">
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
              <div className="filter-row">
                <span className="cb" />
                <span className="swatch" style={{ background: "var(--human)" }} />
                <span className="lbl">web fallback</span>
              </div>
              <div className="filter-row">
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
        <div className="threads-grid">
          {filtered.map((t, i) => (
            <div
              key={t.thread_id}
              className="tcard"
              onClick={() => {
                window.location.hash = "";
                window.dispatchEvent(
                  new CustomEvent("sovereign:open-thread", { detail: t.thread_id }),
                );
              }}
            >
              <div className="tc-head">
                <span className="idx">{String(i + 1).padStart(2, "0")}</span>
                <span className="ttitle">{t.title || "untitled"}</span>
                {t.paused_at_interrupt && <span className="hitl-ribbon">HITL</span>}
                <span className="ago">{t.last_activity ? "live" : "—"}</span>
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
          ))}
        </div>
      </div>
    </AppShell>
  );
}
