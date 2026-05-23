// Settings slide-over — over the Ask screen.
//
// Every knob in this panel is now backed by a field on the live `Settings`
// object served by GET /api/settings. Edits mutate a local draft; "apply"
// fires PATCH /api/settings with the diff. Open the panel mid-session and
// you see whatever the FastAPI process currently has cached.
//
// Caveat documented elsewhere ([[sovereign-rag-architecture]]): PATCH only
// mutates the FastAPI process. Pipeline-affecting knobs are honored by the
// LangGraph worker only after a .env edit + service restart, which the deploy
// pipeline handles on push.

import { useEffect, useMemo, useState } from "react";
import { KnobRow } from "../components/controls/KnobRow";
import { NumInput } from "../components/controls/NumInput";
import { PillSelect } from "../components/controls/PillSelect";
import { Segmented } from "../components/controls/Segmented";
import { Slider } from "../components/controls/Slider";
import { Toggle } from "../components/controls/Toggle";
import type {
  FusionStrategy,
  RerankerDevice,
  Settings,
  SettingsPatch,
} from "../lib/api";

const TABS = ["Retrieval", "Model", "Indexing", "Web fallback", "Services"] as const;
type Tab = (typeof TABS)[number];

const DEFAULTS: Settings = {
  llm_model: "kimi-k2.6",
  embed_provider: "openai",
  embed_model: "bge-m3",
  embed_dim: 3072,
  retrieve_top_k: 50,
  rerank_top_k: 5,
  rrf_k: 60,
  enable_graph_retrieval: true,
  enable_contextual_retrieval: true,
  dense_enabled: true,
  sparse_enabled: true,
  fusion_strategy: "rrf",
  fusion_graph_weight: 0.4,
  fusion_vector_weight: 0.6,
  graph_depth: 2,
  graph_max_nodes: 60,
  rerank_score_floor: 0,
  adaptive_rerank: false,
  reranker_model: "BAAI/bge-reranker-v2-m3",
  reranker_device: "auto",
  web_fallback_min_chunks: 3,
  web_fallback_max_urls: 3,
};

interface Props {
  settings: Settings | null;
  onPatch: (patch: SettingsPatch) => Promise<Settings>;
  onClose: () => void;
}

const STRATEGY_LABEL: Record<FusionStrategy, string> = {
  rrf: "RRF",
  weighted: "Weighted",
  borda: "Borda",
};
const STRATEGY_LABELS = ["RRF", "Weighted", "Borda"] as const;
const STRATEGY_FROM_LABEL: Record<(typeof STRATEGY_LABELS)[number], FusionStrategy> = {
  RRF: "rrf",
  Weighted: "weighted",
  Borda: "borda",
};

