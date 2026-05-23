import type { ServiceHealth } from "../lib/types";

interface Props {
  threadTitle: string;
  threadAge?: string;
  state?: "ok" | "streaming" | "hitl" | "error";
  corpusDocs?: number;
  corpusChunks?: number;
  health?: Partial<ServiceHealth>;
  onOpenSettings?: () => void;
  onOpenContext?: () => void;
}

const SERVICES: Array<keyof ServiceHealth> = [
  "milvus",
  "neo4j",
  "postgres",
  "searxng",
  "ollama",
  "openai",
];

export function TopBar({
  threadTitle,
  threadAge = "2m",
  state = "ok",
  corpusDocs = 42,
  corpusChunks = 1847,
  health = {},
  onOpenSettings,
  onOpenContext,
}: Props) {
  return (
    <div className="topbar">
      <div className="brand">
        <span className="brand-mark" />
        <span className="brand-name">
          sovereign<span className="dot">·</span>
          <span className="rag">rag</span>
        </span>
      </div>
      <div className="crumbs">
        <span>Ask</span>
        <span className="sep">/</span>
        <span className="cur">{threadTitle}</span>
        <span className="badge">THREAD · {threadAge}</span>
        {state === "streaming" && (
          <span
            className="badge"
            style={{
              color: "var(--vector)",
              borderColor: "color-mix(in oklab, var(--vector) 35%, var(--hair-strong))",
            }}
          >
            STREAMING
          </span>
        )}
        {state === "hitl" && (
          <span
            className="badge"
            style={{
              color: "var(--human)",
              borderColor: "color-mix(in oklab, var(--human) 40%, var(--hair-strong))",
            }}
          >
            NEEDS APPROVAL
          </span>
        )}
        {state === "error" && (
          <span
            className="badge"
            style={{
              color: "var(--err)",
              borderColor: "color-mix(in oklab, var(--err) 40%, var(--hair-strong))",
            }}
          >
            RETRY
          </span>
        )}
      </div>
      <div className="top-right">
        <span className="item">
          <span className="k">corpus</span>
          <span>{corpusDocs} docs</span>
          <span className="k">·</span>
          <span>{corpusChunks.toLocaleString()} chunks</span>
        </span>
        <span className="item health">
          <span className="k">services</span>
          {SERVICES.map((s) => {
            const st = health[s] ?? "ok";
            const cls = st === "ok" ? "pill" : `pill ${st}`;
            return <span key={s} className={cls} title={s} />;
          })}
        </span>
        <span className="item">
          <button className="icon-btn" title="Context window" onClick={onOpenContext}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="3" y="6" width="18" height="12" rx="1" />
              <path d="M3 10h18M7 6v12" />
            </svg>
          </button>
          <button className="icon-btn" title="Settings" onClick={onOpenSettings}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
            </svg>
          </button>
        </span>
      </div>
    </div>
  );
}
