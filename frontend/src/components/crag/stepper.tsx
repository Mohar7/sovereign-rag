import { Minus, Plus } from "lucide-react"

import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Stepper
//
// Small +/- numeric control used for integer settings like
// crag_max_corrections. Matches the bundle's visual: a bordered
// row with a subtract button, a mono value display, and an add button.
// ─────────────────────────────────────────────────────────────────

export interface StepperProps {
  value: number
  min?: number
  max?: number
  onChange?: (value: number) => void
  className?: string
}

export function Stepper({
  value,
  min = 0,
  max = 10,
  onChange,
  className,
}: StepperProps) {
  const atMin = value <= min
  const atMax = value >= max

  return (
    <div
      className={cn(
        "inline-flex h-9 items-center overflow-hidden rounded-[6px]",
        "border border-border bg-card shadow-sm",
        className,
      )}
    >
      <button
        type="button"
        disabled={atMin}
        onClick={() => onChange?.(Math.max(min, value - 1))}
        className={cn(
          "inline-flex h-full w-[34px] items-center justify-center border-r border-border",
          "bg-transparent transition-colors hover:bg-muted",
          "disabled:cursor-not-allowed disabled:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          !atMin && "text-foreground",
        )}
        aria-label="Decrease"
      >
        <Minus className="size-3" />
      </button>

      <span className="min-w-[44px] text-center font-mono text-sm font-semibold tabular-nums leading-none">
        {value}
      </span>

      <button
        type="button"
        disabled={atMax}
        onClick={() => onChange?.(Math.min(max, value + 1))}
        className={cn(
          "inline-flex h-full w-[34px] items-center justify-center border-l border-border",
          "bg-transparent transition-colors hover:bg-muted",
          "disabled:cursor-not-allowed disabled:text-muted-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
          !atMax && "text-foreground",
        )}
        aria-label="Increase"
      >
        <Plus className="size-3" />
      </button>
    </div>
  )
}