export function SettingsPanel({ settings, onPatch, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("Retrieval");
  const [scope, setScope] = useState<"thread" | "global">("thread");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [draft, setDraft] = useState<Settings>(settings ?? DEFAULTS);
  useEffect(() => {
    if (settings) setDraft(settings);
  }, [settings]);

  const d = draft;
  const setIn = <K extends keyof Settings>(field: K, value: Settings[K]) => {
    setDraft((curr) => ({ ...curr, [field]: value }));
  };

  // The two weighted-fusion sliders work in 0..100 (UX), the backend stores 0..1.
  // Keep them coupled so they always sum to 1 — moving one auto-adjusts the other.
  const graphPct = Math.round(d.fusion_graph_weight * 100);
  const vectorPct = Math.round(d.fusion_vector_weight * 100);
  const setGraphPct = (pct: number) => {
    const g = Math.max(0, Math.min(100, pct));
    setDraft((curr) => ({
      ...curr,
      fusion_graph_weight: g / 100,
      fusion_vector_weight: (100 - g) / 100,
    }));
  };
  const setVectorPct = (pct: number) => {
    const v = Math.max(0, Math.min(100, pct));
    setDraft((curr) => ({
      ...curr,
      fusion_vector_weight: v / 100,
      fusion_graph_weight: (100 - v) / 100,
    }));
  };

  // Only send fields that actually changed — keeps the PATCH minimal and the
  // server log readable when someone touches just one knob.
  const patch = useMemo<SettingsPatch>(() => {
    if (!settings) return {};
    const out: SettingsPatch = {};
    const keys: (keyof SettingsPatch)[] = [
      "retrieve_top_k",
      "rerank_top_k",
      "rrf_k",
      "enable_graph_retrieval",
      "enable_contextual_retrieval",
      "dense_enabled",
      "sparse_enabled",
      "fusion_strategy",
      "fusion_graph_weight",
      "fusion_vector_weight",
      "graph_depth",
      "graph_max_nodes",
      "rerank_score_floor",
      "adaptive_rerank",
      "reranker_device",
      "web_fallback_min_chunks",
      "web_fallback_max_urls",
    ];
    for (const k of keys) {
      // @ts-expect-error - keyof Settings ⊃ keyof SettingsPatch by construction
      if (draft[k] !== settings[k]) out[k] = draft[k];
    }
    return out;
  }, [draft, settings]);

  const dirty = Object.keys(patch).length > 0;

  const apply = async () => {
    if (!dirty) {
      onClose();
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onPatch(patch);
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    if (settings) setDraft(settings);
    setErr(null);
  };

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
              {t === "Retrieval" && <span className="count">10</span>}
              {t === "Model" && <span className="count">4</span>}
              {t === "Web fallback" && <span className="count">3</span>}
            </span>
          ))}
        </div>

        <div className="drawer-body">
          {tab === "Retrieval" && (
            <>
              <div className="drawer-section">
                <div className="h">◗ hybrid retrieval</div>

                <KnobRow label="Dense (vector)" help={`${d.embed_provider} · ${d.embed_dim}-dim — Milvus ANN.`}>
                  <Toggle on={d.dense_enabled} onChange={(on) => setIn("dense_enabled", on)} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    {d.embed_provider} <span style={{ color: "var(--dim)" }}>·</span>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{d.embed_model}</span>{" "}
                    <span style={{ color: "var(--dim)" }}>·</span>{" "}
                    <span style={{ color: "var(--text-dim)" }}>{d.embed_dim}-dim</span>
                  </span>
                </KnobRow>

                <KnobRow label="Sparse (BM25)" help="Native to Milvus 2.6 — no separate index.">
                  <Toggle on={d.sparse_enabled} onChange={(on) => setIn("sparse_enabled", on)} />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    tokenizer <span style={{ color: "var(--text-dim)" }}>standard · en</span>
                  </span>
                </KnobRow>

                <KnobRow label="Graph traversal" help="Neo4j BFS from entity-linked seeds.">
                  <Toggle
                    on={d.enable_graph_retrieval}
                    onChange={(on) => setIn("enable_graph_retrieval", on)}
                  />
                  <NumInput
                    value={d.graph_depth}
                    min={1}
                    max={5}
                    onChange={(v) => setIn("graph_depth", v)}
                  />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>hops</span>
                  <NumInput
                    value={d.graph_max_nodes}
                    min={10}
                    max={500}
                    step={10}
                    onChange={(v) => setIn("graph_max_nodes", v)}
                  />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>max nodes</span>
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
                  ◗ fusion <span className="right">{STRATEGY_LABEL[d.fusion_strategy]} · k={d.rrf_k}</span>
                </div>
                <KnobRow
                  label="Strategy"
                  help="RRF works zero-config; weighted lets you tune the blend explicitly."
                >
                  <Segmented
                    options={STRATEGY_LABELS}
                    active={STRATEGY_LABEL[d.fusion_strategy]}
                    onChange={(label) =>
                      setIn(
                        "fusion_strategy",
                        STRATEGY_FROM_LABEL[label as (typeof STRATEGY_LABELS)[number]],
                      )
                    }
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
                  help="Used only when strategy = Weighted. Auto-balanced to sum to 1."
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
                      <Slider min={0} max={100} value={graphPct} suffix="%" onChange={setGraphPct} />
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
                        value={vectorPct}
                        suffix="%"
                        onChange={setVectorPct}
                      />
                    </div>
                  </div>
                </KnobRow>
              </div>

              <div className="drawer-section">
                <div className="h">◗ reranker</div>
                <KnobRow label="Model" help="Cross-encoder · runs on MPS / CUDA / CPU.">
                  <PillSelect v={d.reranker_model.replace(/^BAAI\//, "")} />
                  <Segmented
                    options={["auto", "mps", "cuda", "cpu"] as const}
                    active={d.reranker_device}
                    onChange={(dev) => setIn("reranker_device", dev as RerankerDevice)}
                  />
                </KnobRow>
                <KnobRow
                  label="Score floor"
                  help="Drop candidates below this raw rerank score before passing to LLM. 0 disables."
                >
                  <Slider
                    min={0}
                    max={1}
                    value={d.rerank_score_floor}
                    ticks={6}
                    onChange={(v) => setIn("rerank_score_floor", v)}
                  />
                </KnobRow>
                <KnobRow
                  label="Adaptive k_rerank"
                  help="Stop reranking once cumulative score-mass ≥ 0.85."
                >
                  <Toggle
                    on={d.adaptive_rerank}
                    onChange={(on) => setIn("adaptive_rerank", on)}
                  />
                  <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
                    {d.adaptive_rerank ? "on" : "off — using fixed k_rerank"}
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

          {tab === "Model" && (
            <div className="drawer-section">
              <div className="h">◗ generation model</div>
              <KnobRow label="LLM" help="Set via env LLM_MODEL — deploy required to change.">
                <PillSelect v={d.llm_model} />
              </KnobRow>
              <KnobRow label="Embeddings" help={`${d.embed_provider} · ${d.embed_dim}-dim`}>
                <PillSelect v={`${d.embed_provider}/${d.embed_model}`} />
              </KnobRow>
              <KnobRow label="Contextual prefixing" help="Prepend chunk summary to context.">
                <Toggle
                  on={d.enable_contextual_retrieval}
                  onChange={(on) => setIn("enable_contextual_retrieval", on)}
                />
              </KnobRow>
              <div style={{ color: "var(--muted)", fontSize: "11px", marginTop: "12px" }}>
                Model + embedding choices are deploy-time env vars; changing them needs a
                rebuild of the Milvus collection (dimension is baked into the schema).
              </div>
            </div>
          )}

          {tab === "Indexing" && (
            <div className="drawer-section">
              <div className="h">◗ indexing</div>
              <div style={{ color: "var(--muted)", fontSize: "11px", lineHeight: 1.6 }}>
                Indexing happens out-of-band — via{" "}
                <code className="mono">scripts/ingest.py</code> or the future
                <code className="mono"> POST /api/ingest</code> endpoint. The runtime
                knobs that affect indexed chunks (chunk size, contextual-retrieval prefix,
                embed model) are deploy-time configuration to keep the Milvus collection
                consistent across queries.
              </div>
            </div>
          )}

          {tab === "Web fallback" && (
            <div className="drawer-section">
              <div className="h">◗ web fallback details</div>
              <KnobRow
                label="Trigger threshold"
                help="Fewer than this many reranked chunks → web search + HITL approval."
              >
                <NumInput
                  value={d.web_fallback_min_chunks}
                  min={0}
                  max={20}
                  onChange={(v) => setIn("web_fallback_min_chunks", v)}
                />
              </KnobRow>
              <KnobRow label="URL budget" help="Max pages crawled per approval round.">
                <NumInput
                  value={d.web_fallback_max_urls}
                  min={1}
                  max={10}
                  onChange={(v) => setIn("web_fallback_max_urls", v)}
                />
              </KnobRow>
              <KnobRow label="Engine" help="Self-hosted searxng on the same host.">
                <PillSelect v="searxng" />
              </KnobRow>
            </div>
          )}

          {tab === "Services" && (
            <div className="drawer-section">
              <div className="h">◗ services</div>
              <div style={{ color: "var(--muted)", fontSize: "11px", lineHeight: 1.6 }}>
                Live status is in the top-bar service dots. This panel is for read-only
                inspection: ports, endpoints, and per-service health probes are surfaced
                in <code className="mono">GET /api/health</code> — open the network tab
                or hover the dots for latency.
              </div>
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
              patch failed — {err}
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
            <button
              className="btn ghost"
              type="button"
              onClick={reset}
              disabled={!dirty || busy}
            >
              {dirty ? `reset (${Object.keys(patch).length})` : "reset"}
            </button>
            <button
              className="btn warm"
              type="button"
              style={{
                background: dirty ? "var(--vector)" : "var(--bg-2)",
                color: dirty ? "#0a0612" : "var(--muted)",
                cursor: dirty ? "pointer" : "default",
              }}
              onClick={apply}
              disabled={busy}
            >
              {busy ? "applying…" : dirty ? "apply" : "no changes"}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
