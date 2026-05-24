// Top bar for non-Ask top-level screens.
//
// Renders the brand mark, a breadcrumb (`Section / Page · COUNT`), and
// either a `right` slot or the default corpus/services badge cluster. The
// CSS for `.app .topbar` makes it span columns 2-from-end so it sits flush
// with the filter rail and main pane.

import type { ReactNode } from "react";
import type { CorpusStats, ServiceStatus } from "../lib/api";

type ServiceMap = Partial<Record<string, ServiceStatus["state"]>>;

function defaultRight(corpus: CorpusStats | null, health: ServiceMap | null): ReactNode {
  return (
    <>
      <span className="item">
        <span className="k">corpus</span>
        <span>{corpus?.documents ?? "—"} docs</span>
        <span className="k">·</span>
        <span>{corpus?.chunks?.toLocaleString() ?? "—"} chunks</span>
      </span>
      <span className="item health">
        <span className="k">services</span>
        {(["milvus", "neo4j", "postgres", "searxng", "ollama", "openai"] as const).map((s) => {
          const st = health?.[s];
          const cls = st === "ok" ? "" : st === "warn" ? "warn" : st === "err" ? "err" : "";
          return <span key={s} className={`pill ${cls}`} title={s} />;
        })}
      </span>
    </>
  );
}

interface Props {
  section: string;
  page?: string | null;
  count?: number | null;
  /** Caller-supplied right side; falls back to the corpus + services strip. */
  right?: ReactNode;
  /** Used by `defaultRight` when `right` isn't provided. */
  corpus?: CorpusStats | null;
  health?: ServiceMap | null;
}

export function AppTopBar({ section, page, count, right, corpus = null, health = null }: Props) {
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
        <span>{section}</span>
        {page && (
          <>
            <span className="sep">/</span>
            <span className="cur">{page}</span>
          </>
        )}
        {count != null && <span className="badge">{count.toLocaleString()} ITEMS</span>}
      </div>
      <div className="top-right">{right ?? defaultRight(corpus, health)}</div>
    </div>
  );
}
