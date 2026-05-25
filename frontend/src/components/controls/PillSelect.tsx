interface Props {
  /** Optional sub-label like `k:` shown muted before the value. */
  k?: string;
  /** The displayed value. */
  v: string;
  /** Open state — rotates the chevron. */
  open?: boolean;
  onClick?: () => void;
}

export function PillSelect({ k, v, open, onClick }: Props) {
  return (
    <span
      className={`pill-select ${open ? "open" : ""}`}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onClick={onClick}
    >
      {k && <span className="k">{k}</span>}
      <span>{v}</span>
      <span className="chev">▾</span>
    </span>
  );
}
