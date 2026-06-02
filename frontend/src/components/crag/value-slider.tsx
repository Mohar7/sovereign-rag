import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// ValueSlider
//
// Single-thumb slider for integer or float settings (e.g.
// web_fallback_max_urls). Uses a native range input styled to match
// the design bundle's track + thumb look. Shows min / current / max
// labels below the track.
// ─────────────────────────────────────────────────────────────────

export interface ValueSliderProps {
  value: number
  min?: number
  max?: number
  step?: number
  onChange?: (value: number) => void
  className?: string
}

export function ValueSlider({
  value,
  min = 1,
  max = 10,
  step = 1,
  onChange,
  className,
}: ValueSliderProps) {
  const pct = ((value - min) / (max - min)) * 100

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {/* Track wrapper */}
      <div className="relative h-[22px]">
        {/* Background track */}
        <div className="absolute inset-x-0 top-[9px] h-1 rounded-full bg-muted" />
        {/* Filled portion */}
        <div
          className="absolute left-0 top-[9px] h-1 rounded-full bg-primary"
          style={{ width: `${pct}%` }}
        />
        {/* Native range for accessibility + interaction */}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange?.(Number(e.target.value))}
          className={cn(
            "absolute inset-0 h-full w-full cursor-pointer opacity-0",
            "focus-visible:opacity-100",
          )}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
        />
        {/* Visual thumb */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-[1px] size-[18px] rounded-full border-[1.5px] border-primary bg-card shadow-sm"
          style={{ left: `calc(${pct}% - 9px)` }}
        />
      </div>

      {/* Labels */}
      <div className="flex justify-between font-mono text-[11px] text-muted-foreground">
        <span>{min}</span>
        <span className="font-semibold text-foreground tabular-nums">{value}</span>
        <span>{max}</span>
      </div>
    </div>
  )
}
