// Convert an assistant message's text — which contains `[1]`, `[2]`, …
// citation markers — into a React tree where each marker becomes a
// CitationChip with the right "kind" (graph / vector / web / hybrid).
//
// We keep the renderer dumb on purpose: a real markdown parser is overkill
// here. The LLM's output is short paragraphs with simple `code spans` and
// the [n] markers; we handle those three things and pass everything else
// through as plain text.

import type { ReactNode } from "react";
import { CitationChip } from "../components/CitationChip";
import type { Citation, CitationKind } from "./types";

interface Options {
  citations: Citation[];
  /** Index of the currently focused citation (highlights the chip). */
  activeIndex?: number;
  /** Set to true while a run is streaming — adds the pop-in animation. */
  streaming?: boolean;
  onCitationClick?: (index: number) => void;
}

/** Pick a chip kind from how the chunk reached the answer. */
function kindFor(c: Citation): CitationKind {
  if (c.kind) return c.kind;
  if (c.source_uri.startsWith("http://") || c.source_uri.startsWith("https://"))
    return "hybrid";
  return "hybrid";
}

const CITATION_PATTERN = /\[(\d+)\]/g;
const INLINE_PATTERN = /(`[^`]+`|\*\*[^*]+\*\*|_[^_]+_)/g;

/** Split a paragraph on `[n]` markers and inline-render the chips. */
function splitOnCitations(
  paragraph: string,
  opts: Options,
  keyBase: string
): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let idx = 0;
  for (const m of paragraph.matchAll(CITATION_PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) {
      out.push(renderInline(paragraph.slice(last, at), `${keyBase}-t${idx}`));
    }
    const n = Number(m[1]);
    const c = opts.citations[n - 1];
    out.push(
      <CitationChip
        key={`${keyBase}-c${idx}`}
        n={n}
        kind={c ? kindFor(c) : "hybrid"}
        active={opts.activeIndex === n - 1}
        streaming={opts.streaming}
        title={c?.title}
        onClick={() => opts.onCitationClick?.(n - 1)}
      />
    );
    last = at + m[0].length;
    idx += 1;
  }
  if (last < paragraph.length) {
    out.push(renderInline(paragraph.slice(last), `${keyBase}-t${idx}`));
  }
  return out;
}

/** Inline-render `code spans`, **bold** and _italic_ without pulling in a
 *  markdown lib. Anything else passes through verbatim. */
function renderInline(text: string, keyBase: string): ReactNode {
  const parts: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(INLINE_PATTERN)) {
    const at = m.index ?? 0;
    if (at > last) parts.push(text.slice(last, at));
    const tok = m[0];
    if (tok.startsWith("`")) {
      parts.push(
        <code key={`${keyBase}-${i}`} className="mono">
          {tok.slice(1, -1)}
        </code>
      );
    } else if (tok.startsWith("**")) {
      parts.push(<strong key={`${keyBase}-${i}`}>{tok.slice(2, -2)}</strong>);
    } else {
      parts.push(<em key={`${keyBase}-${i}`}>{tok.slice(1, -1)}</em>);
    }
    last = at + tok.length;
    i += 1;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

export function renderAnswer(text: string, opts: Options): ReactNode {
  // Split into paragraphs on blank lines.
  const paragraphs = text.split(/\n{2,}/).filter((p) => p.trim().length > 0);
  return (
    <>
      {paragraphs.map((p, i) => (
        <p key={`p-${i}`}>{splitOnCitations(p, opts, `p${i}`)}</p>
      ))}
    </>
  );
}
