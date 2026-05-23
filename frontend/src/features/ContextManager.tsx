// Context manager — drawer-right with:
//   - segmented context-window meter (sys / turns / chunks / tools)
//   - pinned chunks (survive summarisation)
//   - this-turn chunks (evicted on next turn) with pin/exclude controls
//   - postgres checkpoint timeline
//
// Visual-only for now — pin/exclude/revert don't mutate state on the
// backend yet (would need a new `/threads/{id}/context` endpoint).

import { CitationChip } from "../components/CitationChip";

interface Props {
  onClose: () => void;
}

interface CtxItem {
  num: string;
  cite: number;
  kind: "hybrid" | "vector" | "graph" | "web";
  title: string;
  snip: string;
  tokens: number;
  meta: string;
  excluded?: boolean;
}

const PINNED: CtxItem[] = [
  {
    num: "01",
    cite: 1,
    kind: "hybrid",
    title: "Milvus 2.6 — Hybrid Search",
    snip:
      '"A single hybrid_search call can issue both dense ANN and BM25 sub-queries…"',
    tokens: 684,
    meta: "chunk 0f69e9bf · vec + graph",
  },
  {
    num: "02",
    cite: 2,
    kind: "vector",
    title: "RRF — Cormack et al. 2009",
    snip:
      '"The RRF score for a document d under rankings R is the sum over r ∈ R of 1 / (k + r(d))."',
    tokens: 512,
    meta: "chunk 595deda9 · vector",
  },
];

const TURN: CtxItem[] = [
  {
    num: "03",
    cite: 3,
    kind: "hybrid",
    title: "Hybrid Retrieval — internal notes",
    snip:
      '"We chose Milvus\'s native hybrid over a Pinecone-side BM25 because the second index would double our ingest cost…"',
    tokens: 594,
    meta: "rerank 0.847",
  },
  {
    num: "04",
    cite: 4,
    kind: "web",
    title: "Vespa blog · RRF tuning in production",
    snip:
      '"Practitioners tend to lower k when the dense retriever is dominant…"',
    tokens: 688,
    meta: "rerank 0.812 · web fallback",
  },
  {
    num: "05",
    cite: 5,
    kind: "graph",
    title: "TREC-DL 2023 — Rank fusion baselines",
    snip: '"Across 43 runs submitted to TREC-DL 2023, RRF with k ∈ [40, 80]…"',
    tokens: 580,
    meta: "excluded · contradicts user preference",
    excluded: true,
  },
];

const CHECKPOINTS = [
  { label: "Initial run — q01", sub: "14:22:08 · system + turn 1 user · 412 tok", current: false },
  { label: "After first answer — q01.a", sub: "14:22:12 · + 5 chunks + assistant · 3,890 tok", current: false },
  { label: "Turn 2 user — q02", sub: "14:24:51 · 3,948 tok", current: false },
  { label: "Current — q02.a", sub: "14:24:55 · web fallback · 6,328 tok", current: true },
];

function CtxRow({ item }: { item: CtxItem }) {
  const cls = ["ctx-item"];
  if (item.excluded) cls.push("excluded");
  return (
    <div className={cls.join(" ")}>
      <span className="num">{item.num}</span>
      <div className="body">
        <div className="title">
          <CitationChip n={item.cite} kind={item.kind} /> {item.title}
        </div>
        <div className="snip">{item.snip}</div>
        <div className="meta">
          <span className="k">tok</span>
          <span className="v">{item.tokens}</span>
          <span className="k">·</span>
          <span style={{ color: item.excluded ? "var(--err)" : undefined }}>{item.meta}</span>
        </div>
      </div>
      <div className="actions">
        <button className="act" title="Pin">
          ⌖
        </button>
        <button className={`act ${item.excluded ? "excl" : ""}`} title="Exclude">
          ✕
        </button>
      </div>
    </div>
  );
}

export function ContextManager({ onClose }: Props) {
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
            thread <span style={{ color: "var(--text-dim)" }}>01 · milvus hybrid search</span>
          </span>
          <button className="close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="drawer-body">
          <div className="context-meter">
            <div className="top">
              <span className="total">6,328</span>
              <span className="cap">/ 256,000 tok</span>
              <span className="pct">2.47% used · headroom 96.1%</span>
            </div>
            <div className="bar">
              <span className="seg sys" style={{ width: "6%" }} />
              <span className="seg turns" style={{ width: "38%" }} />
              <span className="seg chunks" style={{ width: "49%" }} />
              <span className="seg tools" style={{ width: "7%" }} />
              <span className="seg budget" style={{ flex: 1 }} />
            </div>
            <div className="legend">
              <span className="key">
                <span className="sw" style={{ background: "var(--muted)" }} /> system{" "}
                <span className="v">412</span>
              </span>
              <span className="key">
                <span className="sw" style={{ background: "var(--text-dim)" }} /> turns · 4{" "}
                <span className="v">2,387</span>
              </span>
              <span className="key">
                <span className="sw" style={{ background: "var(--vector)" }} /> chunks · 5{" "}
                <span className="v">3,058</span>
              </span>
              <span className="key">
                <span className="sw" style={{ background: "var(--graph)" }} /> tools{" "}
                <span className="v">471</span>
              </span>
            </div>
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ pinned chunks <span className="count">· {PINNED.length}</span>{" "}
              <span className="right" style={{ color: "var(--text-dim)" }}>
                survive summarisation
              </span>
            </div>
            {PINNED.map((p) => (
              <div key={p.num} className="ctx-item pinned">
                <span className="num">{p.num}</span>
                <div className="body">
                  <div className="title">
                    <CitationChip n={p.cite} kind={p.kind} /> {p.title}
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
                  <button className="act on" title="Pinned">
                    ●
                  </button>
                  <button className="act" title="View">
                    ↗
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ this turn's chunks <span className="count">· {TURN.length}</span>{" "}
              <span className="right" style={{ color: "var(--muted)" }}>
                evicted on next turn
              </span>
            </div>
            {TURN.map((t) => (
              <CtxRow key={t.num} item={t} />
            ))}
          </div>

          <div className="drawer-section">
            <div className="h">
              ◗ checkpoints <span className="count">· {CHECKPOINTS.length}</span>{" "}
              <span className="right" style={{ color: "var(--text-dim)" }}>
                postgres
              </span>
            </div>
            {CHECKPOINTS.map((c, i) => (
              <div key={i} className={`checkpoint ${c.current ? "current" : ""}`}>
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
                <button className="revert">{c.current ? "stay" : "revert"}</button>
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
            <button className="btn ghost" type="button">
              summarise now
            </button>
            <button className="btn ghost" type="button">
              clear non-pinned
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
