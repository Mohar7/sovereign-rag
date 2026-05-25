import { useEffect, useRef, useState } from "react";

export interface KebabOption {
  label: string;
  /** Render a divider before this option. */
  divider?: boolean;
  danger?: boolean;
  kbd?: string;
  onSelect?: () => void;
}

interface Props {
  options: KebabOption[];
  /** Glyph shown in the trigger — defaults to ⋯. */
  glyph?: string;
  ariaLabel?: string;
}

/** ⋯ button + popover. Owns its open state and click-outside handling. */
export function KebabMenu({ options, glyph = "⋯", ariaLabel = "more" }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <span
        role="button"
        aria-label={ariaLabel}
        tabIndex={0}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen((o) => !o);
          }
        }}
        style={{ color: "var(--muted)", padding: "0 4px", cursor: "pointer", fontWeight: 700 }}
      >
        {glyph}
      </span>
      {open && (
        <div
          className="popover kebab-pop"
          style={{ position: "absolute", top: "100%", right: 0, marginTop: 4, width: 160, zIndex: 20 }}
          role="menu"
        >
          {options.map((o, i) => (
            <div key={`${o.label}-${i}`}>
              {o.divider && <div className="divider" />}
              <div
                className={`opt ${o.danger ? "danger" : ""}`}
                role="menuitem"
                onClick={() => { setOpen(false); o.onSelect?.(); }}
              >
                <span>{o.label}</span>
                {o.kbd && <span className="kbd">{o.kbd}</span>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
