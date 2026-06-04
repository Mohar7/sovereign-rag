import { useState } from "react"
import {
  AlertTriangle,
  Check,
  CircleCheck,
  Database,
  Globe,
  Loader2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

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
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      {/* Globe tile + heading + paused badge */}
      <div
        style={{
          padding: "14px 16px 12px",
          display: "flex",
          alignItems: "flex-start",
          gap: 11,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 8,
            flexShrink: 0,
            background: "color-mix(in oklab, var(--primary) 12%, transparent)",
            color: "var(--primary)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Globe size={16} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--foreground)",
              lineHeight: 1.4,
            }}
          >
            {t("crag.approval.heading")}
          </div>
          {whyReason && (
            <div
              style={{
                fontSize: 12.5,
                color: "var(--muted-foreground)",
                lineHeight: 1.5,
                marginTop: 3,
              }}
            >
              {whyReason}
            </div>
          )}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            height: 21,
            padding: "0 7px",
            borderRadius: 6,
            flexShrink: 0,
            background: "color-mix(in oklab, var(--warning) 13%, transparent)",
            color: "var(--warning)",
            border: "1px solid color-mix(in oklab, var(--warning) 32%, transparent)",
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            fontWeight: 600,
          }}
        >
          {t("crag.approval.paused")}
        </span>
      </div>

      {/* Candidate rows */}
      <div
        style={{
          borderTop: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
        }}
      >
        {candidates.map((c, i) => {
          const isChecked = checked.has(c.url)
          const domain = extractDomain(c.url)
          return (
            <div
              key={c.url}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "9px 16px",
                borderBottom:
                  i < candidates.length - 1
                    ? "1px solid color-mix(in oklab, var(--border) 45%, transparent)"
                    : "none",
                cursor: "pointer",
              }}
              onClick={() => toggleOne(c.url)}
            >
              {/* Checkbox */}
              <span
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 4,
                  flexShrink: 0,
                  border: `1.5px solid ${isChecked ? "var(--primary)" : "var(--border)"}`,
                  background: isChecked ? "var(--primary)" : "transparent",
                  color: "#fff",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {isChecked && <Check size={11} />}
              </span>
              <FavTile domain={domain} size={18} />
              <span
                style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}
              >
                {domain}
              </span>
              <span
                style={{
                  fontSize: 12.5,
                  color: "var(--muted-foreground)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  flex: 1,
                }}
              >
                {c.title}
              </span>
              {c.verified === false && (
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--muted-foreground)",
                  }}
                >
                  {t("crag.approval.unverified")}
                </span>
              )}
            </div>
          )
        })}
      </div>

      {/* Footer */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "12px 16px",
          borderTop: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
          background: "var(--muted)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--muted-foreground)",
          }}
        >
          {t("crag.approval.selectedCount", {
            selected: checked.size,
            total: candidates.length,
          })}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onDecline}
          style={{
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "1px solid var(--border)",
            background: "var(--card)",
            color: "var(--foreground)",
            cursor: "pointer",
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
            boxShadow: "var(--shadow-sm)",
          }}
        >
          {t("actions.decline")}
        </button>
        <button
          type="button"
          onClick={handleApprove}
          disabled={checked.size === 0}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            height: 32,
            padding: "0 14px",
            borderRadius: 6,
            border: "none",
            background: "var(--primary)",
            color: "var(--primary-foreground)",
            cursor: checked.size === 0 ? "default" : "pointer",
            opacity: checked.size === 0 ? 0.5 : 1,
            fontFamily: "var(--font-sans)",
            fontSize: 13,
            fontWeight: 500,
          }}
        >
          <Check size={14} />
          {t("actions.approve")}
        </button>
      </div>
    </div>
  )
}

// ── Crawling card ─────────────────────────────────────────────────

