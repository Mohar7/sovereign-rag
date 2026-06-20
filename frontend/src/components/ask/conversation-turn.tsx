import { AlertTriangle, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { ApprovalCard, type CrawlProgressItem } from "@/components/ask/approval-card"
import { MarkdownAnswer } from "@/components/ask/markdown-answer"
import { ProcessBlock } from "@/components/ask/process-block"
import { SourcesDisclosure } from "@/components/ask/sources-disclosure"
import { AssistantTurn, UserTurn } from "@/components/ask/turns"
import { Button } from "@/components/ui/button"
import type { AskOverrides, CandidateUrl, CitationModel, RetrievalTrace } from "@/lib/api"

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
  /** Per-leg + rerank retrieval provenance for this turn (inspector overlay). */
  retrieval?: RetrievalTrace
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
  onDismiss,
}: {
  turn: Turn
  onRegenerate?: () => void
  onOpenInspector?: () => void
  onOpenSource?: (cite: CitationModel) => void
  onApprove?: (urls: string[]) => void
  onDecline?: () => void
  onDismiss?: () => void
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
        <ErrorBanner message={turn.error ?? t("pages.ask.requestFailed")} onDismiss={onDismiss} />
      )}

      {turn.status === "ok" && (
        <AssistantTurn
          copyText={turn.answer ?? ""}
          onRegenerate={onRegenerate}
          onOpenInspector={onOpenInspector}
          showProvenance={!!turn.fallbackUsed}
          showDeclined={!!turn.declined}
        >
          <ProcessBlock
            steps={turn.agentSteps ?? []}
            status={turn.status}
            totalMs={turn.totalMs}
            fallbackUsed={turn.fallbackUsed}
            declined={turn.declined}
          />
          <MarkdownAnswer
            answer={turn.answer ?? ""}
            citations={turn.citations ?? []}
            onOpenSource={onOpenSource}
          />
          {turn.fallbackUsed && (turn.crawlProgress?.length ?? 0) > 0 && (
            <div className="mt-3">
              <ApprovalCard state="receipt" progress={turn.crawlProgress} />
            </div>
          )}
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

function ErrorBanner({ message, onDismiss }: { message: string; onDismiss?: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid color-mix(in oklab, var(--warning) 32%, transparent)",
        background: "color-mix(in oklab, var(--warning) 7%, transparent)",
        marginBottom: 22,
      }}
    >
      <AlertTriangle
        size={16}
        strokeWidth={2}
        style={{ color: "var(--warning)", flexShrink: 0, marginTop: 1 }}
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--foreground)", marginBottom: 2 }}>
          {t("pages.ask.askCallFailed")}
        </div>
        <div
          style={{
            fontSize: 12.5,
            color: "var(--muted-foreground)",
            lineHeight: 1.55,
            wordBreak: "break-word",
          }}
        >
          {message}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon"
        className="size-8 shrink-0"
        aria-label={t("pages.ask.dismiss")}
        onClick={onDismiss}
      >
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
  )
}
