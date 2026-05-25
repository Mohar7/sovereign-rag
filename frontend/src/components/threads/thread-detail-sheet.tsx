import { ArrowRight, Bot, Copy, Download, Loader2, MessageSquare, Trash2, User } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { useDeleteThread, useThreadMessages } from "@/hooks/use-threads"
import type { ThreadMessage, ThreadSummary } from "@/lib/api"
import { downloadJSON } from "@/lib/utils"

interface Props {
  thread: ThreadSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onContinue: (threadId: string) => void
  onDeleted?: () => void
}

export function ThreadDetailSheet({
  thread,
  open,
  onOpenChange,
  onContinue,
  onDeleted,
}: Props) {
  const messages = useThreadMessages(thread?.thread_id ?? null)
  const deleteThread = useDeleteThread()

  const handleDelete = async () => {
    if (!thread) return
    try {
      await deleteThread.mutateAsync(thread.thread_id)
      toast.success("Thread deleted.")
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleContinue = () => {
    if (!thread) return
    onContinue(thread.thread_id)
    onOpenChange(false)
  }

  const handleExport = () => {
    if (!thread) return
    downloadJSON(
      {
        generated_at: new Date().toISOString(),
        thread,
        messages: messages.data ?? [],
      },
      `thread-${thread.thread_id.slice(0, 8)}.json`,
    )
    toast.success("Exported.")
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[640px] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <MessageSquare className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="line-clamp-2 text-[15px] font-semibold leading-[1.35]">
                {thread?.question || "Thread"}
              </SheetTitle>
              {thread && (
                <SheetDescription className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {thread.thread_id}
                </SheetDescription>
              )}
            </div>
          </div>
          {thread && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {thread.citations > 0 && (
                <Badge variant="secondary" className="font-mono text-[10.5px]">
                  {thread.citations} citation{thread.citations === 1 ? "" : "s"}
                </Badge>
              )}
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {(messages.data ?? []).length} message
                {(messages.data ?? []).length === 1 ? "" : "s"}
              </Badge>
              <Button
                variant="default"
                size="sm"
                className="ml-auto h-7 gap-1.5"
                onClick={handleContinue}
              >
                Continue
                <ArrowRight className="size-3" strokeWidth={2} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5"
                onClick={handleExport}
                disabled={messages.isLoading}
              >
                <Download className="size-3" strokeWidth={2} />
                Export
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={handleDelete}
                disabled={deleteThread.isPending}
              >
                {deleteThread.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" strokeWidth={2} />
                )}
                Delete
              </Button>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1">
          <div className="p-5 space-y-4">
            {messages.isLoading && (
              <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> loading conversation…
              </div>
            )}
            {messages.error && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px] text-destructive">
                {messages.error.message}
              </div>
            )}
            {!messages.isLoading && (messages.data?.length ?? 0) === 0 && !messages.error && (
              <div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-[13px] text-muted-foreground">
                No messages stored for this thread.
              </div>
            )}
            {(messages.data ?? []).map((m, i) => (
              <MessageBlock key={i} message={m} />
            ))}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

function MessageBlock({ message }: { message: ThreadMessage }) {
  const isUser = message.role === "user"
  return (
    <article className="flex gap-3">
      <span
        className={
          isUser
            ? "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            : "inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
        }
      >
        {isUser ? (
          <User className="size-3.5" strokeWidth={2} />
        ) : (
          <Bot className="size-3.5" strokeWidth={2} />
        )}
      </span>
      <div className="min-w-0 flex-1 space-y-2">
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium uppercase tracking-wide">
            {isUser ? "You" : "Assistant"}
          </span>
          {!isUser && message.retrieved > 0 && (
            <span className="font-mono tabular-nums">
              {message.used} of {message.retrieved} chunks
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              void navigator.clipboard.writeText(message.content)
              toast.success("Copied.")
            }}
            className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-muted"
            aria-label="copy message"
          >
            <Copy className="size-3" strokeWidth={2} />
          </button>
        </div>
        <div
          className={
            isUser
              ? "rounded-lg bg-muted/40 px-3.5 py-2.5 text-[13.5px] leading-[1.55] text-foreground"
              : "rounded-lg border border-border bg-card px-3.5 py-2.5 text-[13.5px] leading-[1.55] text-foreground whitespace-pre-wrap"
          }
        >
          {message.content || (
            <span className="italic text-muted-foreground">(empty)</span>
          )}
        </div>
        {!isUser && message.citations.length > 0 && (
          <details className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 text-[12px]">
            <summary className="cursor-pointer select-none font-medium text-foreground">
              {message.citations.length} citation
              {message.citations.length === 1 ? "" : "s"}
            </summary>
            <ol className="mt-2 space-y-1.5">
              {message.citations.map((c, i) => (
                <li key={c.chunk_id + i} className="flex items-baseline gap-2 text-[11.5px]">
                  <span className="font-mono font-semibold text-primary">[{i + 1}]</span>
                  <span className="truncate text-foreground">
                    {c.title || c.source_uri || c.doc_id || c.chunk_id}
                  </span>
                  {c.page !== null && c.page !== undefined && (
                    <span className="font-mono text-muted-foreground">p.{c.page}</span>
                  )}
                  <span className="ml-auto font-mono tabular-nums text-muted-foreground">
                    {c.score.toFixed(2)}
                  </span>
                </li>
              ))}
            </ol>
          </details>
        )}
      </div>
    </article>
  )
}
