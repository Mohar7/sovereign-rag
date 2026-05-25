import { Copy, Eye, RefreshCw } from "lucide-react"
import { toast } from "sonner"

import { BrandMark } from "@/components/brand-mark"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"

export function UserTurn({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="flex max-w-[85%] items-start gap-3">
        <div className="rounded-2xl bg-secondary px-4 py-3 text-[15px] leading-[1.55] text-secondary-foreground">
          {children}
        </div>
        <Avatar className="mt-0.5 size-7 bg-[var(--indigo-100)] text-[color:var(--indigo-700)]">
          <AvatarFallback className="bg-transparent text-[11px] font-medium">
            MK
          </AvatarFallback>
        </Avatar>
      </div>
    </div>
  )
}

export interface AssistantTurnProps {
  children: React.ReactNode
  meta?: React.ReactNode
  compact?: boolean
  showActions?: boolean
  /** Text to copy when the Copy button is clicked. Falls back to children rendering. */
  copyText?: string
  /** Re-submit handler — typically re-runs the original question with the same thread_id. */
  onRegenerate?: () => void
  /** Open the per-turn inspector. */
  onOpenInspector?: () => void
}

export function AssistantTurn({
  children,
  meta,
  compact = false,
  showActions = true,
  copyText,
  onRegenerate,
  onOpenInspector,
}: AssistantTurnProps) {
  const handleCopy = () => {
    if (!copyText) return
    void navigator.clipboard
      .writeText(copyText)
      .then(() => toast.success("Copied."))
      .catch(() => toast.error("Couldn't copy — clipboard permission?"))
  }

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <BrandMark size={16} />
      </div>
      <div className="min-w-0 flex-1">
        {!compact && meta && (
          <div className="mb-2 flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
            {meta}
          </div>
        )}
        <div className="text-[15px] leading-[1.65] text-foreground">{children}</div>
        {!compact && showActions && (
          <div className="mt-3.5 flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="copy"
              onClick={handleCopy}
              disabled={!copyText}
              title="Copy answer text"
            >
              <Copy className="size-3.5" strokeWidth={2} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              aria-label="regenerate"
              onClick={onRegenerate}
              disabled={!onRegenerate}
              title="Re-run this question"
            >
              <RefreshCw className="size-3.5" strokeWidth={2} />
            </Button>
            <Separator orientation="vertical" className="mx-1 h-4" />
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1.5 px-2 text-[12px]"
              onClick={onOpenInspector}
              disabled={!onOpenInspector}
            >
              <Eye className="size-3.5" strokeWidth={2} />
              Open inspector
            </Button>
          </div>
        )}
      </div>
    </div>
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
