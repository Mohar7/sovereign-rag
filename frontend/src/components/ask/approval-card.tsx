import { useState } from "react"
import {
  Check,
  Database,
  Globe,
  Loader2,
  X,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { FavTile } from "@/components/crag/fav-tile"
import { cn } from "@/lib/utils"
import type { CandidateUrl, GradeModel } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// ApprovalCard
//
// Three-state card for the HITL web-fallback approval flow:
//   deciding  — user previews candidate URLs + approves or declines
//   crawling  — per-URL progress while crawl is in flight
//   receipt   — compact completion line (all indexed / some failed)
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

// ── (c) Receipt ──────────────────────────────────────────────────

export interface ApprovalCardReceiptProps {
  state: "receipt"
  progress?: CrawlProgressItem[]
}

export type ApprovalCardProps =
  | ApprovalCardDecidingProps
  | ApprovalCardCrawlingProps
  | ApprovalCardReceiptProps

export function ApprovalCard(props: ApprovalCardProps) {
  if (props.state === "deciding") return <DecidingCard {...props} />
  if (props.state === "crawling") return <CrawlingCard {...props} />
  return <ReceiptCard {...(props as ApprovalCardReceiptProps)} />
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

  // Extract a "why" reason from grade if present
  const whyReason = grade?.reason ?? null

  return (
    <CardShell>
      {/* Heading */}
      <div className="border-b border-border px-4 py-3.5">
        <div className="text-[14px] font-semibold leading-[1.3] text-foreground">
          {t("crag.approval.heading")}
        </div>
        {whyReason && (
          <div className="mt-1 text-[12.5px] leading-[1.55] text-muted-foreground line-clamp-1">
            <span className="mr-1 font-medium text-foreground">{t("crag.approval.why")}:</span>
            {whyReason}
          </div>
        )}
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
              !isLast && "border-b",
              isChecked && "bg-primary/[0.05]",
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
                  {extractDomain(c.url)}
                </span>
                <Globe className="size-3 shrink-0 text-muted-foreground" />
                {c.verified === false && (
                  <span className="rounded-[2px] border border-border bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                    {t("crag.approval.unverified")}
                  </span>
                )}
              </div>
              {c.title && (
                <div className="mt-0.5 text-[12.5px] leading-[1.55] text-muted-foreground line-clamp-1">
                  {c.title}
                </div>
              )}
              <div className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[11px] text-muted-foreground">
                {c.url}
              </div>
            </div>
          </div>
        )
      })}

      {/* Approve / Decline actions */}
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
            {t("actions.decline")}
          </Button>
          <Button
            variant="default"
            size="sm"
            className="flex-1 gap-1.5 font-semibold sm:flex-none"
            onClick={handleApprove}
            disabled={checked.size === 0}
          >
            {t("actions.approve")}
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

        {/* Per-URL status list */}
        {progress.length > 0 && (
          <div className="flex flex-col gap-0.5">
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

// ── Receipt card ──────────────────────────────────────────────────

function ReceiptCard({ progress = [] }: ApprovalCardReceiptProps) {
  const { t } = useTranslation()
  const indexed = progress.filter((p) => p.status === "indexed").length
  const failed = progress.filter((p) => p.status === "failed").length
  const totalChunks = progress.reduce((sum, p) => sum + (p.chunks ?? 0), 0)

  return (
    <div
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-1.5",
        "text-[12.5px] text-muted-foreground",
      )}
    >
      <Check className="size-[13px] shrink-0 text-success" />
      <span>
        {indexed > 0
          ? t("crag.approval.chunksIndexed", { n: totalChunks })
          : null}
        {failed > 0 && indexed > 0 ? " · " : null}
        {failed > 0
          ? t("crag.approval.crawlFailed")
          : null}
      </span>
    </div>
  )
}

// ── Declined chip (kept exported — Ask.tsx imports it directly) ──

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
