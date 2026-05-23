// Context manager — drawer-right showing what's actually in the
// LangGraph thread's window.
//
// Backed by three live sources:
//   - /api/threads/{id}/context → user-pinned + user-excluded chunks
//   - the active turn's `.citations` → this-turn chunks
//   - client.threads.getHistory(threadId) → postgres checkpoint timeline
//
// All four buttons in the row actions (pin, exclude, view, revert) call
// real endpoints. Context-window meter computes its values from the
// turn texts + citation snippet lengths; the token budget shown alongside
// is the live `llm_num_ctx` value from /api/settings.

import { useEffect, useMemo, useState } from "react";
import { CitationChip } from "../components/CitationChip";
import type { useThreadContext } from "../hooks/useCorpus";
import { client } from "../lib/langgraph";
import type { Citation, CitationKind, Turn } from "../lib/types";

interface CheckpointRow {
  checkpoint_id: string;
  label: string;
  sub: string;
  current: boolean;
}

interface Props {
  threadId: string | null;
  turns: Turn[];
  contextWindow: number;
  /** Shared thread-context hook from the parent. Lifting the hook means the
   * drawer's pinned/excluded chips and this panel stay in sync when either
   * side mutates. */
  threadCtx: ReturnType<typeof useThreadContext>;
  onClose: () => void;
  onRevertCheckpoint?: (checkpointId: string) => void;
}

const PINNED_ROW_LABEL = (kind: CitationKind | undefined): string =>
  kind ?? "vector";

function kindOfCitation(c: Citation | undefined): CitationKind {
  if (!c) return "vector";
  if (c.kind) return c.kind;
  return c.source_uri.startsWith("http") ? "web" : "vector";
}

// Cheap heuristic — 1 token ≈ 4 chars of English. Good enough for a meter
// that's just signalling headroom. The real tokenizer count would require a
// round-trip to /api/tokenize which we don't ship yet.
function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

