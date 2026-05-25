// Global Settings — full page, distinct from the per-thread Settings panel.
//
// Real wiring: /api/health drives the Services tab. /api/settings backs the
// Models / Defaults / Fallback tabs (so anything the SettingsPanel can PATCH
// is also reachable here). Theme / Keyboard / Security / About are
// surface-only since they don't have backend state yet.

import { useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { Toggle } from "../components/controls/Toggle";
import { KnobRow } from "../components/controls/KnobRow";
import { Segmented } from "../components/controls/Segmented";
import { Slider } from "../components/controls/Slider";
import { NumInput } from "../components/controls/NumInput";
import { PillSelect } from "../components/controls/PillSelect";
import { useCorpusStats, useHealth, useSettings } from "../hooks/useCorpus";

type ChunkStrategy = "Structure" | "Recursive" | "Semantic";
type FailurePolicy = "retry" | "skip" | "halt";

const TABS = [
  "Services",
  "Models",
  "Defaults",
  "Ingest",
  "Fallback",
  "Theme",
  "Keyboard",
  "Security",
  "About",
] as const;
type Tab = (typeof TABS)[number];

export function GlobalSettings() {
  const { data: health } = useHealth();
  const { data: corpus } = useCorpusStats();
  const { data: settings, patch: patchSettings } = useSettings();
  const [tab, setTab] = useState<Tab>("Services");

  // Ingest tab local state — TODO: persist to /api/settings
  const [ingestStrategy, setIngestStrategy] = useState<ChunkStrategy>("Structure");
  const [ingestChunkSize, setIngestChunkSize] = useState<number>(512);
  const [ingestOverlap, setIngestOverlap] = useState<number>(64);
  const [ingestConcurrency, setIngestConcurrency] = useState<number>(4);
  const [ingestEmbedOpen, setIngestEmbedOpen] = useState<boolean>(false);
  const [ingestExtractEntities, setIngestExtractEntities] = useState<boolean>(true);
  const [ingestDedupe, setIngestDedupe] = useState<boolean>(false);
  const [ingestFailurePolicy, setIngestFailurePolicy] = useState<FailurePolicy>("retry");

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  return (
    <AppShell
      active="settings"
      dataLabel="Settings · global"
      variant="wide-rail"
      topBar={
        <AppTopBar
          section="Settings"
          page={tab}
          corpus={corpus}
          health={healthMap}
        />
      }
      rail={
        <aside className="filter-rail">
          <div className="rail-head">
            <span>Settings</span>
          </div>
          <div className="filter-list" style={{ padding: "8px 0" }}>
            {TABS.map((t) => (
              <div
                key={t}
                className={`filter-row ${tab === t ? "on" : ""}`}
                style={{ padding: "8px 14px", cursor: "pointer" }}
                onClick={() => setTab(t)}
              >
                <span className="lbl">{t}</span>
              </div>
            ))}
          </div>
        </aside>
      }
    >
      <div className="page-head">
        <div>
          <div className="title">{tab}</div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 28px 28px" }}>
        {tab === "Services" && (
          <div className="service-grid">
            {(health?.services ?? []).map((s) => (
              <div key={s.name} className={`svc-card ${s.state}`}>
                <div className="svc-head">
                  <span className={`dot ${s.state}`} />
                  <span className="name">{s.name}</span>
                  <span className="endpoint">{s.endpoint ?? "—"}</span>
                </div>
                <div className="svc-body">
                  <div className="row">
                    <span className="k">state</span>
                    <span className="v" style={{ color: `var(--${s.state})` }}>
                      {s.state}
                    </span>
                  </div>
                  <div className="row">
                    <span className="k">latency p50</span>
                    <span className="v">{s.latency_ms?.toFixed(1) ?? "—"} ms</span>
                  </div>
                  {s.note && (
                    <div className="row">
                      <span className="k">note</span>
                      <span className="v">{s.note}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === "Models" && settings && (
          <div className="ingest-panel">
            <KnobRow label="LLM" help="Set via env LLM_MODEL — redeploy to change.">
              <code className="mono">{settings.llm_model}</code>
            </KnobRow>
            <KnobRow label="Embed provider">
              <code className="mono">{settings.embed_provider}</code>
            </KnobRow>
            <KnobRow label="Embed model">
              <code className="mono">{settings.embed_model}</code>
            </KnobRow>
            <KnobRow label="Embed dim">
              <code className="mono">{settings.embed_dim}</code>
            </KnobRow>
            <KnobRow label="Reranker">
              <code className="mono">{settings.reranker_model}</code>
              <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                device {settings.reranker_device}
              </span>
            </KnobRow>
          </div>
        )}

        {tab === "Defaults" && settings && (
          <div className="ingest-panel">
            <KnobRow label="Graph retrieval">
              <Toggle
                on={settings.enable_graph_retrieval}
                onChange={(v) => void patchSettings({ enable_graph_retrieval: v })}
              />
            </KnobRow>
            <KnobRow label="Contextual retrieval">
              <Toggle
                on={settings.enable_contextual_retrieval}
                onChange={(v) => void patchSettings({ enable_contextual_retrieval: v })}
              />
            </KnobRow>
            <KnobRow label="Adaptive rerank">
              <Toggle
                on={settings.adaptive_rerank}
                onChange={(v) => void patchSettings({ adaptive_rerank: v })}
              />
            </KnobRow>
            <KnobRow label="k_retrieve">
              <code className="mono">{settings.retrieve_top_k}</code>
            </KnobRow>
            <KnobRow label="k_rerank">
              <code className="mono">{settings.rerank_top_k}</code>
            </KnobRow>
          </div>
        )}

        {tab === "Fallback" && settings && (
          <div className="ingest-panel">
            <KnobRow label="Web fallback threshold">
              <code className="mono">{settings.web_fallback_min_chunks}</code>
              <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                triggers when reranked chunks &lt; threshold
              </span>
            </KnobRow>
            <KnobRow label="URL budget">
              <code className="mono">{settings.web_fallback_max_urls}</code>
            </KnobRow>
          </div>
        )}

        {tab === "Ingest" && (
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            <div className="ingest-panel">
              <KnobRow label="Default chunking strategy">
                <Segmented<ChunkStrategy>
                  options={["Structure", "Recursive", "Semantic"]}
                  active={ingestStrategy}
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestStrategy(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Default chunk size" help="Tokens per chunk.">
                <Slider
                  min={128}
                  max={2048}
                  step={64}
                  value={ingestChunkSize}
                  bubble
                  suffix=" tok"
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestChunkSize(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Default overlap" help="Tokens shared between adjacent chunks.">
                <Slider
                  min={0}
                  max={256}
                  step={16}
                  value={ingestOverlap}
                  bubble
                  suffix=" tok"
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestOverlap(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Concurrency" help="Jobs in parallel — bound by Milvus + Ollama capacity.">
                <NumInput
                  value={ingestConcurrency}
                  min={1}
                  max={16}
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestConcurrency(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Embeddings model" help="Default for new ingests. Per-job override allowed.">
                <PillSelect
                  k="model:"
                  v="bge-large-en-v1.5"
                  open={ingestEmbedOpen}
                  onClick={() => {
                    // TODO: open model picker popover
                    setIngestEmbedOpen((o) => !o);
                    console.log("ingest: embeddings model picker (stub)");
                  }}
                />
              </KnobRow>

              <KnobRow label="Auto-extract entities" help="Run NER + relation extraction into Neo4j.">
                <Toggle
                  on={ingestExtractEntities}
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestExtractEntities(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Auto-deduplicate" help="MinHash near-dupe detection across the corpus.">
                <Toggle
                  on={ingestDedupe}
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestDedupe(v);
                  }}
                />
              </KnobRow>

              <KnobRow label="Failure policy" help="What happens when a stage fails (parse error, OOM, etc.).">
                <Segmented<FailurePolicy>
                  options={["retry", "skip", "halt"]}
                  active={ingestFailurePolicy}
                  tooltips={{
                    retry: "Retry up to 3 times with backoff.",
                    skip: "Skip the failed document and continue.",
                    halt: "Stop the entire ingest job.",
                  }}
                  onChange={(v) => {
                    // TODO: persist to /api/settings
                    setIngestFailurePolicy(v);
                  }}
                />
              </KnobRow>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 2px",
                gap: "12px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "10.5px",
                  color: "var(--muted)",
                }}
              >
                scope: global · these defaults apply to every new ingest
              </span>
              <button
                className="btn warm"
                style={{ padding: "4px 12px", fontSize: "11px" }}
                onClick={() => {
                  // TODO: persist to /api/settings
                  console.log("ingest: save defaults", {
                    strategy: ingestStrategy,
                    chunk_size: ingestChunkSize,
                    overlap: ingestOverlap,
                    concurrency: ingestConcurrency,
                    extract_entities: ingestExtractEntities,
                    deduplicate: ingestDedupe,
                    failure_policy: ingestFailurePolicy,
                  });
                }}
              >
                save defaults
              </button>
            </div>
          </div>
        )}

        {(tab === "Theme" || tab === "Keyboard" || tab === "Security" || tab === "About") && (
          <div
            style={{
              padding: "40px 12px",
              textAlign: "center",
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontSize: "11px",
              fontStyle: "italic",
            }}
          >
            <div
              style={{
                fontSize: "9.5px",
                letterSpacing: "0.14em",
                textTransform: "uppercase",
                color: "var(--dim)",
                marginBottom: "10px",
                fontStyle: "normal",
              }}
            >
              ◗ {tab.toLowerCase()}
            </div>
            Controls for this section are deploy-time configuration in{" "}
            <code className="mono">src/sovereign_rag/config.py</code>.
          </div>
        )}
      </div>
    </AppShell>
  );
}
