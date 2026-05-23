import type { ThreadSummary } from "../lib/types";

interface Props {
  threads: ThreadSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
}

export function ThreadsRail({ threads, activeId, onSelect, onNew }: Props) {
  return (
    <aside className="threads">
      <div className="rail-head">
        <span>
          Threads <span className="count">· {threads.length}</span>
        </span>
        <span className="add" onClick={onNew}>
          + NEW
        </span>
      </div>
      <div className="thread-search">
        <div className="row">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input placeholder="filter threads…" />
          <span style={{ fontSize: "10px", color: "var(--dim)" }}>⌘K</span>
        </div>
      </div>
      <div className="thread-list">
        {threads.map((t, i) => {
          const active = t.thread_id === activeId;
          const cls = active ? "thread-row active" : "thread-row";
          const idx = String(i + 1).padStart(2, "0");
          return (
            <div key={t.thread_id} className={cls} onClick={() => onSelect(t.thread_id)}>
              <div className="idx">{idx}</div>
              <div>
                <div className="title">
                  {t.title || "untitled"}
                  {active && <span className="badge-active" />}
                </div>
                <div className="meta">
                  <span>
                    {t.question_count} <span className="sep">·</span> q
                  </span>
                  <span className="sep">/</span>
                  <span>{t.last_activity}</span>
                </div>
                {t.paused_at_interrupt && (
                  <span className="badge-hitl">needs approval</span>
                )}
              </div>
            </div>
          );
        })}
        {threads.length === 0 && (
          <div
            style={{
              padding: "20px 14px",
              color: "var(--dim)",
              fontSize: "10.5px",
              fontStyle: "italic",
            }}
          >
            no threads yet — ask something to start.
          </div>
        )}
      </div>
      <div className="rail-foot">
        <span>
          <span className="k">checkpointer</span> postgres
        </span>
        <span>
          <span className="k">sync</span> · live
        </span>
      </div>
    </aside>
  );
}
