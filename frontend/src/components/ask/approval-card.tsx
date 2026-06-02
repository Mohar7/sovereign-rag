import { useState } from "react"
import {
  AlertTriangle,
  Check,
  Database,
  Globe,
  Loader2,
  RotateCcw,
  Sparkles,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GradeChip } from "@/components/crag/grade-chip"
import { FavTile } from "@/components/crag/fav-tile"
import { cn } from "@/lib/utils"
import type { CandidateUrl, GradeModel } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// ApprovalCard
//
// Four-state card for the HITL web-fallback approval flow:
//   deciding  — user picks which URLs to crawl, approves or declines
//   crawling  — progress view while crawling is in flight
//   partial   — non-blocking warning when some URLs failed
//   declined  — compact chip shown above the answer
// ─────────────────────────────────────────────────────────────────

export interface CrawlProgressItem {
  url: string
  status: "crawling" | "indexed" | "failed" | string
  chunks?: number
}

// ── (a) Deciding ─────────────────────────────────────────────────

export interface ApprovalCardDecidingProps {
  state: "deciding"
  candidates: CandidateUrl[]
  grade?: GradeModel | null
  question: string
  onApprove: (urls: string[]) => void
  onDecline: () => void
}

// ── (b) Crawling ─────────────────────────────────────────────────

export interface ApprovalCardCrawlingProps {
  state: "crawling"
  progress?: CrawlProgressItem[]
}

// ── (c) Partial failure ──────────────────────────────────────────

export interface ApprovalCardPartialProps {
  state: "partial"
  progress?: CrawlProgressItem[]
}

// ── (d) Declined chip ───────────────────────────────────────────

export interface ApprovalCardDeclinedProps {
  state: "declined"
}

export type ApprovalCardProps =
  | ApprovalCardDecidingProps
  | ApprovalCardCrawlingProps
  | ApprovalCardPartialProps
  | ApprovalCardDeclinedProps

export function ApprovalCard(props: ApprovalCardProps) {
  if (props.state === "deciding") return <DecidingCard {...props} />
  if (props.state === "crawling") return <CrawlingCard {...props} />
  if (props.state === "partial") return <PartialCard {...props} />
  return <DeclinedChip />
}

// ── Card shell ────────────────────────────────────────────────────

function CardShell({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-card",
        "crag-approval-slide",
        className,
      )}
    >
      {children}
    </div>
  )
}

// ── Deciding card ─────────────────────────────────────────────────

