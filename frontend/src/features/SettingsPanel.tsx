// Settings slide-over — over the Ask screen. Five tabs:
//   Retrieval / Model / Indexing / Web fallback / Services
// All knobs are wired to local state for now; persistence is a follow-up
// (route to PATCH /settings or store thread-scoped overrides via the
//  LangGraph thread metadata).

import { useState } from "react";
import { KnobRow } from "../components/controls/KnobRow";
import { NumInput } from "../components/controls/NumInput";
import { PillSelect } from "../components/controls/PillSelect";
import { Segmented } from "../components/controls/Segmented";
import { Slider } from "../components/controls/Slider";
import { Toggle } from "../components/controls/Toggle";

const TABS = ["Retrieval", "Model", "Indexing", "Web fallback", "Services"] as const;
type Tab = (typeof TABS)[number];

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const [tab, setTab] = useState<Tab>("Retrieval");
  const [scope, setScope] = useState<"thread" | "global">("thread");

  // Local knob state — visual until we have a /settings endpoint to PATCH.
  const [dense, setDense] = useState(true);
  const [sparse, setSparse] = useState(true);
  const [graph, setGraph] = useState(true);
  const [kRet, setKRet] = useState(50);
  const [kRer, setKRer] = useState(5);
  const [rrfK, setRrfK] = useState(60);
  const [strategy, setStrategy] = useState<"RRF" | "Weighted" | "Borda">("RRF");
  const [wGraph, setWGraph] = useState(40);
  const [wVector, setWVector] = useState(60);
  const [scoreFloor, setScoreFloor] = useState(0.5);
  const [adaptiveK, setAdaptiveK] = useState(false);
  const [fbScoreFloor, setFbScoreFloor] = useState(0.5);
  const [fbMinChunks, setFbMinChunks] = useState(3);
  const [urlBudget, setUrlBudget] = useState(3);

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
                    milvus.collection{" "}
                    <span style={{ color: "var(--text-dim)" }}>sr_chunks_v3</span>
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
                  <Toggle on={graph} onChange={setGraph} />
                  <PillSelect k="depth" v="2 hops" />
                  <PillSelect k="max nodes" v="60" />
                </KnobRow>
                <KnobRow
                  label="k_retrieve"
                  help="How many candidates each retriever returns before fusion."
                >
                  <Slider min={10} max={200} value={kRet} onChange={setKRet} />
                </KnobRow>
                <KnobRow
                  label="k_rerank"
                  help="How many fused candidates pass the cross-encoder reranker."
                >
                  <Slider min={1} max={20} value={kRer} onChange={setKRer} />
                </KnobRow>
              </div>

              <div className="drawer-section">
                <div className="h">
                  ◗ fusion <span className="right">RRF · k={rrfK}</span>
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
                  <Slider min={10} max={120} value={rrfK} ticks={6} onChange={setRrfK} />
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
                <KnobRow label="Model" help="Cross-encoder · runs on Ollama / CUDA fallback.">
                  <PillSelect v="bge-reranker-v2-m3" />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    <span style={{ color: "var(--ok)" }}>●</span> warm · 248ms p50
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
                  label="Trigger when…"
                  help="Either condition flips the run into HITL approval mode."
                >
                  <div
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      gap: "6px",
                      width: "100%",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ color: "var(--text-dim)", fontSize: "10.5px" }}>
                        max rerank score &lt;
                      </span>
                      <NumInput
                        value={fbScoreFloor}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(v) => setFbScoreFloor(Math.round(v * 100) / 100)}
                      />
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                      <span style={{ color: "var(--text-dim)", fontSize: "10.5px" }}>
                        OR reranked chunks &lt;
                      </span>
                      <NumInput
                        value={fbMinChunks}
                        min={0}
                        max={20}
                        onChange={setFbMinChunks}
                      />
                    </div>
                  </div>
                </KnobRow>
                <KnobRow label="Search engine" help="SearXNG meta-search, self-hosted.">
                  <PillSelect v="searxng @ localhost:8082" />
                </KnobRow>
                <KnobRow
                  label="URL budget"
                  help="Maximum pages to crawl per approval round."
                >
                  <NumInput value={urlBudget} min={1} max={10} onChange={setUrlBudget} />
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
              onClick={onClose}
            >
              apply
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
