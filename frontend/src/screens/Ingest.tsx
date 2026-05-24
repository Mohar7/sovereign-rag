// Ingest — full page version of the existing IngestSheet feature.
//
// The drawer-style IngestSheet handles drop-in ingestion from the Empty
// state and the WEB suggestion card. This page is the dedicated screen,
// reachable from the primary nav, with the same backend wiring plus the
// recent-jobs rail + live pipeline view from the design.
//
// Backend endpoints in play:
//   POST /api/ingest       (url / text)
//   GET  /api/search       (web)
// Job history is in-memory for now — a future /api/ingest/history would
// replace the demo entries while leaving the UI shape unchanged.

import { useState } from "react";
import { Slider } from "../components/controls/Slider";
import { Toggle } from "../components/controls/Toggle";
import { Segmented } from "../components/controls/Segmented";
import { PillSelect } from "../components/controls/PillSelect";
import { NumInput } from "../components/controls/NumInput";
import { KnobRow } from "../components/controls/KnobRow";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";
import { api, type IngestResponse } from "../lib/api";

interface JobEntry {
  i: string;
  title: string;
  state: "done" | "live" | "hitl" | "failed";
  meta: string;
}

const SEED_JOBS: JobEntry[] = [
  { i: "01", title: "rrf-paper.pdf", state: "done", meta: "18 chunks · 1h ago" },
  { i: "02", title: "trec-dl-2023.pdf", state: "done", meta: "12 chunks · yesterday" },
  { i: "03", title: "FERRET · 2 urls (pending)", state: "hitl", meta: "awaiting approval" },
  { i: "04", title: "broken-link.pdf", state: "failed", meta: "parse error · ECONNRESET" },
];

