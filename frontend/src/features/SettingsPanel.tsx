// Settings slide-over — over the Ask screen. Five tabs:
//   Retrieval / Model / Indexing / Web fallback / Services
// All knobs are wired to local state for now; persistence is a follow-up
// (route to PATCH /settings or store thread-scoped overrides via the
//  LangGraph thread metadata).

import { useEffect, useState } from "react";
import { KnobRow } from "../components/controls/KnobRow";
import { NumInput } from "../components/controls/NumInput";
import { PillSelect } from "../components/controls/PillSelect";
import { Segmented } from "../components/controls/Segmented";
import { Slider } from "../components/controls/Slider";
import { Toggle } from "../components/controls/Toggle";
import type { Settings, SettingsPatch } from "../lib/api";

const TABS = ["Retrieval", "Model", "Indexing", "Web fallback", "Services"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  /** Live settings from GET /api/settings; null while loading. */
  settings: Settings | null;
  /** PATCH /api/settings to persist (in-process) changes. */
  onPatch: (patch: Partial<Settings>) => Promise<Settings>;
  onClose: () => void;
}

export function SettingsPanel({ settings, onPatch, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("Retrieval");
  const [scope, setScope] = useState<"thread" | "global">("thread");

  // Local draft state — initialised from live settings, mutated by the
  // sliders/toggles, persisted on Apply.
  const [draft, setDraft] = useState<Settings | null>(settings);
  useEffect(() => {
    // When the parent re-fetches settings (e.g. after the panel re-opens
    // mid-session), re-sync the draft so we don't show stale knob values.
    if (settings) setDraft(settings);
  }, [settings]);

  const [dense, setDense] = useState(true);
  const [sparse, setSparse] = useState(true);
  const [strategy, setStrategy] = useState<"RRF" | "Weighted" | "Borda">("RRF");
  const [wGraph, setWGraph] = useState(40);
  const [wVector, setWVector] = useState(60);
  const [scoreFloor, setScoreFloor] = useState(0.5);
  const [adaptiveK, setAdaptiveK] = useState(false);

  const setIn = <K extends keyof Settings>(field: K, value: Settings[K]) => {
    setDraft((d) => (d ? { ...d, [field]: value } : d));
  };

  const apply = async () => {
    if (!draft) {
      onClose();
      return;
    }
    const patch: SettingsPatch = {
      retrieve_top_k: draft.retrieve_top_k,
      rerank_top_k: draft.rerank_top_k,
      rrf_k: draft.rrf_k,
      enable_graph_retrieval: draft.enable_graph_retrieval,
      enable_contextual_retrieval: draft.enable_contextual_retrieval,
      web_fallback_min_chunks: draft.web_fallback_min_chunks,
      web_fallback_max_urls: draft.web_fallback_max_urls,
    };
    try {
      await onPatch(patch);
    } catch (err) {
      console.error("patch settings failed", err);
    }
    onClose();
  };

  // While loading, fall back to design defaults for the controls so the
  // panel renders without flicker.
  const d = draft ?? {
    llm_model: "kimi-k2.6",
    embed_provider: "openai",
    embed_model: "bge-m3",
    embed_dim: 3072,
    retrieve_top_k: 50,
    rerank_top_k: 5,
    rrf_k: 60,
    enable_graph_retrieval: true,
    enable_contextual_retrieval: true,
    reranker_model: "BAAI/bge-reranker-v2-m3",
    reranker_device: "auto",
    web_fallback_min_chunks: 3,
    web_fallback_max_urls: 3,
  } satisfies Settings;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="drawer-right" style={{ width: "560px" }}>
        <div className="drawer-head">
          <span className="lab">◗ settings</span>
          <span className="title">Retrieval parameters</span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <span
              key={t}
              className={`tab ${tab === t ? "active" : ""}`}
              onClick={() => setTab(t)}
            >
              {t}
              {t === "Retrieval" && <span className="count">8</span>}
              {t === "Model" && <span className="count">5</span>}
            </span>
          ))}
        </div>

        <div className="drawer-body">
          {tab === "Retrieval" && (
            <>
              <div className="drawer-section">
                <div className="h">◗ hybrid retrieval</div>
                <KnobRow label="Dense (vector)" help="Milvus ANN over bge-m3 1024-dim embeddings.">
                  <Toggle on={dense} onChange={setDense} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    {d.embed_provider} <span style={{ color: "var(--dim)" }}>·</span>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{d.embed_model}</span>{" "}
                    <span style={{ color: "var(--dim)" }}>·</span>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{d.embed_dim}-dim</span>
                  </span>
                </KnobRow>
                <KnobRow label="Sparse (BM25)" help="Native to Milvus 2.6 — no separate index.">
                  <Toggle on={sparse} onChange={setSparse} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    tokenizer <span style={{ color: "var(--text-dim)" }}>standard · en</span>
                  </span>
                </KnobRow>
                <KnobRow
                  label="Graph traversal"
                  help="Neo4j community plugin · BFS from entity-linked seeds."
                >
                  <Toggle
                    on={d.enable_graph_retrieval}
                    onChange={(on) => setIn("enable_graph_retrieval", on)}
                  />
                  <PillSelect k="depth" v="2 hops" />
                  <PillSelect k="max nodes" v="60" />
                </KnobRow>
                <KnobRow
                  label="k_retrieve"
                  help="How many candidates each retriever returns before fusion."
                >
                  <Slider
                    min={10}
                    max={200}
                    value={d.retrieve_top_k}
                    onChange={(v) => setIn("retrieve_top_k", v)}
                  />
                </KnobRow>
                <KnobRow
                  label="k_rerank"
                  help="How many fused candidates pass the cross-encoder reranker."
                >
                  <Slider
                    min={1}
                    max={20}
                    value={d.rerank_top_k}
                    onChange={(v) => setIn("rerank_top_k", v)}
                  />
                </KnobRow>
              </div>

              <div className="drawer-section">
                <div className="h">
                  ◗ fusion <span className="right">RRF · k={d.rrf_k}</span>
                </div>
                <KnobRow
                  label="Strategy"
                  help="RRF works zero-config; weighted lets you tune the blend explicitly."
                >
                  <Segmented
                    options={["RRF", "Weighted", "Borda"] as const}
                    active={strategy}
                    onChange={setStrategy}
                  />
                </KnobRow>
                <KnobRow
                  label="RRF constant k"
                  help="Lower → top-rank dominance · higher → softer blend."
                >
                  <Slider
                    min={10}
                    max={120}
                    value={d.rrf_k}
                    ticks={6}
                    onChange={(v) => setIn("rrf_k", v)}
                  />
                </KnobRow>
                <KnobRow
                  label="Per-retriever weights"
                  help="Used only when strategy = Weighted. Normalized to sum to 1."
                >
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          color: "var(--graph)",
                          fontSize: "10.5px",
                          width: "54px",
                        }}
                      >
                        graph
                      </span>
                      <Slider
                        min={0}
                        max={100}
                        value={wGraph}
                        suffix="%"
                        onChange={setWGraph}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <span
                        style={{
                          color: "var(--vector)",
                          fontSize: "10.5px",
                          width: "54px",
                        }}
                      >
                        vector
                      </span>
                      <Slider
                        min={0}
                        max={100}
                        value={wVector}
                        suffix="%"
                        onChange={setWVector}
                      />
                    </div>
                  </div>
                </KnobRow>
              </div>

              <div className="drawer-section">
                <div className="h">◗ reranker</div>
                <KnobRow label="Model" help="Cross-encoder · runs on MPS / CUDA / CPU.">
                  <PillSelect v={d.reranker_model.replace(/^BAAI\//, "")} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    device <span style={{ color: "var(--text-dim)" }}>{d.reranker_device}</span>
                  </span>
                </KnobRow>
                <KnobRow
                  label="Score floor"
                  help="Drop candidates below this raw rerank score before passing to LLM."
                >
                  <Slider
                    min={0}
                    max={1}
                    value={scoreFloor}
                    ticks={6}
                    onChange={setScoreFloor}
                  />
                </KnobRow>
                <KnobRow
                  label="Adaptive k_rerank"
                  help="Stop reranking once cumulative score-mass ≥ 0.85."
                >
                  <Toggle on={adaptiveK} onChange={setAdaptiveK} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    {adaptiveK ? "on" : "off — using fixed k_rerank"}
                  </span>
                </KnobRow>
              </div>

              <div className="drawer-section">
                <div className="h">
                  ◗ web fallback{" "}
                  <span className="right" style={{ color: "var(--human)" }}>
                    HITL · always asks
                  </span>
                </div>
                <KnobRow
                  label="Trigger when reranked chunks <"
                  help="Falls into HITL when local candidates run thin. 0 disables."
                >
                  <NumInput
                    value={d.web_fallback_min_chunks}
                    min={0}
                    max={20}
                    onChange={(v) => setIn("web_fallback_min_chunks", v)}
                  />
                </KnobRow>
                <KnobRow label="Search engine" help="SearXNG meta-search, self-hosted.">
                  <PillSelect v="searxng @ localhost:8082" />
                </KnobRow>
                <KnobRow
                  label="URL budget"
                  help="Maximum pages to crawl per approval round."
                >
                  <NumInput
                    value={d.web_fallback_max_urls}
                    min={1}
                    max={10}
                    onChange={(v) => setIn("web_fallback_max_urls", v)}
                  />
                </KnobRow>
              </div>
            </>
          )}

          {tab !== "Retrieval" && (
            <div className="drawer-section">
              <div
                style={{
                  padding: "40px 8px",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontFamily: "var(--font-mono)",
                  fontSize: "11px",
                  lineHeight: 1.6,
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
                Controls for this section ship in the next iteration — the visual language
                stays identical to the Retrieval tab. Filed in <code className="mono">docs/ui-design-brief.md</code>.
              </div>
            </div>
          )}
        </div>

        <div className="drawer-foot">
          <span className="scope">
            scope · <span style={{ color: "var(--text)" }}>this {scope}</span>
          </span>
          <Segmented
            options={["thread", "global"] as const}
            active={scope}
            onChange={setScope}
          />
          <div className="right">
            <button className="btn ghost" type="button">
              reset to defaults
            </button>
            <button
              className="btn warm"
              type="button"
              style={{ background: "var(--vector)", color: "#0a0612" }}
              onClick={apply}
            >
              apply
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
