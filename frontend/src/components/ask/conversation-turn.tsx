import { AlertTriangle, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ApprovalCard, DeclinedChip, type CrawlProgressItem } from "@/components/ask/approval-card"
import { MarkdownAnswer } from "@/components/ask/markdown-answer"
import { ProcessBlock } from "@/components/ask/process-block"
import { SourcesDisclosure } from "@/components/ask/sources-disclosure"
import { AssistantTurn, UserTurn } from "@/components/ask/turns"
import { ProvenanceBadge } from "@/components/crag/provenance-badge"
import { Button } from "@/components/ui/button"
import type { AskOverrides, CandidateUrl, CitationModel } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// Turn — the data shape for one user↔assistant exchange.
// Owned here (the renderer owns its data shape). Ask.tsx imports it.
// ─────────────────────────────────────────────────────────────────

export interface Turn {
  id: number
  question: string
  status: "pending" | "awaiting_approval" | "crawling" | "ok" | "error"
  answer?: string | null
  citations?: CitationModel[]
  retrieved?: number
  used?: number
  error?: string
  threadId?: string
  /** The overrides that were in effect when this turn was submitted. */
  overrides?: AskOverrides | null
  /** Total elapsed ms — populated on the final done event. */
  totalMs?: number
  /** Candidate URLs surfaced by the interrupt event. */
  candidateUrls?: CandidateUrl[]
  /** Per-URL crawl progress events. */
  crawlProgress?: CrawlProgressItem[]
  /** True when the answer was augmented by a web fallback crawl. */
  fallbackUsed?: boolean
  /** True when the user declined the web fallback. */
  declined?: boolean
  /** Ordered agent tool steps for this turn (ReAct mode). */
  agentSteps?: { tool: string }[]
}

// ─────────────────────────────────────────────────────────────────
// ConversationTurn — renders one full user+assistant exchange.
// Replaces the inline definition that used to live in Ask.tsx.
// ─────────────────────────────────────────────────────────────────

export function ConversationTurn({
  turn,
  onRegenerate,
  onOpenInspector,
  onOpenSource,
  onApprove,
  onDecline,
}: {
  turn: Turn
  onRegenerate?: () => void
  onOpenInspector?: () => void
  onOpenSource?: (cite: CitationModel) => void
  onApprove?: (urls: string[]) => void
  onDecline?: () => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <UserTurn>{turn.question}</UserTurn>

      {turn.status === "pending" && (
        <AssistantTurn showActions={false}>
          {/* Streaming status indicator */}
          <div className="mb-2 flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
            <span
              aria-hidden
              className="size-1.5 rounded-full bg-primary"
              style={{
                boxShadow:
                  "0 0 0 3px color-mix(in oklab, var(--primary) 22%, transparent)",
                animation: "sr-pulse 1.4s ease-in-out infinite",
              }}
            />
            <span className="text-primary">{t("status.streaming")}</span>
          </div>
          <ProcessBlock
            steps={turn.agentSteps ?? []}
            status={turn.status}
            totalMs={turn.totalMs}
            fallbackUsed={turn.fallbackUsed}
            declined={turn.declined}
          />
          {turn.answer && turn.answer.length > 0 ? (
            <MarkdownAnswer
              answer={turn.answer + "▍"}
              citations={turn.citations ?? []}
              onOpenSource={onOpenSource}
            />
          ) : (
            <p className="text-muted-foreground">
              {t("pages.ask.retrievingReranking")}
              <span
                aria-hidden
                className="ml-1 inline-block align-[-3px]"
                style={{
                  background: "var(--primary)",
                  width: 8,
                  height: 16,
                  animation: "sr-blink 1.1s steps(2) infinite",
                }}
              />
            </p>
          )}
        </AssistantTurn>
      )}

      {turn.status === "awaiting_approval" && (
        <AssistantTurn showActions={false}>
          <ProcessBlock
            steps={turn.agentSteps ?? []}
            status={turn.status}
            totalMs={turn.totalMs}
            fallbackUsed={turn.fallbackUsed}
            declined={turn.declined}
          />
          <ApprovalCard
            state="deciding"
            candidates={turn.candidateUrls ?? []}
            question={turn.question}
            onApprove={onApprove ?? (() => {})}
            onDecline={onDecline ?? (() => {})}
          />
        </AssistantTurn>
      )}

      {turn.status === "crawling" && (
        <AssistantTurn showActions={false}>
          <ProcessBlock
            steps={turn.agentSteps ?? []}
            status={turn.status}
            totalMs={turn.totalMs}
            fallbackUsed={turn.fallbackUsed}
            declined={turn.declined}
          />
          <ApprovalCard state="crawling" progress={turn.crawlProgress ?? []} />
        </AssistantTurn>
      )}

      {turn.status === "error" && (
        <ErrorBanner message={turn.error ?? t("pages.ask.requestFailed")} />
      )}

      {turn.status === "ok" && (
        <AssistantTurn
          copyText={turn.answer ?? ""}
          onRegenerate={onRegenerate}
          onOpenInspector={onOpenInspector}
        >
          <ProcessBlock
            steps={turn.agentSteps ?? []}
            status={turn.status}
            totalMs={turn.totalMs}
            fallbackUsed={turn.fallbackUsed}
            declined={turn.declined}
          />
          {turn.declined && (
            <div className="mb-3">
              <DeclinedChip />
            </div>
          )}
          {turn.fallbackUsed && (
            <div className="mb-2">
              <ProvenanceBadge />
            </div>
          )}
          <MarkdownAnswer
            answer={turn.answer ?? ""}
            citations={turn.citations ?? []}
            onOpenSource={onOpenSource}
          />
          <SourcesDisclosure
            citations={turn.citations ?? []}
            onOpenSource={onOpenSource}
          />
        </AssistantTurn>
      )}
    </>
  )
}

// ─────────────────────────────────────────────────────────────────
// ErrorBanner
// ─────────────────────────────────────────────────────────────────

function ErrorBanner({ message }: { message: string }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex items-start gap-3 rounded-xl border p-4"
      style={{
        background: "color-mix(in oklab, var(--destructive) 6%, transparent)",
        borderColor: "color-mix(in oklab, var(--destructive) 35%, transparent)",
      }}
    >
      <AlertTriangle
        className="mt-0.5 size-[18px] shrink-0 text-[color:var(--destructive)]"
        strokeWidth={2}
      />
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-foreground">
          {t("pages.ask.askCallFailed")}
        </div>
        <div className="mt-1 break-words font-mono text-[12px] leading-[1.55] text-muted-foreground">
          {message}
        </div>
      </div>
      <Button variant="ghost" size="icon" className="size-8" aria-label={t("pages.ask.dismiss")}>
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
  )
}