function DecidingCard({
  candidates,
  grade,
  question,
  onApprove,
  onDecline,
}: ApprovalCardDecidingProps) {
  const { t } = useTranslation()

  // Pre-check the verified candidates (top-ranked ones)
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => c.verified !== false).map((c) => c.url)),
  )

  const allChecked = checked.size === candidates.length
  const noneChecked = checked.size === 0

  const toggleAll = () => {
    if (allChecked) {
      setChecked(new Set())
    } else {
      setChecked(new Set(candidates.map((c) => c.url)))
    }
  }

  const toggleOne = (url: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(url)) next.delete(url)
      else next.add(url)
      return next
    })
  }

  const handleApprove = () => {
    onApprove([...checked])
  }

  return (
    <CardShell>
      {/* Header */}
      <div className="flex items-start gap-3 border-b border-border p-4 pb-[14px]">
        <div
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in oklab, var(--warning) 14%, transparent)",
            color: "var(--warning)",
          }}
        >
          <Globe className="size-[18px]" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold leading-[1.3] text-foreground">
            {t("crag.approval.title")}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground leading-[1.55]">
            <span>{t("crag.approval.why")}</span>
            {grade && (
              <GradeChip label={grade.label} confidence={grade.confidence} size="sm" />
            )}
            <span>{t("crag.approval.on")}</span>
            <span className="italic text-foreground">"{question}"</span>
          </div>
        </div>
        <Badge
          variant="outline"
          className="shrink-0 border-warning/35 bg-warning/10 text-warning text-[11px]"
        >
          {t("crag.approval.yourCall")}
        </Badge>
      </div>

      {/* Select-all row */}
      <div
        className="flex items-center gap-3 border-b px-4 py-2.5"
        style={{ borderColor: "color-mix(in oklab, var(--border) 60%, transparent)" }}
      >
        <Checkbox
          checked={allChecked ? true : noneChecked ? false : "indeterminate"}
          onCheckedChange={toggleAll}
          aria-label={t("crag.approval.selectAll")}
        />
        <span className="text-[12.5px] font-medium">
          {t("crag.approval.selectAll")}
        </span>
        <span className="rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
          {t("crag.approval.candidatesInfo", {
            count: candidates.length,
            top: checked.size,
          })}
        </span>
      </div>

      {/* Candidate rows */}
      {candidates.map((c, i) => {
        const isChecked = checked.has(c.url)
        const isLast = i === candidates.length - 1
        return (
          <div
            key={c.url}
            className={cn(
              "flex items-start gap-3 px-4 py-3",
              !isLast &&
                "border-b",
              isChecked &&
                "bg-primary/[0.05]",
            )}
            style={
              !isLast
                ? { borderColor: "color-mix(in oklab, var(--border) 60%, transparent)" }
                : undefined
            }
          >
            <div className="pt-0.5">
              <Checkbox
                checked={isChecked}
                onCheckedChange={() => toggleOne(c.url)}
                aria-label={c.title}
              />
            </div>
            <FavTile domain={extractDomain(c.url)} size={20} className="mt-0.5" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13.5px] font-semibold text-foreground">
                  {c.title}
                </span>
                <Globe className="size-3 shrink-0 text-muted-foreground" />
                {c.verified === false && (
                  <span className="rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t("crag.approval.unverified")}
                  </span>
                )}
              </div>
              <div className="mt-0.5 text-[12.5px] leading-[1.55] text-muted-foreground line-clamp-2">
                {c.snippet}
              </div>
              <div className="mt-1 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                {c.url}
              </div>
            </div>
          </div>
        )
      })}

      {/* Co-equal footer actions */}
      <div
        className="flex flex-wrap items-center gap-2.5 border-t border-border p-4"
        style={{ background: "var(--muted)" }}
      >
        <span className="shrink-0 rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11.5px] text-foreground">
          {checked.size} / {candidates.length}
        </span>
        <span className="flex-1" />
        <div className="flex flex-1 basis-auto gap-2.5 sm:flex-none">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 gap-1.5 font-semibold sm:flex-none"
            onClick={onDecline}
          >
            <Database className="size-3.5" />
            {t("crag.approval.declineLocal")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 gap-1.5 font-semibold sm:flex-none"
            onClick={handleApprove}
            disabled={checked.size === 0}
          >
            {t("crag.approval.crawlContinue", { n: checked.size })}
          </Button>
        </div>
      </div>
    </CardShell>
  )
}

// ── Crawling card ─────────────────────────────────────────────────

