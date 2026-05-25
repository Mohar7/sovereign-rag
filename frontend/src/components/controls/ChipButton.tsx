import type { ReactNode } from "react";

interface Props {
  /** Main label text or composed children. */
  children: ReactNode;
  /** Show a small muted label after the main text (e.g. "· 256k ctx"). */
  lab?: string;
  /** Leading green dot (model-picker style). */
  withDot?: boolean;
  /** Render the chevron when this is a picker trigger. */
  chev?: boolean;
  /** Picker open — adds .open class, rotates chevron. */
  open?: boolean;
  disabled?: boolean;
  danger?: boolean;
  /** Color of the leading ◗ glyph (graph/vector/human). */
  glyph?: string;
  glyphColor?: string;
  title?: string;
  onClick?: () => void;
}

/** Compact chip-button used in composers, toolbars, bulk-action bars. */
export function ChipButton({
  children,
  lab,
  withDot,
  chev,
  open,
  disabled,
  danger,
  glyph,
  glyphColor,
  title,
  onClick,
}: Props) {
  const cls = [
    "chip-btn",
    withDot ? "with-dot" : "",
    open ? "open" : "",
    danger ? "danger" : "",
    disabled ? "disabled" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {glyph && <span style={{ color: glyphColor }}>{glyph}</span>}
      {children}
      {lab && <span className="lab">{lab}</span>}
      {chev && <span className="chev">▾</span>}
    </button>
  );
}
