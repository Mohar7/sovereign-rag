/**
 * Locale-aware number & date formatting.
 *
 * Reads the active i18n language at call time so EN renders "12,345 · 0.87 ·
 * May 24, 2026" and RU renders "12 345 · 0,87 · 24 мая 2026" (thin-space
 * grouping, comma decimal) per the design-system content rules. Components that
 * call these must subscribe to i18n (via useTranslation) so they re-render when
 * the language changes.
 */
import i18n from "@/lib/i18n"

/** BCP-47 locale for the active UI language. */
function activeLocale(): string {
  return i18n.resolvedLanguage?.startsWith("ru") ? "ru-RU" : "en-US"
}

/** Integer with locale grouping — EN "12,345" / RU "12 345". */
export function formatCount(n: number): string {
  return n.toLocaleString(activeLocale())
}

/** Fractional metric with locale decimal — EN "0.87" / RU "0,87". */
export function formatDecimal(n: number, digits = 2): string {
  return n.toLocaleString(activeLocale(), {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Absolute long date — EN "May 24, 2026" / RU "24 мая 2026". */
export function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(activeLocale(), {
    year: "numeric",
    month: "long",
    day: "numeric",
  })
}

/** Compact date + 24h time — used in run-history rows. */
export function formatDateTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString(activeLocale(), {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
}

/**
 * Relative time under 24h ("3m ago" / "3 мин назад"), else an absolute date.
 * RU short units are used when the active language is Russian.
 */
export function formatRelativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const ru = activeLocale().startsWith("ru")
  const min = Math.floor((Date.now() - then) / 60_000)
  if (min < 1) return ru ? "только что" : "just now"
  if (min < 60) return ru ? `${min} мин назад` : `${min}m ago`
  const hr = Math.floor(min / 60)
  if (hr < 24) return ru ? `${hr} ч назад` : `${hr}h ago`
  return formatDate(iso)
}
