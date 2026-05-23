// /components route — atomic interactive primitives sheet.
// Static showcase of every reusable control + a few composed popovers,
// arranged on a single scrollable canvas. Useful as portfolio asset and
// as a visual smoke for the design system.

import { useState } from "react";
import { CitationChip } from "./components/CitationChip";
import { KnobRow } from "./components/controls/KnobRow";
import { NumInput } from "./components/controls/NumInput";
import { PillSelect } from "./components/controls/PillSelect";
import { Segmented } from "./components/controls/Segmented";
import { Slider } from "./components/controls/Slider";
import { Toggle } from "./components/controls/Toggle";

interface BlockProps {
  num: string;
  name: string;
  sub?: string;
  children: React.ReactNode;
}

function Block({ num, name, sub, children }: BlockProps) {
  return (
    <div className="cs-block">
      <div className="cs-head">
        <span className="num">{num}</span>
        <span className="name">{name}</span>
        {sub && (
          <span style={{ color: "var(--muted)", marginLeft: "auto", fontSize: "9.5px" }}>
            {sub}
          </span>
        )}
      </div>
      <div className="cs-stage">{children}</div>
    </div>
  );
}

export function ComponentsSheet() {
  const [toggleOn, setToggleOn] = useState(true);
  const [seg, setSeg] = useState<"thread" | "global">("thread");
  const [slider, setSlider] = useState(50);
  const [num, setNum] = useState(3);

  return (
    <div className="compsheet">
      <div
        style={{
          gridColumn: "1 / -1",
          padding: "16px 8px 4px 8px",
          fontFamily: "var(--font-mono)",
          color: "var(--text)",
        }}
      >
        <div style={{ fontSize: "18px", fontFamily: "var(--font-serif)", fontStyle: "italic" }}>
          sovereign·rag · interactive primitives
        </div>
        <div style={{ fontSize: "11px", color: "var(--muted)", marginTop: "6px" }}>
          IBM Plex Mono chrome · IBM Plex Serif prose · graph-blue + vector-lavender accent system ·
          all atoms reusable across the five feature panels
        </div>
      </div>

      {/* 01 — citation chip + hover popover */}
      <Block num="01" name="Citation · hover popover" sub="appears on chip hover">
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: "13px",
            color: "var(--text-dim)",
            lineHeight: 1.55,
          }}
        >
          …fused with{" "}
          <span className="kw" style={{ color: "var(--vector)" }}>
            Reciprocal Rank Fusion
          </span>{" "}
          <CitationChip n={2} kind="vector" active />, at <code className="mono">k = 60</code> by default.
        </div>
        <div className="popover cite-pop" style={{ marginTop: "20px" }}>
          <div className="popover-head">
            <span>◗ source · 02</span>
            <span style={{ color: "var(--vector)" }}>vector</span>
            <span className="right">rerank 0.961</span>
          </div>
          <div className="cite-line">
            <CitationChip n={2} kind="vector" />
            <span style={{ fontFamily: "var(--font-mono)", fontSize: "11.5px", color: "var(--text)", fontWeight: 500 }}>
              RRF outperforms Condorcet (Cormack 2009)
            </span>
          </div>
          <div className="cite-meta">
            corpus://rrf-paper.pdf <span style={{ color: "var(--dim)" }}>·</span> page 3{" "}
            <span style={{ color: "var(--dim)" }}>·</span> chunk 595deda9
          </div>
          <div className="cite-snip">
            "…the constant k is set to 60 in our experiments — it dampens low-ranked candidates while
            preserving agreement signal."
          </div>
          <div className="cite-actions">
            <button className="chip-btn">⌖ pin</button>
            <button className="chip-btn">↗ open</button>
            <button className="chip-btn" style={{ marginLeft: "auto" }}>
              … more
            </button>
          </div>
        </div>
      </Block>

      {/* 02 — model picker */}
      <Block num="02" name="Model picker" sub="composer dropdown · selected">
        <button className="chip-btn with-dot" style={{ alignSelf: "flex-start" }}>
          <span>kimi-k2.6</span>
          <span className="lab">· 256k ctx</span>
          <span className="chev">▾</span>
        </button>
        <div className="popover model-dd">
          <div className="popover-head">◗ generation model</div>
          {[
            { name: "kimi-k2.6", meta: "via ollama · 256k ctx · 52 tok/s", badge: "cloud · warm", selected: true },
            { name: "deepseek-v4-pro", meta: "via ollama cloud · 128k ctx · 38 tok/s", badge: "cloud", selected: false },
            { name: "claude-haiku-4.5", meta: "anthropic · 200k ctx · 141 tok/s", badge: "remote", remote: true, selected: false },
            { name: "qwen3-coder-32b", meta: "via ollama · 128k ctx · cold · 9s warmup", badge: "local", selected: false },
          ].map((m) => (
            <div key={m.name} className={`model-row ${m.selected ? "selected" : ""}`}>
              <span className="radio" />
              <div>
                <div className="name">{m.name}</div>
                <div className="meta">{m.meta}</div>
              </div>
              <span className={`badge ${m.remote ? "remote" : ""}`}>{m.badge}</span>
            </div>
          ))}
        </div>
      </Block>

      {/* 03 — toggle */}
      <Block num="03" name="Toggle" sub="binary, controlled">
        <KnobRow label="Graph traversal" help="Neo4j BFS from entity-linked seeds.">
          <Toggle on={toggleOn} onChange={setToggleOn} />
          <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>
            {toggleOn ? "on · depth 2 · max 60 nodes" : "off — vector + BM25 only"}
          </span>
        </KnobRow>
      </Block>

      {/* 04 — segmented */}
      <Block num="04" name="Segmented control" sub="3-up choice">
        <KnobRow label="Scope" help="Settings here apply to either the active thread or globally.">
          <Segmented
            options={["thread", "global"] as const}
            active={seg}
            onChange={setSeg}
          />
        </KnobRow>
      </Block>

      {/* 05 — slider */}
      <Block num="05" name="Slider" sub="linear, with ticks">
        <KnobRow label="k_retrieve" help="Candidates per retriever before fusion.">
          <Slider min={10} max={200} value={slider} onChange={setSlider} />
        </KnobRow>
      </Block>

      {/* 06 — num input */}
      <Block num="06" name="Number input" sub="step buttons">
        <KnobRow label="URL budget" help="Maximum pages to crawl per approval round.">
          <NumInput value={num} min={1} max={10} onChange={setNum} />
          <span style={{ color: "var(--muted)", fontSize: "10.5px" }}>per round</span>
        </KnobRow>
      </Block>

      {/* 07 — pill select */}
      <Block num="07" name="Pill select" sub="opens a popover">
        <KnobRow label="Reranker">
          <PillSelect v="bge-reranker-v2-m3" />
          <PillSelect k="device" v="MPS" />
        </KnobRow>
      </Block>

      {/* 08 — buttons */}
      <Block num="08" name="Buttons" sub="ghost · warm · stop · send">
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          <button className="btn ghost">reset to defaults</button>
          <button className="btn warm" style={{ background: "var(--human)", color: "#1a0e06" }}>
            crawl &amp; continue →
          </button>
          <button className="btn warm" style={{ background: "var(--vector)", color: "#0a0612" }}>
            apply
          </button>
          <button className="send-btn">
            <span>send</span>
            <span className="kbd">↵</span>
          </button>
          <button className="stop-btn">stop</button>
        </div>
      </Block>

      {/* 09 — citation chip variants */}
      <Block num="09" name="Citation chips" sub="hybrid / vector / graph / web · active · streaming">
        <div style={{ display: "flex", gap: "10px", alignItems: "center", flexWrap: "wrap" }}>
          <CitationChip n={1} kind="hybrid" />
          <CitationChip n={2} kind="vector" />
          <CitationChip n={3} kind="graph" />
          <CitationChip n={4} kind="web" />
          <CitationChip n={5} kind="hybrid" active />
          <CitationChip n={6} kind="vector" streaming />
        </div>
      </Block>

      {/* 10 — entities + relations */}
      <Block num="10" name="Entities · graph relations" sub="from Neo4j knowledge graph">
        <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: "12px" }}>
          <span className="entity">
            <span className="kind">algo</span>Reciprocal Rank Fusion
          </span>
          <span className="entity">
            <span className="kind">algo</span>CombSUM
          </span>
          <span className="entity">
            <span className="kind">org</span>TREC
          </span>
          <span className="entity">
            <span className="kind">person</span>Cormack G.
          </span>
          <span className="entity">
            <span className="kind">var</span>k = 60
          </span>
        </div>
        <div className="relation">
          <span className="ent">Reciprocal Rank Fusion</span>
          <span className="pred">cited by</span>
          <span className="ent">Milvus 2.6 docs</span>
        </div>
        <div className="relation">
          <span className="ent">k = 60</span>
          <span className="pred">default in</span>
          <span className="ent">Milvus / Vespa / Weaviate</span>
        </div>
      </Block>
    </div>
  );
}
