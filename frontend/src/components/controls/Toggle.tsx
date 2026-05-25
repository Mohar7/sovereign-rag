interface Props {
  on: boolean;
  disabled?: boolean;
  onChange?: (next: boolean) => void;
}

export function Toggle({ on, disabled, onChange }: Props) {
  const handle = () => {
    if (disabled || !onChange) return;
    onChange(!on);
  };
  return (
    <span
      className={`toggle ${on ? "on" : ""} ${disabled ? "disabled" : ""}`}
      role={onChange ? "switch" : undefined}
      aria-checked={onChange ? on : undefined}
      aria-disabled={disabled || undefined}
      tabIndex={onChange && !disabled ? 0 : undefined}
      onClick={handle}
      onKeyDown={(e) => {
        if (disabled || !onChange) return;
        if (e.key === " " || e.key === "Enter") {
          e.preventDefault();
          onChange(!on);
        }
      }}
    />
  );
}
