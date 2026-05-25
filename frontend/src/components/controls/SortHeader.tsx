import type { ReactNode } from "react";

export type SortDir = "asc" | "desc" | null;

interface Props {
  label: ReactNode;
  /** When this column is the active sort, pass its direction. */
  dir: SortDir;
  onClick?: () => void;
}

/** Table-header cell with a lavender arrow on the active column.
 *  Pass `dir = null` for inactive columns. */
export function SortHeader({ label, dir, onClick }: Props) {
  const arrow = dir === "asc" ? "↑" : dir === "desc" ? "↓" : "↕";
  return (
    <span
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
      style={{ cursor: onClick ? "pointer" : undefined }}
    >
      {label}{" "}
      <span className={dir ? "sort-arrow" : ""} style={!dir ? { color: "var(--dim)" } : undefined}>
        {arrow}
      </span>
    </span>
  );
}
