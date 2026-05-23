interface Props {
  onSuggestion: (text: string) => void;
  /** Fired by the ASK suggestion cards. If provided, suggestions both fill the
   * composer and submit. Falls back to `onSuggestion` when omitted. */
  onAsk?: (text: string) => void;
  /** Fired by the INGEST suggestion card — caller opens the ingest sheet. */
  onIngest?: () => void;
  /** Fired by the WEB suggestion card — caller opens the web-search sheet. */
  onWeb?: () => void;
  corpus?: {
    docs: number;
    chunks: number;
    entities: number;
    relations: number;
    lastIndexed: string;
  };
}

const SUGGESTIONS: { kind: "ask" | "ingest" | "web"; text: string; kbd: string }[] = [
  {
    kind: "ask",
    text: '"Summarise what\'s been indexed about retrieval evaluation."',
    kbd: "⌘1",
  },
  {
    kind: "ask",
    text: '"Which protocols mention reciprocal rank fusion, and where?"',
    kbd: "⌘2",
  },
  {
    kind: "ingest",
    text: "Drop a PDF, URL, or paste raw text. Indexing runs in the background.",
    kbd: "⌘O · open file",
  },
  {
    kind: "web",
    text: "Run a web search and pick which results to ingest into the corpus.",
    kbd: "⌘⇧W",
  },
];

export function Empty({
  onSuggestion,
  onAsk,
  onIngest,
  onWeb,
  corpus = { docs: 42, chunks: 1847, entities: 312, relations: 1094, lastIndexed: "3m ago" },
}: Props) {
  const handleClick = (s: { kind: "ask" | "ingest" | "web"; text: string }) => {
    if (s.kind === "ask") {
      const clean = s.text.replace(/^"|"$/g, "");
      if (onAsk) onAsk(clean);
      else onSuggestion(clean);
      return;
    }
    if (s.kind === "ingest") onIngest?.();
    if (s.kind === "web") onWeb?.();
  };
  return (
    <div className="empty">
      <div className="mark">
        <span className="d1" />
        <span className="d2" />
      </div>
      <h1>Ask anything across your corpus.</h1>
      <div className="sub">
        Hybrid retrieval over{" "}
        <span style={{ color: "var(--graph)" }}>graph</span> +{" "}
        <span style={{ color: "var(--vector)" }}>vector</span>, reranked by cross-encoder, with
        inline citations back to the chunks the answer actually used. When local sources don't
        suffice, the system pauses and asks you which web pages to crawl.
      </div>

      <div className="empty-grid">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.text}
            className="suggestion"
            onClick={() => handleClick(s)}
          >
            <span className={`tag kind-${s.kind}`}>
              <span className="ic" /> {s.kind.toUpperCase()}
            </span>
            <span className="body-t">{s.text}</span>
            <span className="kbd">{s.kbd}</span>
          </button>
        ))}
      </div>

      <div className="corpus-stats">
        <span className="stat">
          <span className="k">corpus</span> <span className="v">{corpus.docs}</span>{" "}
          <span className="k">documents</span>
        </span>
        <span className="stat">
          <span className="k">·</span>
        </span>
        <span className="stat">
          <span className="v">{corpus.chunks.toLocaleString()}</span>{" "}
          <span className="k">chunks</span>
        </span>
        <span className="stat">
          <span className="k">·</span>
        </span>
        <span className="stat">
          <span className="v">{corpus.entities}</span> <span className="k">entities</span>
        </span>
        <span className="stat">
          <span className="k">·</span>
        </span>
        <span className="stat">
          <span className="v">{corpus.relations.toLocaleString()}</span>{" "}
          <span className="k">relations</span>
        </span>
        <span className="stat" style={{ marginLeft: "auto" }}>
          <span className="k">last index</span> <span className="v">{corpus.lastIndexed}</span>
        </span>
      </div>
    </div>
  );
}
