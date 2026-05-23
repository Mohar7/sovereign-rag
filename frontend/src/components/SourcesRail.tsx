import type { ReactNode } from "react";

interface Props {
  title?: string;
  count: number;
  retrieved: number;
  used: number;
  children: ReactNode;
  /** Show "fusion" footer chip on the right of the stats row. */
  showFusion?: boolean;
  /** Optional inspector handler — wired to the ⚙ INSPECT link in the head. */
  onInspect?: () => void;
}

export function SourcesRail({
  title = "Sources cited",
  count,
  retrieved,
  used,
  children,
  showFusion = true,
  onInspect,
}: Props) {
  return (
    <aside className="sources">
      <div className="rail-head">
        <span>
          {title} <span className="count">· {count}</span>
        </span>
        <span
          className="add"
          title="Inspector"
          role={onInspect ? "button" : undefined}
          tabIndex={onInspect ? 0 : undefined}
          onClick={onInspect}
          onKeyDown={(e) => {
            if (onInspect && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              onInspect();
            }
          }}
        >
          ⚙ INSPECT
        </span>
      </div>
      <div className="sources-stats">
        <span>
          <span className="k">retrieved</span> <span className="v">{retrieved}</span>
        </span>
        <span>
          <span className="k">reranked</span> <span className="v">{used}</span>
        </span>
        {showFusion && (
          <span className="fusion">
            <span className="k" style={{ color: "var(--dim)" }}>
              fusion
            </span>{" "}
            RRF · k=60
          </span>
        )}
      </div>
      <div style={{ padding: "10px 14px 0" }}>
        <div className="legend">
          <span className="key">
            <span className="swatch graph" /> graph
          </span>
          <span className="key">
            <span className="swatch vector" /> vector
          </span>
          <span className="key">
            <span className="swatch web" /> web
          </span>
        </div>
      </div>
      <div className="sources-list">{children}</div>
    </aside>
  );
}