function CrawlingCard({ progress = [] }: ApprovalCardCrawlingProps) {
  const { t } = useTranslation()

  const total = progress.length
  const done = progress.filter((p) => p.status === "indexed").length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const phases = [
    { key: "crawling", icon: Globe, label: t("crag.crawling.crawling") },
    { key: "indexing", icon: Database, label: t("crag.crawling.indexing") },
    { key: "reRetrieving", icon: RotateCcw, label: t("crag.crawling.reRetrieving") },
    { key: "answering", icon: Sparkles, label: t("crag.crawling.answering") },
  ]

  // Determine current active phase from progress
  const hasCrawling = progress.some((p) => p.status === "crawling")
  const hasIndexed = progress.some((p) => p.status === "indexed")
  const activePhaseIdx = hasCrawling ? 0 : hasIndexed ? 1 : 0

  return (
    <CardShell>
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border p-4 pb-[14px]">
        <div
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full"
          style={{
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            color: "var(--primary)",
          }}
        >
          <Loader2 className="size-[18px] animate-spin" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15.5px] font-semibold">
            {t("crag.approval.crawlingTitle", {
              n: total,
              total: total,
            })}
          </div>
          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
            {t("crag.approval.crawlingSubtitle")}
          </div>
        </div>
      </div>

      {/* Progress body */}
      <div className="p-4">
        {/* Progress bar + pct */}
        <div className="mb-2 flex justify-between font-mono text-[11.5px] text-muted-foreground">
          <span>
            {done} / {total}
          </span>
          <span className="font-semibold text-primary">{pct}%</span>
        </div>
        <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all duration-300"
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Phase strip */}
        <div className="flex gap-1.5">
          {phases.map((phase, i) => {
            const Icon = phase.icon
            const isActive = i === activePhaseIdx
            return (
              <div key={phase.key} className="flex flex-1 flex-col gap-1.5">
                <div
                  className="h-1 rounded-full"
                  style={{
                    background: isActive
                      ? "color-mix(in oklab, var(--primary) 45%, transparent)"
                      : "var(--muted)",
                  }}
                />
                <div
                  className={cn(
                    "flex items-center gap-1.5 font-mono text-[11.5px]",
                    isActive ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {isActive ? (
                    <Loader2 className="size-[11px] animate-spin" />
                  ) : (
                    <Icon className="size-[11px]" />
                  )}
                  <span>{phase.label}</span>
                </div>
              </div>
            )
          })}
        </div>

        {/* Per-URL status list */}
        {progress.length > 0 && (
          <div className="mt-4 flex flex-col gap-0.5">
            {progress.map((item) => {
              const domain = extractDomain(item.url)
              return (
                <div
                  key={item.url}
                  className="flex items-center gap-2.5 py-1.5 text-[12.5px]"
                >
                  <FavTile domain={domain} size={18} />
                  <span
                    className={cn(
                      "flex-1 font-mono",
                      item.status === "crawling" || item.status === "indexed"
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {domain || item.url}
                  </span>
                  {item.status === "indexed" && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        borderColor: "color-mix(in oklab, var(--success) 35%, transparent)",
                        background: "color-mix(in oklab, var(--success) 10%, transparent)",
                        color: "var(--success)",
                      }}
                    >
                      <Check className="size-[10px]" />
                      {t("crag.approval.crawlDone")}
                    </span>
                  )}
                  {item.status === "crawling" && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
                      style={{
                        borderColor: "color-mix(in oklab, var(--primary) 35%, transparent)",
                        background: "color-mix(in oklab, var(--primary) 10%, transparent)",
                        color: "var(--primary)",
                      }}
                    >
                      <Loader2 className="size-[10px] animate-spin" />
                      {t("crag.approval.crawlRunning")}
                    </span>
                  )}
                  {item.status === "failed" && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-destructive/35 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                      <X className="size-[10px]" />
                      {t("crag.approval.crawlFailed")}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </CardShell>
  )
}

// ── Partial failure card ──────────────────────────────────────────

function PartialCard({ progress = [] }: ApprovalCardPartialProps) {
  const { t } = useTranslation()

  const failed = progress.filter((p) => p.status === "failed")
  const succeeded = progress.filter((p) => p.status === "indexed")
  const totalChunks = succeeded.reduce((sum, p) => sum + (p.chunks ?? 0), 0)

  return (
    <CardShell
      className="border-warning/30"
    >
      {/* Warning header */}
      <div
        className="flex items-start gap-3 border-b px-4 py-3.5"
        style={{
          background: "color-mix(in oklab, var(--warning) 7%, transparent)",
          borderColor: "color-mix(in oklab, var(--warning) 25%, var(--border))",
        }}
      >
        <AlertTriangle className="mt-0.5 size-[18px] shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold text-foreground">
            {t("crag.approval.partialFailTitle", {
              failed: failed.length,
              total: progress.length,
            })}
          </div>
          <div className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground">
            {t("crag.approval.partialFailSubtitle", { chunks: totalChunks })}
          </div>
        </div>
      </div>

      {/* URL result list */}
      <div className="flex flex-col gap-0.5 px-4 py-3">
        {progress.map((item) => {
          const domain = extractDomain(item.url)
          return (
            <div
              key={item.url}
              className="flex items-center gap-2.5 py-2 text-[12.5px]"
            >
              <FavTile domain={domain} size={18} />
              <span className="flex-1 font-mono text-foreground">
                {domain || item.url}
              </span>
              {item.chunks != null && item.chunks > 0 && (
                <span className="rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
                  {t("crag.approval.chunksIndexed", { n: item.chunks })}
                </span>
              )}
              {item.status === "indexed" && (
                <span
                  className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: "color-mix(in oklab, var(--success) 35%, transparent)",
                    background: "color-mix(in oklab, var(--success) 10%, transparent)",
                    color: "var(--success)",
                  }}
                >
                  <Check className="size-[10px]" />
                  {t("crag.approval.crawlDone")}
                </span>
              )}
              {item.status === "failed" && (
                <span className="inline-flex items-center gap-1 rounded-full border border-destructive/35 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
                  <X className="size-[10px]" />
                  {t("crag.approval.crawlFailed")}
                </span>
              )}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

// ── Declined chip ────────────────────────────────────────────────

export function DeclinedChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5",
        "text-[12.5px] text-muted-foreground",
        className,
      )}
    >
      <Database className="size-[13px] shrink-0" />
      <span>{t("crag.declinedChip")}</span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────

function extractDomain(url: string): string {
  try {
    // If it already looks like a bare domain (no scheme), handle gracefully
    const withScheme = url.startsWith("http") ? url : `https://${url}`
    return new URL(withScheme).hostname.replace(/^www\./, "")
  } catch {
    return url
  }
}
