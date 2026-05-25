import { useState } from "react";

interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  /** When true, renders the red error ring and tints the value red. */
  invalid?: boolean;
  onChange?: (next: number) => void;
}

export function NumInput({
  value,
  min = -Infinity,
  max = Infinity,
  step = 1,
  disabled,
  invalid,
  onChange,
}: Props) {
  const [focused, setFocused] = useState(false);
  const adjust = (delta: number) => {
    if (disabled || !onChange) return;
    const next = Math.max(min, Math.min(max, value + delta));
    if (next !== value) onChange(next);
  };
  const ring = invalid ? "error-ring" : focused ? "focus-ring" : "";
  return (
    <span
      className={`num-input ${ring} ${disabled ? "disabled" : ""}`}
      style={disabled ? { opacity: 0.4 } : undefined}
      tabIndex={onChange && !disabled ? 0 : undefined}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={(e) => {
        if (disabled || !onChange) return;
        const big = e.altKey ? 10 : 1;
        if (e.key === "ArrowUp") { e.preventDefault(); adjust(step * big); }
        if (e.key === "ArrowDown") { e.preventDefault(); adjust(-step * big); }
      }}
    >
      <span className="step left" onClick={() => adjust(-step)} role="button">
        −
      </span>
      <span className="val" style={invalid ? { color: "var(--err)" } : undefined}>
        {value}
      </span>
      <span className="step right" onClick={() => adjust(step)} role="button">
        +
      </span>
    </span>
  );
}
