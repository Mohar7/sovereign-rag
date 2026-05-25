import { useEffect, useRef, useState } from "react";
import { Popover } from "./controls/Popover";
import { Slider } from "./controls/Slider";
import { Toggle } from "./controls/Toggle";

type PickerKey = "model" | "retrieve" | "graph" | "fallback" | null;

interface Props {
  value: string;
  onChange: (next: string) => void;
  onSubmit: () => void;
  onStop?: () => void;
  state: "idle" | "streaming";
  model?: string;
  retrieveK?: number;
  rerankK?: number;
  graphOn?: boolean;
  fallbackMin?: number;
  /** Models available in the picker. The current `model` should appear here too. */
  modelOptions?: { name: string; ctx: string; tag?: "local" | "remote" }[];
  onModelChange?: (next: string) => void;
  onRetrieveKChange?: (next: number) => void;
  onRerankKChange?: (next: number) => void;
  onGraphChange?: (next: boolean) => void;
  onFallbackChange?: (next: number) => void;
  placeholder?: string;
}

const DEFAULT_MODELS = [
  { name: "kimi-k2.6", ctx: "256k ctx", tag: "remote" as const },
  { name: "claude-opus-4.7", ctx: "200k ctx", tag: "remote" as const },
  { name: "llama-3.3-70b", ctx: "128k ctx", tag: "local" as const },
  { name: "qwen-2.5-72b", ctx: "128k ctx", tag: "local" as const },
];

