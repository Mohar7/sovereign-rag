interface Props {
  on: boolean;
  onChange?: (next: boolean) => void;
}

export function Toggle({ on, onChange }: Props) {
  return (
    <span
      className={`toggle ${on ? "on" : ""}`}
      role={onChange ? "switch" : undefined}
      aria-checked={onChange ? on : undefined}
      tabIndex={onChange ? 0 : undefined}
      onClick={() => onChange?.(!on)}
      onKeyDown={(e) => {
        if (!onChange) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!on);
        }
      }}
    />
  );
}
