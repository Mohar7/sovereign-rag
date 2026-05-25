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

import { Fragment, useState } from "react";
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

type ChunkingStrategy = "Structure" | "Recursive" | "Semantic";

interface JobStage {
  name: string;
  state: "done" | "live" | "pending";
  /** Seconds spent in this stage so far, or null if pending. */
  durationS: number | null;
}

interface JobEntry {
  i: string;
  title: string;
  state: "done" | "live" | "hitl" | "failed";
  meta: string;
  /** Per-stage timing for the expand panel. Stub data if not provided by backend. */
  stages?: JobStage[];
}

const DEFAULT_STAGES: JobStage[] = [
  { name: "parse", state: "done", durationS: 0.4 },
  { name: "chunk", state: "done", durationS: 1.2 },
  { name: "contextualise", state: "live", durationS: 8.7 },
  { name: "embed", state: "pending", durationS: null },
  { name: "index", state: "pending", durationS: null },
];

const DONE_STAGES: JobStage[] = [
  { name: "parse", state: "done", durationS: 0.4 },
  { name: "chunk", state: "done", durationS: 1.2 },
  { name: "contextualise", state: "done", durationS: 9.1 },
  { name: "embed", state: "done", durationS: 3.4 },
  { name: "index", state: "done", durationS: 0.8 },
];

const SEED_JOBS: JobEntry[] = [
  { i: "01", title: "rrf-paper.pdf", state: "done", meta: "18 chunks · 1h ago", stages: DONE_STAGES },
  { i: "02", title: "trec-dl-2023.pdf", state: "done", meta: "12 chunks · yesterday", stages: DONE_STAGES },
  { i: "03", title: "FERRET · 2 urls (pending)", state: "hitl", meta: "awaiting approval" },
  { i: "04", title: "broken-link.pdf", state: "failed", meta: "parse error · ECONNRESET" },
];

// Rough corpus-size assumption used to estimate chunk count when we don't
// have real document token data. ~200k tokens ≈ a small PDF batch.
const FALLBACK_CORPUS_TOKENS = 200_000;

const STRATEGY_TOOLTIPS: Partial<Record<ChunkingStrategy, string>> = {
  Semantic: "Splits by meaning using embeddings — slowest, best quality",
  Recursive: "Splits at natural boundaries (paragraphs, sentences)",
  Structure: "Uses document headings and layout",
};

