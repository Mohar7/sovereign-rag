import type { Citation, CitationKind } from "../lib/types";
import { CitationChip } from "./CitationChip";

interface Props {
  n: number;
  citation: Citation;
  kind?: CitationKind;
  active?: boolean;
  onClick?: () => void;
}

function splitUri(uri: string): { scheme: string; path: string; type: "web" | "pdf" | "notes" } {
  const sIdx = uri.indexOf("://");
  if (sIdx === -1) return { scheme: "", path: uri, type: "notes" };
  const scheme = uri.slice(0, sIdx + 3);
  const path = uri.slice(sIdx + 3);
  let type: "web" | "pdf" | "notes" = "notes";
  if (scheme.startsWith("http")) type = "web";
  else if (path.endsWith(".pdf") || scheme === "corpus://") type = "pdf";
  return { scheme, path, type };
}

const RETRIEVAL_LABEL: Record<CitationKind, string> = {
  hybrid: "vector + graph",
  graph: "graph",
  vector: "vector",
  web: "web (crawl)",
};

export function SourceCard({ n, citation, kind, active, onClick }: Props) {
  const { scheme, path, type } = splitUri(citation.source_uri);
  const chipKind: CitationKind = kind ?? (type === "web" ? "web" : "hybrid");
  const cardCls = `source-card${active ? " active" : ""}${type === "web" ? " web" : ""}`;
  return (
    <article className={cardCls} onClick={onClick}>
      <div className="sc-top">
        <CitationChip n={n} kind={chipKind} />
        <span className={`type ${type}`}>{type}</span>
        <span className="score-bar">
          <span className="track">
            <span
              className={`fill${type === "web" ? " web" : ""}`}
              style={{ width: `${Math.max(0, Math.min(1, citation.score)) * 100}%` }}
            />
          </span>
          <span>{citation.score.toFixed(3)}</span>
        </span>
      </div>
      <div className="sc-title">{citation.title || "untitled"}</div>
      <div className="sc-uri">
        <span className="scheme">{scheme}</span>
        <span className="path">{path}</span>
        <span
          className="copy"
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard?.writeText(citation.source_uri).catch(() => {});
          }}
        >
          ⧉
        </span>
      </div>
      <div className="sc-snippet">
        {citation.snippet}
        <span className="ell"> …</span>
      </div>
      <div className="sc-foot">
        {citation.page != null && (
          <>
            <span>
              <span className="k">p.</span> <span className="v">{citation.page}</span>
            </span>
            <span className="sep">·</span>
          </>
        )}
        <span>
          <span className="k">retrieval</span>{" "}
          <span className="v">{RETRIEVAL_LABEL[chipKind]}</span>
        </span>
        <span className="sep">·</span>
        <span>
          <span className="k">chunk</span>{" "}
          <span className="v">{citation.chunk_id.slice(0, 8)}</span>
        </span>
        <span className="open">
          open <span className="arrow">→</span>
        </span>
      </div>
    </article>
  );
}
