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
import { useCorpusStats, useHealth, useSettings } from "../hooks/useCorpus";

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

        {(tab === "Ingest" || tab === "Theme" || tab === "Keyboard" || tab === "Security" || tab === "About") && (
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
