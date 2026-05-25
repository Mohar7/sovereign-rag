import { useEffect, useRef } from "react";
import type { CSSProperties, ReactNode } from "react";

interface Props {
  /** Uppercase header label (rendered with ◗ prefix). */
  header?: ReactNode;
  /** Right-aligned content in the header row. */
  headerRight?: ReactNode;
  children: ReactNode;
  /** Render footer with action buttons. */
  footer?: ReactNode;
  /** Show the rotated-square pointer at the top, default offset 22px from left. */
  pointer?: boolean;
  pointerOffset?: number;
  className?: string;
  style?: CSSProperties;
  /** Close handler — clicks outside or Escape will fire this. */
  onClose?: () => void;
}

/** Floating popover panel. Owns its own outside-click and Escape handling
 *  when `onClose` is provided. Position with `style.left/top` from the caller. */
export function Popover({
  header,
  headerRight,
  children,
  footer,
  pointer,
  pointerOffset = 22,
  className = "",
  style,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onClose) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div ref={ref} className={`popover ${className}`} style={style} role="dialog">
      {pointer && (
        <div className="popover-pointer" style={{ top: -5, left: pointerOffset }} />
      )}
      {(header || headerRight) && (
        <div className="popover-head">
          {header && <span>◗ {header}</span>}
          {headerRight && <span className="right">{headerRight}</span>}
        </div>
      )}
      {children}
      {footer && (
        <div
          style={{
            display: "flex",
            padding: "8px 12px",
            gap: 6,
            borderTop: "1px dashed var(--faint)",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}
