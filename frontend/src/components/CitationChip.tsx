import type { CitationKind } from "../lib/types";

interface Props {
  n: number;
  kind?: CitationKind;
  active?: boolean;
  streaming?: boolean;
  title?: string;
  onClick?: () => void;
}

/** Inline citation pill. The split-tinted version (`kind="hybrid"`) is the
 *  sovereign-rag signature — blue half (graph) + lavender half (vector). */
export function CitationChip({
  n,
  kind = "hybrid",
  active,
  streaming,
  title,
  onClick,
}: Props) {
  const cls = ["cite", kind];
  if (active) cls.push("active");
  if (streaming) cls.push("streaming");
  return (
    <span
      className={cls.join(" ")}
      title={title}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <span className="num">{n}</span>
    </span>
  );
}
