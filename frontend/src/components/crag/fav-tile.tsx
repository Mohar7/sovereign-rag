import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// FavTile
//
// Monogram tile showing the first letter of a domain. No network
// favicons — offline-first. Used in the approval card URL list.
// ─────────────────────────────────────────────────────────────────

export interface FavTileProps {
  /** Full domain string (e.g. "example.com" or "www.example.com"). */
  domain?: string
  /** Tile size in px (default 18). */
  size?: number
  className?: string
}

export function FavTile({ domain = "", size = 18, className }: FavTileProps) {
  const letter = (domain.replace(/^www\./, "")[0] ?? "?").toUpperCase()

  return (
    <span
      aria-hidden
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded",
        "border border-border bg-muted text-muted-foreground",
        "font-mono font-semibold leading-none",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.5,
        borderRadius: 4,
      }}
    >
      {letter}
    </span>
  )
}
