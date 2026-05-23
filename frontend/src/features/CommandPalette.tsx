// ⌘K command palette — modal overlay with three sections:
//   - Threads     (filter against the live threads list)
//   - Documents   (filter via /api/documents/search, debounced)
//   - Actions     (open settings, re-run last query, ingest URL, …)
//
// Selecting a thread jumps to it; selecting a document opens the source
// drawer (TODO); selecting an action fires its handler.

import { useEffect, useState } from "react";
import { api, type DocumentSummary } from "../lib/api";
import type { ThreadSummary } from "../lib/types";

interface Action {
  ic: string;
  label: string;
  sub?: string;
  kbd: string;
  onSelect: () => void;
}

interface Props {
  threads: ThreadSummary[];
  onSelectThread: (id: string) => void;
  onOpenSettings: () => void;
  onClose: () => void;
  /** Seed the search box on mount — e.g. when the SourceDetailDrawer's
   * "open in library" button routes here with a doc title prefilled. */
  initialQuery?: string;
}

export function CommandPalette({
  threads,
  onSelectThread,
  onOpenSettings,
  onClose,
  initialQuery = "",
}: Props) {
  const [q, setQ] = useState(initialQuery);
  const [activeIdx, setActiveIdx] = useState(0);

  // Filtered set across sections — single flat list for keyboard nav.
  const lowered = q.trim().toLowerCase();
  const matchingThreads = (lowered
    ? threads.filter((t) => t.title.toLowerCase().includes(lowered))
    : threads
  ).slice(0, 5);

  // Live documents from /api/documents/search, debounced 200ms.
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    const id = window.setTimeout(() => {
      api
        .documentsSearch(lowered, 6)
        .then((r) => {
          if (!cancelled) setDocs(r);
        })
        .catch(() => {
          if (!cancelled) setDocs([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [lowered]);

  const iconFor = (uri: string) => {
    if (uri.startsWith("http")) return "🌐";
    if (uri.includes(".pdf")) return "📄";
    return "∽";
  };

  const actions: Action[] = [
    {
      ic: "↻",
      label: "Re-run last query with k_rerank = 10",
      sub: "current thread",
      kbd: "⌘R",
      onSelect: onClose,
    },
    {
      ic: "⚙",
      label: "Open retrieval settings",
      sub: "scope: this thread",
      kbd: "⌘,",
      onSelect: () => {
        onClose();
        onOpenSettings();
      },
    },
    {
      ic: "⊕",
      label: "Ingest URL or file",
      sub: "append to corpus",
      kbd: "⌘⇧O",
      onSelect: onClose,
    },
  ];

  type Row =
    | { kind: "thread"; t: ThreadSummary }
    | { kind: "doc"; d: DocumentSummary }
    | { kind: "action"; a: Action };
  const rows: Row[] = [
    ...matchingThreads.map((t) => ({ kind: "thread" as const, t })),
    ...docs.map((d) => ({ kind: "doc" as const, d })),
    ...actions.map((a) => ({ kind: "action" as const, a })),
  ];

  const activate = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "thread") {
      onSelectThread(row.t.thread_id);
      onClose();
    } else if (row.kind === "action") {
      row.a.onSelect();
    } else {
      // doc click — no-op until /documents endpoint
      onClose();
    }
  };

  // Keyboard nav + close. We capture at the window level so the
  // palette responds even when the textbox isn't the active element.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, rows.length - 1)));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === "Enter") {
        e.preventDefault();
        activate(activeIdx);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIdx, rows.length]);

  let i = -1;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="palette" role="dialog" aria-label="Command palette">
        <div className="palette-input">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            type="text"
            autoFocus
            placeholder="jump · ask · ingest · settings"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setActiveIdx(0);
            }}
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--text)",
              fontFamily: "var(--font-mono)",
              fontSize: "13px",
              padding: 0,
            }}
          />
          <span className="badge">⌘K</span>
        </div>

        {matchingThreads.length > 0 && (
          <>
            <div className="palette-section">
              Threads <span className="count">· {matchingThreads.length} match{matchingThreads.length === 1 ? "" : "es"}</span>
            </div>
            {matchingThreads.map((t) => {
              i += 1;
              const idx = i;
              const isActive = idx === activeIdx;
              return (
                <div
                  key={t.thread_id}
                  className={`palette-row ${isActive ? "active" : ""}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => activate(idx)}
                >
                  <span className="ic thread">①</span>
                  <span>
                    <span className="lab">
                      {t.title || "untitled"}{" "}
                      <span className="sub">
                        — {t.question_count} question{t.question_count === 1 ? "" : "s"} ·{" "}
                        {t.last_activity}
                      </span>
                    </span>
                  </span>
                  <span className="kbd">↵</span>
                </div>
              );
            })}
          </>
        )}

        {docs.length > 0 && (
          <>
            <div className="palette-section">
              Documents <span className="count">· {docs.length} match{docs.length === 1 ? "" : "es"}</span>
            </div>
            {docs.map((d) => {
              i += 1;
              const idx = i;
              const isActive = idx === activeIdx;
              return (
                <div
                  key={d.doc_id}
                  className={`palette-row ${isActive ? "active" : ""}`}
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => activate(idx)}
                >
                  <span className="ic doc">{iconFor(d.source_uri)}</span>
                  <span>
                    <span className="lab">
                      {d.title || "untitled"}{" "}
                      <span className="sub">
                        — {d.chunks} chunk{d.chunks === 1 ? "" : "s"} ·{" "}
                        {d.source_uri.length > 40
                          ? d.source_uri.slice(0, 40) + "…"
                          : d.source_uri}
                      </span>
                    </span>
                  </span>
                  <span className="kbd">↗</span>
                </div>
              );
            })}
          </>
        )}

        <div className="palette-section">Actions</div>
        {actions.map((a) => {
          i += 1;
          const idx = i;
          const isActive = idx === activeIdx;
          return (
            <div
              key={a.label}
              className={`palette-row ${isActive ? "active" : ""}`}
              onMouseEnter={() => setActiveIdx(idx)}
              onClick={() => activate(idx)}
            >
              <span className="ic act">{a.ic}</span>
              <span>
                <span className="lab">
                  {a.label}
                  {a.sub && <span className="sub"> — {a.sub}</span>}
                </span>
              </span>
              <span className="kbd">{a.kbd}</span>
            </div>
          );
        })}

        <div className="palette-foot">
          <span className="hint">
            <span className="kbd">↑↓</span> navigate
          </span>
          <span className="hint">
            <span className="kbd">↵</span> open
          </span>
          <span className="hint">
            <span className="kbd">esc</span> close
          </span>
          <span style={{ marginLeft: "auto" }}>
            {rows.length} result{rows.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </>
  );
}
