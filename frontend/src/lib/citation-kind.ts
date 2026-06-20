import type { CitationKind } from "@/components/ask/citation-chip"
import type { CitationModel } from "@/lib/api"

/**
 * Infer the citation kind from the source_uri. Web-fallback citations carry an
 * http(s) URI; local corpus citations use internal identifiers like
 * "doc_<id> · chunk_<n>". Lives in lib/ (not the chip component file) so it can
 * be shared without tripping react-refresh's only-export-components rule.
 */
export function pickKind(c: CitationModel): CitationKind {
  if (c.kind) return c.kind
  if (c.source_uri && /^https?:\/\//i.test(c.source_uri)) return "web"
  return "hybrid"
}
