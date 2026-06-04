import { Copy, Eye, Globe, RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Separator } from "@/components/ui/separator"

export function UserTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end" style={{ marginBottom: 22 }}>
      <div
        style={{
          maxWidth: "76%",
          background: "var(--secondary)",
          color: "var(--secondary-foreground)",
          padding: "9px 13px",
          borderRadius: 8,
          fontSize: 13.5,
          lineHeight: 1.5,
          border: "1px solid color-mix(in oklab, var(--border) 70%, transparent)",
        }}
      >
        {children}
      </div>
    </div>
  )
}

export interface AssistantTurnProps {
  children: React.ReactNode
  compact?: boolean
  showActions?: boolean
  /** Text to copy when the Copy button is clicked. Falls back to children rendering. */
  copyText?: string
  /** Re-submit handler — typically re-runs the original question with the same thread_id. */
  onRegenerate?: () => void
  /** Open the per-turn inspector. */
  onOpenInspector?: () => void
  /** Show the "corrected via web" provenance chip in the actions row. */
  showProvenance?: boolean
  /** Show the "declined web search" chip in the actions row. */
  showDeclined?: boolean
}

export function AssistantTurn({
  children,
  compact = false,
  showActions = true,
  copyText,
  onRegenerate,
  onOpenInspector,
  showProvenance = false,
  showDeclined = false,
}: AssistantTurnProps) {
  const { t } = useTranslation()
  const handleCopy = () => {
    if (!copyText) return
    void navigator.clipboard
      .writeText(copyText)
      .then(() => toast.success(t("pages.ask.copiedToast")))
      .catch(() => toast.error(t("pages.ask.copyFailedToast")))
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
        <BrandMark size={16} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-[14px] leading-[1.55] text-foreground">{children}</div>
        {!compact && showActions && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              marginTop: 14,
              color: "var(--muted-foreground)",
            }}
          >
            <ActionBtn
              icon={Copy}
              label={t("actions.copy")}
              onClick={handleCopy}
              disabled={!copyText}
            />
            <ActionBtn
              icon={RefreshCw}
              label={t("actions.regenerate")}
              onClick={onRegenerate}
              disabled={!onRegenerate}
            />
            <Separator orientation="vertical" style={{ width: 1, height: 14, margin: "0 6px" }} />
            <ActionBtn
              icon={Eye}
              label={t("pages.ask.viewTrace")}
              onClick={onOpenInspector}
              disabled={!onOpenInspector}
            />
            {showProvenance && (
              <>
                <span
                  aria-hidden
                  style={{ width: 1, height: 14, background: "var(--border)", margin: "0 6px" }}
                />
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 22,
                    padding: "0 8px",
                    borderRadius: 6,
                    background:
                      "color-mix(in oklab, var(--primary) 9%, transparent)",
                    color: "var(--primary)",
                    border:
                      "1px solid color-mix(in oklab, var(--primary) 26%, transparent)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  <Globe size={11} />
                  {t("crag.correctedViaWeb")}
                </span>
              </>
            )}
            {showDeclined && (
              <>
                <span
                  aria-hidden
                  style={{ width: 1, height: 14, background: "var(--border)", margin: "0 6px" }}
                />
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    height: 22,
                    padding: "0 8px",
                    borderRadius: 6,
                    background: "var(--muted)",
                    color: "var(--muted-foreground)",
                    border: "1px solid var(--border)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 500,
                  }}
                >
                  {t("crag.declinedChip")}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── ActionBtn — low-key action button matching the design spec ────

interface ActionBtnProps {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>
  label: string
  onClick?: () => void
  disabled?: boolean
}

export function ActionBtn({ icon: Icon, label, onClick, disabled }: ActionBtnProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="sr-action"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 28,
        padding: "0 9px",
        borderRadius: 6,
        border: "1px solid transparent",
        background: "transparent",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.45 : 1,
        color: "var(--muted-foreground)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
        fontWeight: 500,
      }}
    >
      <Icon size={13} strokeWidth={2} />
      {label}
    </button>
  )
}

export function AssistantMeta({
  parts,
}: {
  parts: Array<{ kind: "text"; text: string } | { kind: "dot" }>
}) {
  return (
    <>
      {parts.map((p, i) =>
        p.kind === "dot" ? (
          <span key={i} aria-hidden>
            ·
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  )
}
