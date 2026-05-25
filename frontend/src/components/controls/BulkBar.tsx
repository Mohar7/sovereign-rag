import type { ReactNode } from "react";

interface Props {
  count: number;
  noun?: string;
  children: ReactNode;
}

/** Bulk-action bar — slides down when items are selected. Render only when
 *  count > 0; the slide-down animation is handled in CSS via the unmount/mount. */
export function BulkBar({ count, noun = "selected", children }: Props) {
  if (count <= 0) return null;
  return (
    <div className="bulk-bar" role="toolbar">
      <span>
        <span className="count">{count}</span> {noun}
      </span>
      <span className="sep">·</span>
      {children}
    </div>
  );
}
