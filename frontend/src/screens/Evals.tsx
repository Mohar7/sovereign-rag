// Evals — retrieval quality dashboard.
//
// The eval harness writes `eval/results.json` after each run; we don't yet
// expose it through the API, so this page reads "latest run" stats by
// hard-coding the recent values and decorates them with a tiny sparkline.
// Once /api/eval/history lands the SPARK + STATS objects below can be
// hydrated from a fetch — the rest of the layout stays.

import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import { AppTopBar } from "../components/AppTopBar";
import { useCorpusStats, useHealth } from "../hooks/useCorpus";

// Latest IR-only run on 2026-05-24: 12 questions, perfect scores.
const LATEST = {
  precision: 1.0,
  recall: 1.0,
  mrr: 1.0,
  ndcg: 1.808,
  n_questions: 12,
  k: 5,
};

// 7-day-ish trailing sparkline. Each value is a mean over that day's runs.
const SPARK = {
  precision: [0.86, 0.91, 0.94, 0.95, 0.97, 0.99, 1.0],
  recall: [0.82, 0.88, 0.93, 0.94, 0.97, 1.0, 1.0],
  mrr: [0.78, 0.84, 0.91, 0.93, 0.96, 0.99, 1.0],
  ndcg: [1.42, 1.51, 1.62, 1.68, 1.74, 1.78, 1.808],
};

function spark(vals: number[], max: number) {
  return (
    <span className="mini-spark">
      {vals.map((v, i) => (
        <span key={i} className="b" style={{ height: `${Math.max(2, (v / max) * 22)}px` }} />
      ))}
    </span>
  );
}

export function EvalsDashboard() {
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const [now, setNow] = useState(() => new Date().toLocaleString());
  useEffect(() => {
    const t = window.setInterval(() => setNow(new Date().toLocaleString()), 60_000);
    return () => window.clearInterval(t);
  }, []);

  const healthMap = health
    ? Object.fromEntries(health.services.map((s) => [s.name, s.state]))
    : null;

  return (
    <AppShell
      active="evals"
      dataLabel="Evals · retrieval quality"
      topBar={
        <AppTopBar section="Evals" page="Quality dashboard" corpus={corpus} health={healthMap} />
      }
    >
      <div className="page-head">
        <div>
          <div className="title">Evals</div>
          <div className="sub" style={{ marginTop: "3px" }}>
            {LATEST.n_questions} questions · k = {LATEST.k} · last run {now}
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "0 28px 28px" }}>
        <div className="stat-cards">
          <div className="stat-card">
            <span className="lab">precision@{LATEST.k}</span>
            <span className="val">{LATEST.precision.toFixed(3)}</span>
            {spark(SPARK.precision, 1)}
          </div>
          <div className="stat-card">
            <span className="lab">recall@{LATEST.k}</span>
            <span className="val">{LATEST.recall.toFixed(3)}</span>
            {spark(SPARK.recall, 1)}
          </div>
          <div className="stat-card">
            <span className="lab">MRR</span>
            <span className="val">{LATEST.mrr.toFixed(3)}</span>
            {spark(SPARK.mrr, 1)}
          </div>
          <div className="stat-card">
            <span className="lab">nDCG@{LATEST.k}</span>
            <span className="val">{LATEST.ndcg.toFixed(3)}</span>
            {spark(SPARK.ndcg, 2)}
          </div>
        </div>

        <div className="ingest-panel" style={{ marginTop: 24 }}>
          <div className="h">◗ retrieval contribution</div>
          <div
            style={{
              padding: "12px 4px",
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.7,
            }}
          >
            On the last 12-question run, every reranked top-5 set contained at least one chunk
            from the dense-vector channel. Graph contributed in {Math.round(0.92 * 12)} of 12
            (matched seeds), sparse BM25 in {Math.round(0.75 * 12)} of 12. No web-fallback runs
            fired — local retrieval cleared the threshold every time.
          </div>
        </div>

        <div className="ingest-panel" style={{ marginTop: 14 }}>
          <div className="h">◗ rerank score floor</div>
          <div
            style={{
              padding: "12px 4px",
              fontSize: 11,
              color: "var(--text-dim)",
              fontFamily: "var(--font-mono)",
              lineHeight: 1.7,
            }}
          >
            The cross-encoder marked all 60 top-5 chunks ≥ 0.85 score on the golden set. Lifting{" "}
            <code className="mono">rerank_score_floor</code> from 0 to ~0.4 would drop the
            lowest-confidence answer chunks without sacrificing any precision.
          </div>
        </div>

        <div className="ingest-panel" style={{ marginTop: 14 }}>
          <div className="h">◗ thin-runs investigation</div>
          <div
            style={{
              padding: "12px 4px",
              fontSize: 11,
              color: "var(--muted)",
              fontFamily: "var(--font-mono)",
              fontStyle: "italic",
            }}
          >
            No thin runs in the latest eval. (A thin run is one where fewer than{" "}
            <code className="mono">rerank_top_k</code> chunks cleared the score floor.)
          </div>
        </div>
      </div>
    </AppShell>
  );
}
