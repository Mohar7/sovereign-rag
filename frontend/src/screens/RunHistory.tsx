// Run history — audit log of every Q&A. Threads are the unit of accounting;
// each turn within a thread is one row. Pulled live via the LangGraph SDK's
// thread history endpoint plus our /lg/threads/search proxy.

import { useEffect, useMemo, useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { client } from "../lib/langgraph";
import { useThreads } from "../hooks/useThreads";

interface HistoryRow {
  thread_id: string;
  title: string;
  step: number;
  created_at: string;
  fallback_used: boolean;
  used: number;
}

export function RunHistory() {
  const { threads } = useThreads();
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (threads.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const sample = threads.slice(0, 20);
    Promise.allSettled(
      sample.map(async (t) => {
        const hist = await client.threads.getHistory(t.thread_id, { limit: 10 });
        return { t, hist };
      }),
    )
      .then((results) => {
        if (cancelled) return;
        const out: HistoryRow[] = [];
        for (const r of results) {
          if (r.status !== "fulfilled") continue;
          const { t, hist } = r.value;
          for (const cp of hist) {
            const c = cp as {
              created_at?: string;
              values?: { used?: number; fallback_used?: boolean };
              metadata?: { step?: number };
            };
            if ((c.metadata?.step ?? -1) < 0) continue;
            out.push({
              thread_id: t.thread_id,
              title: t.title,
              step: c.metadata?.step ?? 0,
              created_at: c.created_at ?? "",
              fallback_used: !!c.values?.fallback_used,
              used: c.values?.used ?? 0,
            });
          }
        }
        out.sort((a, b) => b.created_at.localeCompare(a.created_at));
        setRows(out);
        setErr(null);
      })
      .catch((e: unknown) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threads]);

  const healthMap = useMemo(
    () =>
      health
        ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
        : null,
    [health],
  );

  return (
    <AppShell
      active="history"
      dataLabel="History · audit log"
      topBar={
        <AppTopBar
          section="History"
          page="Audit log"
          count={rows.length}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>Filters</span>
          </div>
          <div className="filter-list">
            <div className="filter-group">
              <div className="gh">
                <span>◗ verdict</span>
              </div>
              <div className="filter-row on">
                <span className="cb" />
                <span className="lbl">all runs</span>
                <span className="count">{rows.length}</span>
              </div>
            </div>
            <div className="filter-group">
              <div className="gh">
                <span>◗ fallback</span>
              </div>
              <div className="filter-row on">
                <span className="cb" />
                <span className="swatch" style={{ background: "var(--human)" }} />
                <span className="lbl">used web fallback</span>
                <span className="count">{rows.filter((r) => r.fallback_used).length}</span>
              </div>
            </div>
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Run history</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {loading ? "loading…" : `${rows.length} runs across ${threads.length} threads`}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto" }}>
        {err && (
          <div style={{ padding: 14, color: "var(--err)", fontSize: 11 }}>{err}</div>
        )}
        <table className="dtable">
          <thead>
            <tr>
              <th>Thread</th>
              <th className="num">Step</th>
              <th>When</th>
              <th>Fallback</th>
              <th className="num">Used chunks</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={`${r.thread_id}-${r.step}-${i}`}
                onClick={() => {
                  window.location.hash = "";
                  window.dispatchEvent(
                    new CustomEvent("sovereign:open-thread", { detail: r.thread_id }),
                  );
                }}
              >
                <td className="title">
                  {r.title || "(untitled)"}
                  <span className="sub">{r.thread_id.slice(0, 8)}</span>
                </td>
                <td className="num">{r.step}</td>
                <td className="dim">{r.created_at ? new Date(r.created_at).toLocaleString() : "—"}</td>
                <td>
                  {r.fallback_used ? (
                    <span className="status-pill" style={{ color: "var(--human)" }}>
                      web
                    </span>
                  ) : (
                    <span className="dim">—</span>
                  )}
                </td>
                <td className="num">{r.used || "—"}</td>
                <td style={{ color: "var(--muted)", textAlign: "right" }}>›</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </AppShell>
  );
}