function CrawlingCard({ progress = [] }: ApprovalCardCrawlingProps) {
  const { t } = useTranslation()

  const total = progress.length
  const done = progress.filter((p) => p.status === "indexed").length

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "12px 16px",
          borderBottom: "1px solid color-mix(in oklab, var(--border) 60%, transparent)",
        }}
      >
        <Loader2
          size={14}
          className="animate-spin"
          style={{ color: "var(--primary)" }}
        />
        <span
          style={{ fontSize: 13.5, fontWeight: 600, color: "var(--foreground)" }}
        >
          {t("crag.approval.crawlingHeader")}
        </span>
        <span style={{ flex: 1 }} />
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11.5,
            color: "var(--muted-foreground)",
          }}
        >
          {t("crag.approval.crawlingIndexed", { done, total })}
        </span>
      </div>

      {/* Per-URL rows */}
      {progress.map((item, i) => {
        const domain = extractDomain(item.url)
        const isDone = item.status === "indexed"
        const isCrawling = item.status === "crawling"
        const isFailed = item.status === "failed"
        // pct: done=100, crawling=indeterminate shown as 50, failed=100, queued=0
        const pct = isDone ? 100 : isFailed ? 100 : isCrawling ? 55 : 0
        return (
          <div
            key={item.url}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 16px",
              borderBottom:
                i < progress.length - 1
                  ? "1px solid color-mix(in oklab, var(--border) 45%, transparent)"
                  : "none",
            }}
          >
            <FavTile domain={domain} size={18} />
            <span
              style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}
            >
              {domain}
            </span>
            <span style={{ flex: 1, minWidth: 20 }}>
              <span
                style={{
                  display: "block",
                  height: 3,
                  borderRadius: 999,
                  background: "var(--muted)",
                  overflow: "hidden",
                }}
              >
                <span
                  style={{
                    display: "block",
                    height: "100%",
                    width: `${pct}%`,
                    background: isFailed ? "var(--destructive)" : "var(--primary)",
                    borderRadius: 999,
                    transition: "width 300ms",
                  }}
                />
              </span>
            </span>
            {isDone && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--success)",
                }}
              >
                <CircleCheck size={13} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--success)",
                  }}
                >
                  {item.chunks != null
                    ? t("crag.approval.chunksIndexed", { n: item.chunks })
                    : t("crag.approval.crawlDone")}
                </span>
              </span>
            )}
            {isCrawling && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--primary)",
                }}
              >
                <Loader2 size={12} className="animate-spin" />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--primary)",
                  }}
                >
                  {t("crag.approval.crawlRunning")}
                </span>
              </span>
            )}
            {isFailed && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--destructive)",
                }}
              >
                <AlertTriangle size={12} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--destructive)",
                  }}
                >
                  {t("crag.approval.crawlFailed")}
                </span>
              </span>
            )}
            {!isDone && !isCrawling && !isFailed && (
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                }}
              >
                {t("crag.approval.crawlQueued")}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Receipt card ──────────────────────────────────────────────────

function ReceiptCard({ progress = [] }: ApprovalCardReceiptProps) {
  const { t } = useTranslation()

  if (progress.length === 0) return null

  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 10,
        background: "var(--card)",
        overflow: "hidden",
      }}
    >
      {progress.map((item, i) => {
        const domain = extractDomain(item.url)
        const isDone = item.status === "indexed"
        const isFailed = item.status === "failed"
        return (
          <div
            key={item.url}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "9px 16px",
              borderBottom:
                i < progress.length - 1
                  ? "1px solid color-mix(in oklab, var(--border) 45%, transparent)"
                  : "none",
            }}
          >
            <FavTile domain={domain} size={18} />
            <span
              style={{ fontSize: 13, fontWeight: 500, color: "var(--foreground)" }}
            >
              {domain}
            </span>
            <span style={{ flex: 1 }} />
            {isDone && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--success)",
                }}
              >
                <CircleCheck size={13} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--success)",
                  }}
                >
                  {item.chunks != null
                    ? t("crag.approval.chunksIndexed", { n: item.chunks })
                    : t("crag.approval.crawlDone")}
                </span>
              </span>
            )}
            {isFailed && (
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 5,
                  color: "var(--destructive)",
                }}
              >
                <AlertTriangle size={13} />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "var(--destructive)",
                  }}
                >
                  {t("crag.approval.crawlFailed")}
                </span>
              </span>
            )}
          </div>
        )
      })}
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
