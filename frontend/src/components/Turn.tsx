import type { ReactNode } from "react";
import type { Turn as TurnT } from "../lib/types";
import { renderAnswer } from "../lib/render-answer";

interface TurnProps {
  turn: TurnT;
  index: number;
  activeCitation?: number;
  onCitationClick?: (i: number) => void;
  /** Extra blocks rendered inside the assistant turn — e.g. the
   *  ApprovalCard, the PipelineStatus, the trace log. */
  extra?: ReactNode;
}

function fmtTime(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleTimeString([], { hour12: false });
  } catch {
    return iso;
  }
}

export function Turn({ turn, index, activeCitation, onCitationClick, extra }: TurnProps) {
  const num = String(index + 1).padStart(2, "0");
  const isUser = turn.role === "user";
  const tag = isUser ? "YOU" : "SR";
  const cls = `turn ${turn.role}`;
  return (
    <div className={cls}>
      <div className="gutter">
        <span className="num">{num}</span>
        <span className="tag">{tag}</span>
      </div>
      <div className="who">
        {isUser ? (
          <span>you · {fmtTime(turn.timestamp)}</span>
        ) : (
          <>
            <span className="name">
              sovereign<span className="rag">·rag</span>
            </span>
            <span style={{ color: "var(--muted)" }}>
              ·{" "}
              {turn.status === "streaming"
                ? "streaming…"
                : turn.status === "interrupted"
                  ? `paused at interrupt · ${fmtTime(turn.timestamp)}`
                  : `${fmtTime(turn.timestamp)}${
                      turn.ttf_ms ? ` · ${(turn.ttf_ms / 1000).toFixed(1)}s ttf` : ""
                    }${turn.total_ms ? ` · ${(turn.total_ms / 1000).toFixed(1)}s total` : ""}`}
            </span>
          </>
        )}
      </div>
      <div className="body">
        {isUser ? (
          <p>{turn.content}</p>
        ) : (
          renderAnswer(turn.content, {
            citations: turn.citations ?? [],
            activeIndex: activeCitation,
            streaming: turn.status === "streaming",
            onCitationClick,
          })
        )}
        {turn.status === "streaming" && !isUser && <span className="streaming-cursor" />}
      </div>
      {extra}
      {!isUser && turn.status !== "streaming" && (turn.retrieved ?? 0) > 0 && (
        <div className="turn-meta">
          <span>
            <span className="k">retrieved</span> <span className="v">{turn.retrieved}</span>
          </span>
          <span className="dot">·</span>
          <span>
            <span className="k">reranked</span> <span className="v">{turn.used}</span>
          </span>
          <span className="dot">·</span>
          <span>
            <span className="k">fusion</span> <span className="v">RRF · k=60</span>
          </span>
          {turn.fallback_used && (
            <>
              <span className="dot">·</span>
              <span>
                <span className="k">fallback</span>{" "}
                <span className="v" style={{ color: "var(--human)" }}>
                  ● used
                </span>
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
