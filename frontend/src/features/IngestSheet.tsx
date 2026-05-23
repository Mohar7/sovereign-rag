// Ingest sheet — modal over the Ask screen with three modes:
//   - url   paste a URL → POST /api/ingest (Crawl4AI render)
//   - text  paste raw text → POST /api/ingest (synthesised SourceDocument)
//   - web   run a SearXNG search → multi-select results → ingest each
//
// On success it closes itself and calls onIndexed so the caller can
// refresh corpus stats / surface a toast.

import { useState } from "react";
import { Segmented } from "../components/controls/Segmented";
import { api, type WebSearchHit } from "../lib/api";

type Mode = "url" | "text" | "web";

interface Props {
  initialMode?: Mode;
  onClose: () => void;
  /** Called once per successfully indexed document. */
  onIndexed?: (doc: { doc_id: string; title: string; chunks_indexed: number }) => void;
}

export function IngestSheet({ initialMode = "url", onClose, onIndexed }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<WebSearchHit[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);

  const ingestOne = async (type: "url" | "text", v: string, titleOverride?: string) => {
    setBusy(true);
    setErr(null);
    try {
      const out = await api.ingest({
        type,
        value: v,
        title: titleOverride || title || undefined,
      });
      onIndexed?.(out);
      return out;
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
      throw e;
    } finally {
      setBusy(false);
    }
  };

  const submitText = async () => {
    if (!value.trim()) return;
    try {
      await ingestOne(mode === "url" ? "url" : "text", value);
      onClose();
    } catch {
      // Error surfaced via state; keep the sheet open so the user can retry.
    }
  };

  const runSearch = async () => {
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const hits = await api.searchWeb(value, 10);
      setResults(hits);
      setSelected(new Set());
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const ingestSelected = async () => {
    if (selected.size === 0) return;
    setBusy(true);
    setErr(null);
    let done = 0;
    const total = selected.size;
    try {
      for (const url of selected) {
        setProgress(`Ingesting ${done + 1}/${total} — ${url.slice(0, 40)}…`);
        const hit = results.find((r) => r.url === url);
        await api.ingest({ type: "url", value: url, title: hit?.title });
        done++;
        onIndexed?.({
          doc_id: url,
          title: hit?.title ?? url,
          chunks_indexed: 0,
        });
      }
      setProgress(`Indexed ${done}/${total}.`);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const toggle = (url: string) => {
    setSelected((curr) => {
      const next = new Set(curr);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  return (
    <>
      <div className="scrim" onClick={busy ? undefined : onClose} />
      <div className="drawer-right" style={{ width: "640px" }}>
        <div className="drawer-head">
          <span className="lab">◗ ingest</span>
          <span className="title">Add to corpus</span>
          <button className="close" onClick={onClose} aria-label="Close" disabled={busy}>
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="drawer-section">
            <Segmented
              options={["url", "text", "web"] as const}
              active={mode}
              onChange={(m) => {
                setMode(m);
                setResults([]);
                setSelected(new Set());
                setErr(null);
              }}
            />
          </div>

          {mode !== "web" && (
            <div className="drawer-section">
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  color: "var(--muted)",
                  marginBottom: "8px",
                }}
              >
                {mode === "url"
                  ? "Paste a URL. Crawl4AI renders the page; we extract markdown, chunk, embed, and index."
                  : "Paste raw text or markdown. It's hashed for deterministic doc_id (re-paste = update in place)."}
              </div>
              {mode === "url" ? (
                <input
                  type="url"
                  value={value}
                  placeholder="https://example.com/page-to-ingest"
                  onChange={(e) => setValue(e.target.value)}
                  disabled={busy}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--hair)",
                    background: "var(--surface-1)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                  }}
                />
              ) : (
                <textarea
                  value={value}
                  placeholder="Paste markdown / text here…"
                  onChange={(e) => setValue(e.target.value)}
                  disabled={busy}
                  rows={10}
                  style={{
                    width: "100%",
                    padding: "10px 12px",
                    border: "1px solid var(--hair)",
                    background: "var(--surface-1)",
                    color: "var(--text)",
                    fontFamily: "var(--font-mono)",
                    fontSize: "12px",
                  }}
                />
              )}
              <input
                type="text"
                value={title}
                placeholder="optional title"
                onChange={(e) => setTitle(e.target.value)}
                disabled={busy}
                style={{
                  width: "100%",
                  marginTop: "8px",
                  padding: "8px 12px",
                  border: "1px solid var(--hair)",
                  background: "var(--surface-1)",
                  color: "var(--text)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                }}
              />
            </div>
          )}

          {mode === "web" && (
            <>
              <div className="drawer-section">
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "11px",
                    color: "var(--muted)",
                    marginBottom: "8px",
                  }}
                >
                  SearXNG-backed web search (ddgs fallback). Pick the pages you
                  want crawled and indexed.
                </div>
                <div style={{ display: "flex", gap: "6px" }}>
                  <input
                    type="text"
                    value={value}
                    placeholder="search query"
                    onChange={(e) => setValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void runSearch();
                    }}
                    disabled={busy}
                    style={{
                      flex: 1,
                      padding: "10px 12px",
                      border: "1px solid var(--hair)",
                      background: "var(--surface-1)",
                      color: "var(--text)",
                      fontFamily: "var(--font-mono)",
                      fontSize: "12px",
                    }}
                  />
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={busy || !value.trim()}
                    onClick={() => void runSearch()}
                  >
                    search
                  </button>
                </div>
              </div>

              {results.length > 0 && (
                <div className="drawer-section">
                  <div className="h">
                    ◗ results <span className="count">· {results.length}</span>{" "}
                    <span className="right" style={{ color: "var(--muted)" }}>
                      {selected.size} selected
                    </span>
                  </div>
                  {results.map((r) => (
                    <label
                      key={r.url}
                      style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "10px",
                        padding: "8px",
                        border: "1px solid var(--hair)",
                        marginBottom: "6px",
                        background: selected.has(r.url) ? "var(--surface-2)" : "var(--surface-1)",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.has(r.url)}
                        onChange={() => toggle(r.url)}
                        disabled={busy}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: "12px",
                            color: "var(--text)",
                            fontWeight: 500,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.title}
                        </div>
                        <div
                          style={{
                            fontSize: "10.5px",
                            color: "var(--muted)",
                            fontFamily: "var(--font-mono)",
                            marginTop: "2px",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.url}
                        </div>
                        {r.snippet && (
                          <div
                            style={{
                              fontSize: "11px",
                              color: "var(--text-dim)",
                              marginTop: "4px",
                              lineHeight: 1.5,
                            }}
                          >
                            {r.snippet}
                          </div>
                        )}
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}

          {progress && (
            <div
              style={{
                margin: "12px 0",
                padding: "8px 12px",
                background: "var(--surface-2)",
                color: "var(--text-dim)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}
            >
              {progress}
            </div>
          )}
          {err && (
            <div
              style={{
                margin: "12px 0",
                padding: "8px 12px",
                background: "var(--err-bg, rgba(255,80,80,0.08))",
                border: "1px solid var(--err, #ff5050)",
                color: "var(--err, #ff5050)",
                fontFamily: "var(--font-mono)",
                fontSize: "11px",
              }}
            >
              {err}
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <span className="scope">
            target ·{" "}
            <span style={{ color: "var(--text)" }}>milvus + neo4j</span>
          </span>
          <div className="right">
            <button className="btn ghost" type="button" onClick={onClose} disabled={busy}>
              cancel
            </button>
            {mode === "web" ? (
              <button
                className="btn warm"
                type="button"
                style={{ background: "var(--vector)", color: "#0a0612" }}
                disabled={busy || selected.size === 0}
                onClick={() => void ingestSelected()}
              >
                {busy ? "ingesting…" : `ingest ${selected.size || ""}`}
              </button>
            ) : (
              <button
                className="btn warm"
                type="button"
                style={{ background: "var(--vector)", color: "#0a0612" }}
                disabled={busy || !value.trim()}
                onClick={() => void submitText()}
              >
                {busy ? "ingesting…" : "ingest"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