export function Ingest() {
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [mode, setMode] = useState<"drop" | "url" | "text" | "web">("url");
  const [value, setValue] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [jobs, setJobs] = useState<JobEntry[]>(SEED_JOBS);
  const [pipeline, setPipeline] = useState<
    Array<{ name: string; sub: string; state: "" | "live" | "done"; right: string }>
  >([
    { name: "parse", sub: "docling · pdf → markdown", state: "", right: "—" },
    { name: "chunk", sub: "structure-aware · target 512 tok", state: "", right: "—" },
    { name: "embed", sub: "bge-m3 · 1024d", state: "", right: "—" },
    { name: "extract entities", sub: "→ neo4j · spaCy NER + LLM relation pass", state: "", right: "—" },
    { name: "commit", sub: "milvus + neo4j + postgres · transactional", state: "", right: "—" },
  ]);

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  const runIngest = async () => {
    if (mode === "drop" || mode === "web") {
      // The drop / web modes are handled by the modal IngestSheet today;
      // a full-page version would need a file picker + paginated web search.
      setErr("Drop and Web modes are wired via the ⌘O / WEB suggestion sheet for now.");
      return;
    }
    if (!value.trim()) return;
    setBusy(true);
    setErr(null);
    setPipeline((curr) => curr.map((s, i) => ({ ...s, state: i === 0 ? "live" : "" })));
    try {
      const out: IngestResponse = await api.ingest({
        type: mode === "url" ? "url" : "text",
        value,
        title: title || undefined,
      });
      setPipeline((curr) => curr.map((s) => ({ ...s, state: "done" })));
      setJobs((prev) => [
        {
          i: String(prev.length + 1).padStart(2, "0"),
          title: out.title,
          state: "done",
          meta: `${out.chunks_indexed} chunks · just now`,
        },
        ...prev,
      ]);
      setValue("");
      setTitle("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const tab = (id: "drop" | "url" | "text" | "web", label: string) => (
    <div className={`it ${mode === id ? "active" : ""}`} onClick={() => setMode(id)}>
      {label}
    </div>
  );

  return (
    <AppShell
      active="ingest"
      dataLabel="Ingest · drop / paste / crawl"
      servicesState="ok"
      topBar={
        <AppTopBar
          section="Ingest"
          page="New job"
          corpus={corpus}
          health={healthMap}
          right={
            <>
              <span className="item">
                <span className="k">queue</span>
                <span>{jobs.filter((j) => j.state === "live").length || 0} active</span>
                <span className="k">·</span>
                <span>{jobs.filter((j) => j.state === "hitl").length} pending HITL</span>
              </span>
            </>
          }
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>
              Recent jobs <span className="count">· {jobs.length}</span>
            </span>
          </div>
          <div className="filter-list" style={{ padding: "6px 0" }}>
            {jobs.map((j) => (
              <div
                key={j.i}
                style={{
                  padding: "8px 14px",
                  borderBottom: "1px dashed var(--faint)",
                  cursor: "pointer",
                  background:
                    j.state === "live"
                      ? "color-mix(in oklab, var(--vector) 5%, transparent)"
                      : "transparent",
                  borderLeft:
                    j.state === "live" ? "2px solid var(--vector)" : "2px solid transparent",
                }}
              >
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <span
                    style={{
                      fontSize: "10px",
                      color: "var(--dim)",
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {j.i}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "11.5px",
                      color: "var(--text)",
                      flex: 1,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {j.title}
                  </span>
                  <span
                    className={`status-pill ${
                      j.state === "live"
                        ? "indexing"
                        : j.state === "hitl"
                          ? "queued"
                          : j.state === "failed"
                            ? "failed"
                            : ""
                    }`}
                    style={j.state === "hitl" ? { color: "var(--human)" } : {}}
                  >
                    {j.state === "live"
                      ? "indexing"
                      : j.state === "hitl"
                        ? "HITL"
                        : j.state === "failed"
                          ? "failed"
                          : "done"}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: "10px",
                    color: "var(--muted)",
                    marginTop: "3px",
                  }}
                >
                  {j.meta}
                </div>
              </div>
            ))}
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Ingest</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            Paste a URL or text, or open the dropzone / web-search sheet. Pipeline is transactional.
          </div>
        </div>
      </div>

      <div className="ingest-grid">
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="ingest-panel">
            <div className="ingest-tabs">
              {tab("drop", "↓ Drop files ⌘O")}
              {tab("url", "⊕ Paste URL")}
              {tab("text", "⊞ Paste text")}
              {tab("web", "⌖ Web search")}
            </div>

            {mode === "drop" && (
              <div
                className="dropzone hover"
                onClick={() => {
                  window.location.hash = "#ingest";
                }}
              >
                <span className="glyph">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M12 3v14M5 10l7-7 7 7M5 21h14" />
                  </svg>
                </span>
                <span className="t">Drop a file here, or use the ⌘O sheet</span>
                <span className="h">PDF · MD · HTML · TXT · DOCX · ≤ 50 MB each</span>
              </div>
            )}

            {mode === "url" && (
              <input
                type="url"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="https://example.com/page-to-ingest"
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
            )}
            {mode === "text" && (
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Paste markdown / text here…"
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
            {mode === "web" && (
              <div
                style={{
                  padding: "12px",
                  color: "var(--muted)",
                  fontSize: "11px",
                  fontFamily: "var(--font-mono)",
                  lineHeight: 1.6,
                }}
              >
                Use the ⌖ <strong>WEB</strong> suggestion on the Ask screen for the multi-select crawl sheet —
                it queries SearXNG, lets you pick results, then loops <code>POST /api/ingest</code>{" "}
                for each approved URL.
              </div>
            )}

            {(mode === "url" || mode === "text") && (
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="optional title"
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
            )}
          </div>

          <div className="ingest-panel">
            <div className="h">◗ pipeline</div>
            {pipeline.map((s) => (
              <div key={s.name} className={`ingest-row ${s.state}`}>
                <span className="dot" />
                <div className="info">
                  <span className="nm">{s.name}</span>
                  <div className="sub">{s.sub}</div>
                </div>
                <span className="right">{s.right}</span>
              </div>
            ))}
          </div>

          {err && (
            <div
              style={{
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

        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          <div className="ingest-panel">
            <div className="h">◗ chunking</div>
            <KnobRow label="Strategy" help="structure-aware uses markdown headings; recursive falls back to char windows.">
              <Segmented
                options={["Structure", "Recursive", "Semantic"] as const}
                active="Structure"
              />
            </KnobRow>
            <KnobRow label="Target size" help="Tokens per chunk.">
              <Slider min={128} max={1024} value={512} ticks={5} />
            </KnobRow>
            <KnobRow label="Overlap" help="Context window between adjacent chunks.">
              <Slider min={0} max={200} value={64} ticks={5} />
            </KnobRow>
          </div>

          <div className="ingest-panel">
            <div className="h">◗ embedding</div>
            <KnobRow label="Model">
              <PillSelect v="bge-m3" />
              <span style={{ fontSize: "10.5px", color: "var(--muted)" }}>
                1024d <span style={{ color: "var(--dim)" }}>·</span>{" "}
                <span style={{ color: "var(--ok)" }}>●</span> warm
              </span>
            </KnobRow>
            <KnobRow label="Batch size" help="Larger = faster, more memory.">
              <NumInput value={32} />
            </KnobRow>
          </div>

          <div className="ingest-panel">
            <div className="h">◗ extraction</div>
            <KnobRow label="Extract entities">
              <Toggle on />
              <PillSelect v="spaCy + claude-haiku" />
            </KnobRow>
            <KnobRow label="Auto-tag">
              <Toggle on />
            </KnobRow>
            <KnobRow label="Summarise">
              <Toggle on={false} />
            </KnobRow>
          </div>

          <button
            className="send-btn"
            style={{ padding: "8px 14px", justifyContent: "center" }}
            onClick={() => void runIngest()}
            disabled={busy || !value.trim() || mode === "drop" || mode === "web"}
          >
            <span>{busy ? "ingesting…" : `ingest ${mode}`}</span>
            <span className="kbd">⌘↵</span>
          </button>
        </div>
      </div>
    </AppShell>
  );
}
