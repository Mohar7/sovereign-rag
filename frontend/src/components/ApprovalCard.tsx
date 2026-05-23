import { useState } from "react";
import type { CandidateURL } from "../lib/types";

interface Props {
  question: string;
  candidates: CandidateURL[];
  budget?: number;
  onSkip: () => void;
  onApprove: (approvedUrls: string[]) => void;
  /** Disable buttons while a resume is in flight. */
  busy?: boolean;
}

function domainOf(u: string): string {
  try {
    const url = new URL(u);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return u.slice(0, 24);
  }
}

const UNVERIFIED_HOSTS = ["reddit.com", "twitter.com", "x.com", "pastebin.com"];

export function ApprovalCard({
  question,
  candidates,
  budget = 3,
  onSkip,
  onApprove,
  busy,
}: Props) {
  const [selected, setSelected] = useState<Set<string>>(() => {
    // Pre-select the top `budget` candidates as a sane default.
    const top = candidates.slice(0, budget).map((c) => c.url);
    return new Set(top);
  });

  const toggle = (url: string) => {
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(url)) n.delete(url);
      else n.add(url);
      return n;
    });
  };

  const total = candidates.length;
  const picked = selected.size;
  const estCrawl = `~${Math.max(6, picked * 6)}s`;

  return (
    <div className="approval">
      <div className="approval-head">
        <span className="badge">Approve sources to crawl</span>
        <span className="meta">
          searxng · {total} hits · {Math.min(total, 4)} shown · sorted by relevance
        </span>
      </div>
      <div className="approval-msg">
        I couldn't find enough about <span className="q">"{question}"</span> in your indexed
        sources. Pick the URLs you trust — I'll crawl, embed, and answer.
      </div>
      <div className="url-list">
        {candidates.map((c) => {
          const host = domainOf(c.url);
          const isWarn = UNVERIFIED_HOSTS.some((u) => host.endsWith(u));
          const checked = selected.has(c.url);
          return (
            <div
              key={c.url}
              className={`url-row${checked ? " checked" : ""}`}
              onClick={() => toggle(c.url)}
            >
              <div className="check" />
              <div className="info">
                <div className="u-title">{c.title || host}</div>
                <div className="u-href">{c.url}</div>
                {c.snippet && <div className="u-snip">{c.snippet}</div>}
              </div>
              <span className={`domain${isWarn ? " warn" : ""}`}>
                {isWarn ? "unverified" : host}
              </span>
            </div>
          );
        })}
      </div>
      <div className="approval-foot">
        <span className="counts">
          <span className="v">{picked}</span> of <span className="v">{total}</span> selected
          <span style={{ color: "var(--dim)" }}> · </span>
          budget <span className="v">{budget}</span> urls
          <span style={{ color: "var(--dim)" }}> · </span>
          est crawl <span className="v">{estCrawl}</span>
        </span>
        <div className="right">
          <button className="btn ghost" disabled={busy} onClick={onSkip}>
            skip · answer from local
          </button>
          <button
            className="btn warm"
            disabled={busy}
            onClick={() => onApprove([...selected])}
          >
            crawl &amp; continue →
          </button>
        </div>
      </div>
    </div>
  );
}