export function Composer({
  value,
  onChange,
  onSubmit,
  onStop,
  state,
  model = "kimi-k2.6",
  retrieveK = 50,
  rerankK = 5,
  graphOn = true,
  fallbackMin = 3,
  modelOptions = DEFAULT_MODELS,
  onModelChange,
  onRetrieveKChange,
  onRerankKChange,
  onGraphChange,
  onFallbackChange,
  placeholder = "Ask anything · indexed corpus + optional web fallback…",
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState<PickerKey>(null);
  useEffect(() => {
    if (ta.current) {
      ta.current.style.height = "auto";
      ta.current.style.height = `${Math.min(ta.current.scrollHeight, 240)}px`;
    }
  }, [value]);

  const canSend = value.trim().length > 0 && state !== "streaming";
  const toggle = (k: PickerKey) => setOpen((cur) => (cur === k ? null : k));
  const close = () => setOpen(null);

  const ctx = modelOptions.find((m) => m.name === model)?.ctx ?? "256k ctx";

  return (
    <div className="composer">
      <div className="composer-shell" style={{ position: "relative" }}>
        <textarea
          ref={ta}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && canSend) {
              e.preventDefault();
              onSubmit();
            }
          }}
          rows={1}
          spellCheck={false}
        />
        <div className="composer-bar">
          <div className="left" style={{ position: "relative" }}>
            <button
              className={`chip-btn with-dot ${open === "model" ? "open" : ""}`}
              type="button"
              onClick={() => toggle("model")}
            >
              <span>{model}</span>
              <span className="lab">· {ctx}</span>
              <span className="chev">▾</span>
            </button>
            <button
              className={`chip-btn ${open === "retrieve" ? "open" : ""}`}
              type="button"
              onClick={() => toggle("retrieve")}
            >
              <span className="lab">retrieve</span>
              <span>{retrieveK}</span>
              <span className="lab">/ rerank</span>
              <span>{rerankK}</span>
              <span className="chev">▾</span>
            </button>
            <button
              className={`chip-btn ${open === "graph" ? "open" : ""}`}
              type="button"
              onClick={() => toggle("graph")}
            >
              <span style={{ color: "var(--graph)" }}>◗</span>
              <span>graph</span>
              <span className="lab">{graphOn ? "on" : "off"}</span>
              <span className="chev">▾</span>
            </button>
            <button
              className={`chip-btn ${open === "fallback" ? "open" : ""}`}
              type="button"
              onClick={() => toggle("fallback")}
            >
              <span style={{ color: "var(--human)" }}>◗</span>
              <span>web fallback</span>
              <span className="lab">≥ {fallbackMin}</span>
              <span className="chev">▾</span>
            </button>

            {open === "model" && (
              <Popover
                header="model · per question"
                pointer
                pointerOffset={22}
                className="model-dd"
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 0,
                  width: 340,
                  zIndex: 30,
                }}
                onClose={close}
              >
                {modelOptions.map((m) => (
                  <div
                    key={m.name}
                    className={`model-row ${m.name === model ? "selected" : ""}`}
                    onClick={() => {
                      onModelChange?.(m.name);
                      close();
                    }}
                  >
                    <span className="radio" />
                    <span>
                      <span className="name">{m.name}</span>
                      <div className="meta">
                        <span className="v">{m.ctx}</span>
                      </div>
                    </span>
                    {m.tag && (
                      <span className={`badge ${m.tag === "remote" ? "remote" : ""}`}>
                        {m.tag}
                      </span>
                    )}
                  </div>
                ))}
              </Popover>
            )}

            {open === "retrieve" && (
              <Popover
                header="retrieval · k"
                pointer
                pointerOffset={86}
                className="compact-sliders"
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 120,
                  width: 360,
                  zIndex: 30,
                }}
                onClose={close}
                footer={
                  <button
                    className="btn ghost"
                    style={{ marginLeft: "auto", fontSize: 10, padding: "3px 8px" }}
                    onClick={close}
                  >
                    done
                  </button>
                }
              >
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" }}>
                    k_retrieve
                  </div>
                  <Slider
                    min={1}
                    max={100}
                    value={retrieveK}
                    ticks={5}
                    onChange={onRetrieveKChange}
                    bubble
                  />
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" }}>
                    k_rerank
                  </div>
                  <Slider
                    min={1}
                    max={Math.max(32, retrieveK)}
                    value={rerankK}
                    ticks={5}
                    onChange={onRerankKChange}
                    bubble
                  />
                </div>
              </Popover>
            )}

            {open === "graph" && (
              <Popover
                header="graph retrieval"
                pointer
                pointerOffset={42}
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 290,
                  width: 240,
                  zIndex: 30,
                }}
                onClose={close}
              >
                <div
                  style={{
                    padding: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11.5,
                    color: "var(--text)",
                  }}
                >
                  <span>enable neo4j path</span>
                  <Toggle on={graphOn} onChange={onGraphChange} />
                </div>
              </Popover>
            )}

            {open === "fallback" && (
              <Popover
                header="web fallback"
                pointer
                pointerOffset={48}
                className="compact-sliders"
                style={{
                  position: "absolute",
                  bottom: "calc(100% + 8px)",
                  left: 380,
                  width: 300,
                  zIndex: 30,
                }}
                onClose={close}
                footer={
                  <button
                    className="btn ghost"
                    style={{ marginLeft: "auto", fontSize: 10, padding: "3px 8px" }}
                    onClick={close}
                  >
                    done
                  </button>
                }
              >
                <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "var(--muted)" }}>
                    trigger when retrieved &lt;
                  </div>
                  <Slider
                    min={0}
                    max={10}
                    value={fallbackMin}
                    ticks={6}
                    onChange={onFallbackChange}
                    bubble
                  />
                  <div style={{ fontSize: 10, color: "var(--muted)" }}>
                    {fallbackMin === 0
                      ? "disabled · never fall back to web"
                      : `fall back when fewer than ${fallbackMin} relevant chunks`}
                  </div>
                </div>
              </Popover>
            )}
          </div>
          <div className="right">
            {state === "streaming" ? (
              <button className="stop-btn" type="button" onClick={onStop}>
                stop
              </button>
            ) : (
              <button
                className="send-btn"
                type="button"
                onClick={onSubmit}
                disabled={!canSend}
              >
                <span>send</span>
                <span className="kbd">↵</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