const PREVIEW_BODIES = [
  "Milvus 2.6 introduces native BM25 as a built-in function on text fields. A single hybrid_search call can issue both dense ANN and BM25 sub-queries…",
  "The reciprocal rank fusion score for a document d under a set of rankings R is the sum over r ∈ R of 1/(k + r(d)). The constant k is set to 60…",
  "Practitioners tend to lower k when the dense retriever is dominant. We saw recall improve 4pp at k=20 on a customer corpus where BM25 was noisy…",
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
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [pipeline, setPipeline] = useState<
    Array<{ name: string; sub: string; state: "" | "live" | "done"; right: string }>
  >([
    { name: "parse", sub: "docling · pdf → markdown", state: "", right: "—" },
    { name: "chunk", sub: "structure-aware · target 512 tok", state: "", right: "—" },
    { name: "embed", sub: "bge-m3 · 1024d", state: "", right: "—" },
    { name: "extract entities", sub: "→ neo4j · spaCy NER + LLM relation pass", state: "", right: "—" },
    { name: "commit", sub: "milvus + neo4j + postgres · transactional", state: "", right: "—" },
  ]);

  // ── knob state ───────────────────────────────────────────────────────
  const [chunkingStrategy, setChunkingStrategy] = useState<ChunkingStrategy>("Structure");
  const [targetSize, setTargetSize] = useState(512);
  const [overlap, setOverlap] = useState(64);
  const [batchSize, setBatchSize] = useState(32);
  const [extractEntities, setExtractEntities] = useState(true);
  const [autoTag, setAutoTag] = useState(true);
  const [summarise, setSummarise] = useState(false);

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  // Live chunk-count estimate against the current corpus (or fallback).
  const corpusTokens =
    corpus && corpus.chunks > 0
      ? // Rough back-of-envelope: assume avg 400 tok per existing chunk.
        corpus.chunks * 400
      : FALLBACK_CORPUS_TOKENS;
  const chunkEstimate = Math.max(1, Math.round(corpusTokens / Math.max(64, targetSize)));

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
          stages: DONE_STAGES,
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

  const handleCancelJob = (jobId: string) => {
    // TODO: wire to backend — POST /api/ingest/{jobId}/cancel
    setJobs((prev) =>
      prev.map((j) =>
        j.i === jobId && j.state === "live"
          ? { ...j, state: "failed", meta: "cancelled by user" }
          : j,
      ),
    );
  };

  const handleViewLog = (jobId: string) => {
    // TODO: wire to backend — GET /api/ingest/{jobId}/log
    // For now route to the future logs screen; silent no-op if not implemented.
    window.location.hash = `#ingest/${jobId}/log`;
  };

  const showLivePreview = busy || pipeline.some((s) => s.state === "live" || s.state === "done");

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
            {jobs.map((j) => {
              const isExpanded = expandedJobId === j.i;
              const stages = j.stages ?? DEFAULT_STAGES;
              const totalS = stages.reduce((sum, s) => sum + (s.durationS ?? 0), 0) || 1;
              return (
                <Fragment key={j.i}>
                  <div
                    onClick={() => setExpandedJobId(isExpanded ? null : j.i)}
                    style={{
                      padding: "8px 14px",
                      borderBottom: "1px dashed var(--faint)",
                      cursor: "pointer",
                      background:
                        isExpanded
                          ? "color-mix(in oklab, var(--vector) 7%, transparent)"
                          : j.state === "live"
                            ? "color-mix(in oklab, var(--vector) 5%, transparent)"
                            : "transparent",
                      borderLeft:
                        isExpanded || j.state === "live"
                          ? "2px solid var(--vector)"
                          : "2px solid transparent",
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

                  {isExpanded && (
                    <div
                      style={{
                        padding: "10px 14px 12px",
                        borderBottom: "1px dashed var(--faint)",
                        background: "var(--surface-1)",
                        borderLeft: "2px solid var(--vector)",
                      }}
                    >
                      <div
                        style={{
                          fontSize: "9.5px",
                          letterSpacing: "0.12em",
                          textTransform: "uppercase",
                          color: "var(--muted)",
                          marginBottom: "6px",
                        }}
                      >
                        ◗ stages {j.state === "live" ? "· live" : `· ${totalS.toFixed(1)}s total`}
                      </div>

                      <div className="timeline-strip">
                        {stages.map((s) => {
                          const pct = s.durationS != null ? (s.durationS / totalS) * 100 : 0;
                          const barColor =
                            s.state === "done"
                              ? "var(--ok)"
                              : s.state === "live"
                                ? "var(--vector)"
                                : "var(--dim)";
                          const glyph =
                            s.state === "done" ? "✓" : s.state === "live" ? "●" : "○";
                          return (
                            <div className="tl" key={s.name}>
                              <span className="k" style={{ color: barColor }}>
                                {glyph} {s.name}
                              </span>
                              <span className="bar">
                                <span
                                  style={{
                                    position: "absolute",
                                    inset: 0,
                                    width: `${pct}%`,
                                    background: barColor,
                                    opacity: s.state === "pending" ? 0.2 : 0.85,
                                  }}
                                />
                              </span>
                              <span className="t">
                                {s.durationS != null ? `${s.durationS.toFixed(1)}s` : "—"}
                              </span>
                            </div>
                          );
                        })}
                      </div>

                      <div style={{ display: "flex", gap: "6px", marginTop: "10px" }}>
                        {j.state === "live" && (
                          <button
                            className="btn ghost"
                            style={{ fontSize: "10px", padding: "3px 8px" }}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleCancelJob(j.i);
                            }}
                          >
                            cancel
                          </button>
                        )}
                        <a
                          href={`#ingest/${j.i}/log`}
                          className="chip-btn"
                          style={{ marginLeft: "auto", textDecoration: "none" }}
                          onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            handleViewLog(j.i);
                          }}
                        >
                          view log ↗
                        </a>
                      </div>
                    </div>
                  )}
                </Fragment>
              );
            })}
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
            <KnobRow
              label="Strategy"
              help="structure-aware uses markdown headings; recursive falls back to char windows."
            >
              <Segmented
                options={["Structure", "Recursive", "Semantic"] as const}
                active={chunkingStrategy}
                tooltips={STRATEGY_TOOLTIPS}
                onChange={setChunkingStrategy}
              />
            </KnobRow>
            <KnobRow label="Target size" help="Tokens per chunk.">
              <Slider
                min={128}
                max={1024}
                value={targetSize}
                ticks={5}
                bubble
                suffix=" tok"
                onChange={setTargetSize}
              />
            </KnobRow>
            <KnobRow
              label="Overlap"
              help={`Context window between adjacent chunks · ≈ ${chunkEstimate} chunks at current settings.`}
            >
              <Slider
                min={0}
                max={200}
                value={overlap}
                ticks={5}
                bubble
                onChange={setOverlap}
              />
              <span style={{ fontSize: "10px", color: "var(--graph)", marginLeft: "8px" }}>
                ≈ {chunkEstimate} chunks
              </span>
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
              <NumInput
                value={batchSize}
                min={1}
                max={256}
                onChange={setBatchSize}
              />
            </KnobRow>
          </div>

          <div className="ingest-panel">
            <div className="h">◗ extraction</div>
            <KnobRow label="Extract entities">
              <span
                title="Run spaCy NER + an LLM relation pass; populates the entity graph."
                style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}
              >
                <Toggle on={extractEntities} onChange={setExtractEntities} />
                <PillSelect v="spaCy + claude-haiku" />
              </span>
            </KnobRow>
            <KnobRow label="Auto-tag">
              <span title="Generate topical tags for each chunk to power filter facets.">
                <Toggle on={autoTag} onChange={setAutoTag} />
              </span>
            </KnobRow>
            <KnobRow label="Summarise">
              <span title="Synthesise a one-paragraph abstract per document — adds a small embed cost.">
                <Toggle on={summarise} onChange={setSummarise} />
              </span>
            </KnobRow>
          </div>

          {showLivePreview && (
            <div className="ingest-panel">
              <div className="h" style={{ display: "flex", alignItems: "center" }}>
                <span>◗ live preview · first 3 chunks</span>
                {busy && (
                  <span
                    style={{ marginLeft: "auto", fontSize: "10px", color: "var(--vector)" }}
                    className="atom-indexing"
                  >
                    recomputing
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: "10px",
                  color: "var(--muted)",
                  marginTop: "-4px",
                  marginBottom: "4px",
                }}
              >
                with current knobs · target {targetSize} · overlap {overlap} ·{" "}
                {extractEntities ? "entities on" : "entities off"}
              </div>
              {PREVIEW_BODIES.map((body, idx) => {
                // Token count drifts around the configured target to feel live.
                const tok = Math.max(64, targetSize - 30 + idx * 24);
                return (
                  <div
                    key={idx}
                    style={{
                      padding: "10px 12px",
                      border: "1px solid var(--hair)",
                      background: "var(--surface-1)",
                      borderRadius: "2px",
                      marginTop: idx === 0 ? "6px" : "8px",
                    }}
                  >
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "4px",
                        fontFamily: "var(--font-mono)",
                        fontSize: "10px",
                      }}
                    >
                      <span style={{ color: "var(--dim)" }}>
                        chunk {String(idx + 1).padStart(2, "0")}
                      </span>
                      <span style={{ color: "var(--dim)" }}>·</span>
                      <span style={{ color: "var(--vector)" }}>{chunkingStrategy.toLowerCase()}-split</span>
                      <span
                        style={{
                          marginLeft: "auto",
                          color: "var(--text-dim)",
                          fontVariantNumeric: "tabular-nums",
                        }}
                      >
                        {tok} tok
                      </span>
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-serif)",
                        fontSize: "12px",
                        color: "var(--text-dim)",
                        lineHeight: 1.45,
                        fontStyle: "italic",
                      }}
                    >
                      "{body}"
                    </div>
                  </div>
                );
              })}
            </div>
          )}

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
