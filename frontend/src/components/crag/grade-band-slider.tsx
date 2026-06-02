import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import { formatConfidence } from "./crag-utils"

// ─────────────────────────────────────────────────────────────────
// GradeBandSlider
//
// Dual-threshold control encoding:
//   crag_incorrect_threshold (low)  — below this → Incorrect
//   crag_correct_threshold   (high) — above this → Correct
//   Middle zone                     — "LLM decides"
//
// Visual: red→amber→green coloured track with labeled zones and a
// numeric readout. Handles are two stacked range inputs (v1 — the
// priority is the labeled-zones viz and persisting the two values;
// a full drag-dual-thumb interaction is a follow-up).
//
// SIMPLIFICATION NOTE: v1 uses two <input type="range"> laid out
// absolutely on top of one another. The lower thumb controls `low`
// and the upper thumb controls `high`. Drag interaction works but
// the two thumbs may overlap — for the settings page this is
// acceptable. A custom dual-thumb canvas widget is a follow-up.
// ─────────────────────────────────────────────────────────────────

export interface GradeBandSliderProps {
  low?: number
  high?: number
  onChange?: (low: number, high: number) => void
  className?: string
}

export function GradeBandSlider({
  low = 0.3,
  high = 0.7,
  onChange,
  className,
}: GradeBandSliderProps) {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const lp = low * 100
  const hp = high * 100

  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {/* Track */}
      <div className="relative h-6">
        {/* Incorrect zone (red) */}
        <div
          aria-hidden
          className="absolute top-[10px] h-[5px] rounded-l-full"
          style={{
            left: 0,
            width: `${lp}%`,
            background: "color-mix(in oklab, var(--destructive) 55%, transparent)",
          }}
        />
        {/* Ambiguous zone (amber) */}
        <div
          aria-hidden
          className="absolute top-[10px] h-[5px]"
          style={{
            left: `${lp}%`,
            width: `${hp - lp}%`,
            background: "color-mix(in oklab, var(--warning) 45%, transparent)",
          }}
        />
        {/* Correct zone (green) */}
        <div
          aria-hidden
          className="absolute top-[10px] h-[5px] rounded-r-full"
          style={{
            left: `${hp}%`,
            right: 0,
            background: "color-mix(in oklab, var(--success) 55%, transparent)",
          }}
        />

        {/* Low handle (destructive) */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-[3px] z-30 size-[18px] rounded-full border-[1.5px] border-destructive bg-card shadow-sm"
          style={{ left: `calc(${lp}% - 9px)` }}
        />

        {/* High handle (success) */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-[3px] z-30 size-[18px] rounded-full border-[1.5px] border-success bg-card shadow-sm"
          style={{ left: `calc(${hp}% - 9px)` }}
        />

        {/* Low range input (controls low threshold) */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={low}
          onChange={(e) => {
            const newLow = Math.min(Number(e.target.value), high - 0.01)
            onChange?.(newLow, high)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={t("crag.gradeBand.lowThreshold", { defaultValue: "Incorrect threshold" })}
          aria-valuenow={low}
          aria-valuemin={0}
          aria-valuemax={1}
        />
        {/* High range input (controls high threshold) */}
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={high}
          onChange={(e) => {
            const newHigh = Math.max(Number(e.target.value), low + 0.01)
            onChange?.(low, newHigh)
          }}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          aria-label={t("crag.gradeBand.highThreshold", { defaultValue: "Correct threshold" })}
          aria-valuenow={high}
          aria-valuemin={0}
          aria-valuemax={1}
        />
      </div>

      {/* Zone labels */}
      <div className="relative flex font-mono text-[11px] font-semibold">
        <span
          className="text-destructive"
          style={{ width: `${lp}%` }}
        >
          {t("crag.gradeBand.incorrect")}
        </span>
        <span
          className="text-warning text-center"
          style={{ width: `${hp - lp}%` }}
        >
          {t("crag.gradeBand.llmDecides")}
        </span>
        <span
          className="text-success text-right ml-auto"
          style={{ width: `${100 - hp}%` }}
        >
          {t("crag.gradeBand.correct")}
        </span>
      </div>

      {/* Numeric readout */}
      <div className="flex justify-between font-mono text-[11.5px] text-muted-foreground">
        <span>0{lang === "ru" ? ",00" : ".00"}</span>
        <span className="font-semibold text-destructive tabular-nums">
          {formatConfidence(low, lang)}
        </span>
        <span className="font-semibold text-success tabular-nums">
          {formatConfidence(high, lang)}
        </span>
        <span>1{lang === "ru" ? ",00" : ".00"}</span>
      </div>
    </div>
  )
}