function fmtTs(ms: number | string): string {
  const d = typeof ms === "string" ? new Date(ms) : new Date(ms);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function ContextManager({
  threadId,
  turns,
  contextWindow,
  threadCtx,
  onClose,
  onRevertCheckpoint,
}: Props) {
  const ctx = threadCtx;

  // Build a fast lookup of every chunk we've seen in the thread by chunk_id.
  // The Pinned list relies on this to display the chunk's title + kind even
  // though the /api/threads/{id}/context endpoint only stores chunk_ids.
  const chunkIndex = useMemo(() => {
    const idx = new Map<string, Citation>();
    for (const t of turns) {
      for (const c of t.citations ?? []) {
        if (c.chunk_id) idx.set(c.chunk_id, c);
      }
    }
    return idx;
  }, [turns]);

  const pinnedIds = new Set(
    (ctx.data?.pins ?? []).filter((p) => p.action === "pinned").map((p) => p.chunk_id),
  );
  const excludedIds = new Set(
    (ctx.data?.pins ?? []).filter((p) => p.action === "excluded").map((p) => p.chunk_id),
  );

  // Pinned chunks come from ctx.data; we look up the full citation in our
  // local index. Anything pinned without a corresponding citation in the
  // current turns is still listed with a stub label.
  const pinnedItems = useMemo(
    () =>
      (ctx.data?.pins ?? [])
        .filter((p) => p.action === "pinned")
        .map((p, i) => {
          const cit = chunkIndex.get(p.chunk_id);
          return {
            num: String(i + 1).padStart(2, "0"),
            chunk_id: p.chunk_id,
            kind: kindOfCitation(cit),
            title: cit?.title ?? `(pinned chunk ${p.chunk_id.slice(0, 8)})`,
            snip: cit?.snippet ? `"${cit.snippet}"` : "—",
            tokens: estimateTokens(cit?.snippet ?? ""),
            meta: cit ? `chunk ${cit.chunk_id.slice(0, 8)} · score ${cit.score.toFixed(3)}` : "—",
            cite: 0,
          };
        }),
    [ctx.data?.pins, chunkIndex],
  );

  // This-turn chunks: the citations on the most recent assistant turn that
  // actually has a content body (skip placeholder streaming turns).
  const lastAssistant = [...turns]
    .reverse()
    .find((t) => t.role === "assistant" && (t.citations?.length ?? 0) > 0);
  const turnItems = useMemo(() => {
    const cits = lastAssistant?.citations ?? [];
    return cits.map((c, i) => ({
      num: String(i + 1 + pinnedItems.length).padStart(2, "0"),
      chunk_id: c.chunk_id,
      kind: kindOfCitation(c),
      title: c.title,
      snip: c.snippet ? `"${c.snippet}"` : "—",
      tokens: estimateTokens(c.snippet ?? ""),
      meta: `rerank ${c.score.toFixed(3)}${lastAssistant?.fallback_used ? " · web fallback" : ""}`,
      cite: i + 1,
      pinned: pinnedIds.has(c.chunk_id),
      excluded: excludedIds.has(c.chunk_id),
    }));
  }, [lastAssistant, pinnedItems.length, pinnedIds, excludedIds]);

  // Checkpoints from the LangGraph SDK.
  const [checkpoints, setCheckpoints] = useState<CheckpointRow[]>([]);
  const [checkpointsErr, setCheckpointsErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!threadId) {
      setCheckpoints([]);
      return () => {
        cancelled = true;
      };
    }
    client.threads
      .getHistory(threadId, { limit: 20 })
      .then((history) => {
        if (cancelled) return;
        // History is newest-first; flip so the timeline reads top→bottom = old→new.
        const rows = [...history].reverse();
        const last = rows[rows.length - 1];
        const out: CheckpointRow[] = rows.map((r, _i) => {
          const checkpoint = r as {
            checkpoint_id?: string;
            checkpoint?: { checkpoint_id?: string };
            created_at?: string;
            values?: { question?: string; used?: number; fallback_used?: boolean };
            metadata?: { step?: number };
          };
          const cpId =
            checkpoint.checkpoint?.checkpoint_id ??
            checkpoint.checkpoint_id ??
            String(checkpoint.metadata?.step ?? "?");
          const ts = checkpoint.created_at ? fmtTs(checkpoint.created_at) : "—";
          const step = checkpoint.metadata?.step ?? "?";
          const q = checkpoint.values?.question?.slice(0, 32);
          const fallback = checkpoint.values?.fallback_used ? " · web fallback" : "";
          return {
            checkpoint_id: cpId,
            label: q ? `Step ${step} · ${q}…` : `Step ${step}`,
            sub: `${ts}${fallback}`,
            current: r === last,
          };
        });
        setCheckpoints(out);
        setCheckpointsErr(null);
      })
      .catch((err) => {
        if (!cancelled) {
          setCheckpointsErr(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [threadId]);

  // Context-meter math. We split the live token budget across three buckets:
  //   - system    (estimated from a fixed system prompt — ~100 tokens)
  //   - turns     (user+assistant texts)
  //   - chunks    (cited snippets from this turn)
  // Tools is 0 today (no tool calls in this graph). Everything else is headroom.
  const systemTokens = 100;
  const turnTokens = turns.reduce((s, t) => s + estimateTokens(t.content), 0);
  const chunkTokens = (lastAssistant?.citations ?? []).reduce(
    (s, c) => s + estimateTokens(c.snippet ?? ""),
    0,
  );
  const usedTokens = systemTokens + turnTokens + chunkTokens;
  const usedPct = Math.min(100, (usedTokens / contextWindow) * 100);
  const sysPct = (systemTokens / contextWindow) * 100;
  const turnsPct = (turnTokens / contextWindow) * 100;
  const chunksPct = (chunkTokens / contextWindow) * 100;
  const headroomPct = 100 - usedPct;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer-right" style={{ width: "560px" }}>
        <div className="drawer-head">
          <span className="lab">◗ context</span>
          <span className="title">What's in the window</span>
          <span
            style={{
              marginLeft: "auto",
              fontFamily: "var(--font-mono)",
              fontSize: "10.5px",
              color: "var(--muted)",
            }}
          >
            thread <span style={{ color: "var(--text-dim)" }}>{threadId?.slice(0, 8) ?? "—"}</span>
          </span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="context-meter">
            <div className="top">
              <span className="total">{usedTokens.toLocaleString()}</span>
              <span className="cap">/ {contextWindow.toLocaleString()} tok</span>
              <span className="pct">
                {usedPct.toFixed(1)}% used · headroom {headroomPct.toFixed(1)}%
              </span>
            </div>
            <div className="bar">
              <span className="seg sys" style={{ width: `${sysPct}%` }} />
              <span className="seg turns" style={{ width: `${turnsPct}%` }} />
              <span className="seg chunks" style={{ width: `${chunksPct}%` }} />
              <span className="seg budget" style={{ flex: 1 }} />
            </div>
            <div className="legend">
              <span className="key">
                <span className="sw" style={{ background: "var(--muted)" }} /> system{" "}
                <span className="v">{systemTokens}</span>
              </span>
              <span className="key">
                <span className="sw" style={{ background: "var(--text-dim)" }} /> turns ·{" "}
                {turns.length} <span className="v">{turnTokens.toLocaleString()}</span>
              </span>
              <span className="key">
                <span className="sw" style={{ background: "var(--vector)" }} /> chunks ·{" "}
                {lastAssistant?.citations?.length ?? 0}{" "}
                <span className="v">{chunkTokens.toLocaleString()}</span>
              </span>
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ pinned chunks <span className="count">· {pinnedItems.length}</span>{" "}
              <span className="right" style={{ color: "var(--text-dim)" }}>
                survive summarisation
              </span>
            </div>
            {pinnedItems.length === 0 ? (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "11px",
                  fontStyle: "italic",
                  padding: "6px 0",
                }}
              >
                Pin a chunk from "this turn's chunks" below — it'll survive when older turns get
                summarised.
              </div>
            ) : (
              pinnedItems.map((p) => (
                <div key={p.chunk_id} className="ctx-item pinned">
                  <span className="num">{p.num}</span>
                  <div className="body">
                    <div className="title">
                      <CitationChip n={p.cite} kind={PINNED_ROW_LABEL(p.kind) as CitationKind} />{" "}
                      {p.title}
                    </div>
                    <div className="snip">{p.snip}</div>
                    <div className="meta">
                      <span className="k">tok</span>
                      <span className="v">{p.tokens}</span>
                      <span className="k">·</span>
                      <span>{p.meta}</span>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className="act on"
                      title="Unpin"
                      onClick={() => ctx.unpin(p.chunk_id)}
                    >
                      ●
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ this turn's chunks <span className="count">· {turnItems.length}</span>{" "}
              <span className="right" style={{ color: "var(--muted)" }}>
                evicted on next turn
              </span>
            </div>
            {turnItems.length === 0 ? (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "11px",
                  fontStyle: "italic",
                  padding: "6px 0",
                }}
              >
                No chunks cited in the latest assistant turn yet.
              </div>
            ) : (
              turnItems.map((t) => (
                <div
                  key={t.chunk_id}
                  className={`ctx-item ${t.excluded ? "excluded" : ""} ${t.pinned ? "pinned" : ""}`}
                >
                  <span className="num">{t.num}</span>
                  <div className="body">
                    <div className="title">
                      <CitationChip n={t.cite} kind={t.kind} /> {t.title}
                    </div>
                    <div className="snip">{t.snip}</div>
                    <div className="meta">
                      <span className="k">tok</span>
                      <span className="v">{t.tokens}</span>
                      <span className="k">·</span>
                      <span style={{ color: t.excluded ? "var(--err)" : undefined }}>
                        {t.excluded ? "excluded from next turn" : t.meta}
                      </span>
                    </div>
                  </div>
                  <div className="actions">
                    <button
                      className={`act ${t.pinned ? "on" : ""}`}
                      title={t.pinned ? "Unpin" : "Pin"}
                      onClick={() =>
                        t.pinned ? ctx.unpin(t.chunk_id) : ctx.pin(t.chunk_id, "pinned")
                      }
                    >
                      ⌖
                    </button>
                    <button
                      className={`act ${t.excluded ? "excl" : ""}`}
                      title={t.excluded ? "Stop excluding" : "Exclude"}
                      onClick={() =>
                        t.excluded ? ctx.unpin(t.chunk_id) : ctx.pin(t.chunk_id, "excluded")
                      }
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ checkpoints <span className="count">· {checkpoints.length}</span>{" "}
              <span className="right" style={{ color: "var(--text-dim)" }}>
                postgres
              </span>
            </div>
            {checkpointsErr && (
              <div
                style={{
                  color: "var(--err)",
                  fontSize: "10.5px",
                  fontStyle: "italic",
                  padding: "4px 0",
                }}
              >
                couldn't load checkpoints — {checkpointsErr}
              </div>
            )}
            {!checkpointsErr && checkpoints.length === 0 && (
              <div
                style={{
                  color: "var(--muted)",
                  fontSize: "11px",
                  fontStyle: "italic",
                  padding: "6px 0",
                }}
              >
                No checkpoints recorded yet.
              </div>
            )}
            {checkpoints.map((c) => (
              <div key={c.checkpoint_id} className={`checkpoint ${c.current ? "current" : ""}`}>
                <span className="dot" />
                <div className="info">
                  <div
                    className="label"
                    style={c.current ? { color: "var(--vector)" } : undefined}
                  >
                    {c.label}
                  </div>
                  <div className="sub">{c.sub}</div>
                </div>
                <button
                  className="revert"
                  onClick={() => onRevertCheckpoint?.(c.checkpoint_id)}
                  disabled={c.current}
                >
                  {c.current ? "stay" : "revert"}
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="drawer-foot">
          <span className="scope">
            auto-summarise at <span style={{ color: "var(--text)" }}>85%</span>
          </span>
          <span style={{ color: "var(--dim)" }}>·</span>
          <span className="scope">
            strategy <span style={{ color: "var(--text)" }}>compress turns, keep pins</span>
          </span>
          <div className="right">
            <button
              className="btn ghost"
              type="button"
              onClick={() => ctx.clear()}
              disabled={(ctx.data?.pins ?? []).length === 0}
            >
              clear all pins
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
