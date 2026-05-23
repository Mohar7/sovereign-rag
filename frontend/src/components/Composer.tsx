import { useEffect, useRef } from "react";

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
  /** Used only when there is no value: shows a placeholder. The serif italic
   *  hint matches the design's empty-composer treatment. */
  placeholder?: string;
}

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
  placeholder = "Ask anything · indexed corpus + optional web fallback…",
}: Props) {
  const ta = useRef<HTMLTextAreaElement>(null);
  // Auto-resize the textarea like a real input.
  useEffect(() => {
    if (ta.current) {
      ta.current.style.height = "auto";
      ta.current.style.height = `${Math.min(ta.current.scrollHeight, 240)}px`;
    }
  }, [value]);

  const canSend = value.trim().length > 0 && state !== "streaming";

  return (
    <div className="composer">
      <div className="composer-shell">
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
          <div className="left">
            <button className="chip-btn with-dot" type="button">
              <span>{model}</span>
              <span className="lab">· 256k ctx</span>
              <span className="chev">▾</span>
            </button>
            <button className="chip-btn" type="button">
              <span className="lab">retrieve</span>
              <span>{retrieveK}</span>
              <span className="lab">/ rerank</span>
              <span>{rerankK}</span>
            </button>
            <button className="chip-btn" type="button">
              <span style={{ color: "var(--graph)" }}>◗</span>
              <span>graph</span>
              <span className="lab">{graphOn ? "on" : "off"}</span>
            </button>
            <button className="chip-btn" type="button">
              <span style={{ color: "var(--human)" }}>◗</span>
              <span>web fallback</span>
              <span className="lab">≥ {fallbackMin}</span>
            </button>
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
