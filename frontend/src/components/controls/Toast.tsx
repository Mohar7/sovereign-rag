import { useEffect } from "react";
import type { ReactNode } from "react";

export type ToastKind = "ok" | "warn" | "err" | "lavender";

interface Props {
  kind?: ToastKind;
  children: ReactNode;
  /** Auto-dismiss after this many ms. 0 = sticky. */
  autoDismissMs?: number;
  onClose?: () => void;
}

/** Floating toast — positioned top-right by CSS. */
export function Toast({
  kind = "ok",
  children,
  autoDismissMs = 4000,
  onClose,
}: Props) {
  useEffect(() => {
    if (!autoDismissMs || !onClose) return;
    const t = window.setTimeout(onClose, autoDismissMs);
    return () => window.clearTimeout(t);
  }, [autoDismissMs, onClose]);

  return (
    <div className={`toast ${kind}`} role="status">
      <span className="live-dot" />
      <span className="msg">{children}</span>
      {onClose && (
        <span className="close" onClick={onClose} role="button" aria-label="dismiss">
          ✕
        </span>
      )}
    </div>
  );
}
