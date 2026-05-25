import { useCallback, useEffect, useRef, useState } from "react";

interface Props {
  min?: number;
  max?: number;
  value: number;
  ticks?: number;
  suffix?: string;
  step?: number;
  disabled?: boolean;
  /** Show a value bubble above the thumb while dragging. */
  bubble?: boolean;
  /** Render the slider in the compact width (140px). */
  compact?: boolean;
  onChange?: (next: number) => void;
}

/** Visual slider — matches the design's `.slider-row` markup.
 *  Drag the thumb (or click the track) to move it; arrow keys when focused.
 *  Shows a value bubble while dragging when `bubble` is true. */
export function Slider({
  min = 0,
  max = 100,
  value,
  ticks = 5,
  suffix = "",
  step = 1,
  disabled,
  bubble,
  compact,
  onChange,
}: Props) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const [focused, setFocused] = useState(false);

  const valueFromClientX = useCallback(
    (clientX: number) => {
      const el = trackRef.current;
      if (!el) return value;
      const rect = el.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const raw = min + ratio * (max - min);
      return step ? Math.round(raw / step) * step : raw;
    },
    [min, max, step, value],
  );

  useEffect(() => {
    if (!dragging) return;
    const move = (e: PointerEvent) => onChange?.(valueFromClientX(e.clientX));
    const up = () => setDragging(false);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [dragging, onChange, valueFromClientX]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !onChange) return;
    setDragging(true);
    onChange(valueFromClientX(e.clientX));
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled || !onChange) return;
    const big = e.shiftKey ? 10 : 1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      onChange(Math.max(min, value - step * big));
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      onChange(Math.min(max, value + step * big));
    }
  };

  const thumbClass = dragging ? "thumb drag" : focused ? "thumb focus" : "thumb";

  return (
    <div className={`slider-row ${compact ? "compact" : ""}`}>
      <span className="min">{min}</span>
      <div
        ref={trackRef}
        className={`slider ${disabled ? "disabled" : ""}`}
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        role={onChange ? "slider" : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-disabled={disabled || undefined}
        tabIndex={onChange && !disabled ? 0 : undefined}
        style={{ position: "relative" }}
      >
        <div className="track" />
        <div className="fill" style={{ width: `${pct}%` }} />
        <div className="ticks">
          {Array.from({ length: ticks }).map((_, i) => (
            <span key={i} className="tick" />
          ))}
        </div>
        <div className={thumbClass} style={{ left: `${pct}%` }} />
        {bubble && dragging && (
          <div className="slider-bubble" style={{ left: `${pct}%` }}>
            {value}
            {suffix}
          </div>
        )}
      </div>
      <span className="max">{max}</span>
      <span className="val" style={disabled ? { opacity: 0.4 } : undefined}>
        {value}
        {suffix}
      </span>
    </div>
  );
}
