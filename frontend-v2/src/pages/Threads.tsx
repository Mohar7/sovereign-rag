import { useMemo, useState } from "react"
import {
  Loader2,
  MessageSquare,
  MoreHorizontal,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import { ThreadDetailSheet } from "@/components/threads/thread-detail-sheet"
import { useDeleteThread, useThreadsList } from "@/hooks/use-threads"
import { api, type ThreadSummary } from "@/lib/api"
import { cn, downloadJSON } from "@/lib/utils"

export function ThreadsPage() {
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [openThread, setOpenThread] = useState<ThreadSummary | null>(null)
  const threads = useThreadsList()
  const deleteThread = useDeleteThread()

  const handleContinue = (threadId: string) => {
    const next = `/?thread=${encodeURIComponent(threadId)}`
    window.history.pushState({}, "", next)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  const handleExport = async (thread: ThreadSummary) => {
    const tid = toast.loading("Building export…")
    try {
      const messages = await api.threadMessages(thread.thread_id)
      downloadJSON(
        {
          generated_at: new Date().toISOString(),
          thread,
          messages,
        },
        `thread-${thread.thread_id.slice(0, 8)}.json`,
      )
      toast.success("Exported.", { id: tid })
    } catch (err) {
      toast.error(`Export failed: ${(err as Error).message}`, { id: tid })
    }
  }

  const filtered = useMemo<ThreadSummary[]>(() => {
    const all = threads.data ?? []
    if (!query.trim()) return all
    const q = query.toLowerCase()
    return all.filter(
      (t) =>
        (t.question ?? "").toLowerCase().includes(q) ||
        (t.answer_snippet ?? "").toLowerCase().includes(q) ||
        t.thread_id.toLowerCase().includes(q),
    )
  }, [threads.data, query])

  const selectedIds = Object.keys(selected).filter((id) => selected[id])
  const toggle = (id: string) =>
    setSelected((prev) => ({ ...prev, [id]: !prev[id] }))

  const bulkDelete = async () => {
    if (selectedIds.length === 0) return
    let ok = 0
    let fail = 0
    for (const id of selectedIds) {
      try {
        await deleteThread.mutateAsync(id)
        ok++
      } catch {
        fail++
      }
    }
    if (fail === 0) {
      toast.success(`Deleted ${ok} thread${ok === 1 ? "" : "s"}.`)
    } else {
      toast.error(`${ok} deleted, ${fail} failed.`)
    }
    setSelected({})
  }

  const total = (threads.data ?? []).length

  return (
    <div className="flex h-[calc(100svh-4rem)] min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">Threads</h1>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {threads.isLoading
              ? "loading…"
              : `${filtered.length} of ${total}`}
          </span>
          <div className="relative ml-3 w-64">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              placeholder="Search threads…"
              className="pl-8 h-8 text-[13px]"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="clear"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            )}
          </div>
          {selectedIds.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Badge className="font-mono text-[10.5px]">
                {selectedIds.length} selected
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={bulkDelete}
                disabled={deleteThread.isPending}
              >
                {deleteThread.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" strokeWidth={2} />
                )}
                Delete
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={() => setSelected({})}
              >
                <X className="size-3.5" strokeWidth={2} />
              </Button>
            </div>
          )}
          <span className="ml-auto" />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => void threads.refetch()}
          >
            <RefreshCw
              className={cn(
                "size-3.5",
                threads.isFetching && "animate-spin",
              )}
              strokeWidth={2}
            />
            Refresh
          </Button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-6">
            {threads.isLoading ? (
              <SkeletonGrid />
            ) : filtered.length === 0 ? (
              <EmptyState total={total} hasQuery={query.length > 0} />
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {filtered.map((t) => (
                  <ThreadCard
                    key={t.thread_id}
                    thread={t}
                    selected={!!selected[t.thread_id]}
                    onToggle={() => toggle(t.thread_id)}
                    onOpen={() => setOpenThread(t)}
                    onExport={() => void handleExport(t)}
                    onDelete={async () => {
                      try {
                        await deleteThread.mutateAsync(t.thread_id)
                        toast.success("Thread deleted.")
                      } catch (err) {
                        toast.error((err as Error).message)
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <ThreadDetailSheet
        thread={openThread}
        open={openThread !== null}
        onOpenChange={(o) => !o && setOpenThread(null)}
        onContinue={handleContinue}
        onDeleted={() => void threads.refetch()}
      />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Card
// ─────────────────────────────────────────────────────────────────

function ThreadCard({
  thread,
  selected,
  onToggle,
  onOpen,
  onExport,
  onDelete,
}: {
  thread: ThreadSummary
  selected: boolean
  onToggle: () => void
  onOpen: () => void
  onExport: () => void
  onDelete: () => void
}) {
  return (
    <article
      className={cn(
        "group relative flex flex-col gap-3 rounded-xl border bg-card p-4 transition-colors",
        selected
          ? "border-primary/60 ring-2 ring-primary/20"
          : "border-border hover:bg-muted/30",
      )}
    >
      <div className="flex items-start gap-2.5">
        <Checkbox
          checked={selected}
          onCheckedChange={onToggle}
          aria-label="select thread"
          className="mt-0.5"
          onClick={(e) => e.stopPropagation()}
        />
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
        >
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <MessageSquare className="size-3.5" strokeWidth={2} />
          </span>
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-[14px] font-medium leading-[1.4] text-foreground">
              {thread.question || "(untitled thread)"}
            </h3>
            <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
              {thread.thread_id.slice(0, 16)}…
            </span>
          </div>
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
              aria-label="thread menu"
            >
              <MoreHorizontal className="size-3.5" strokeWidth={2} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuLabel>Thread</DropdownMenuLabel>
            <DropdownMenuItem onClick={onOpen}>Open</DropdownMenuItem>
            <DropdownMenuItem onClick={onExport}>Export JSON</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={onDelete}>
              <Trash2 className="size-3.5" strokeWidth={2} /> Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <button
        type="button"
        onClick={onOpen}
        className="flex flex-col gap-2 text-left"
      >
        {thread.answer_snippet && (
          <p className="line-clamp-3 text-[12.5px] leading-[1.55] text-muted-foreground">
            {thread.answer_snippet}
          </p>
        )}

        <div className="mt-auto flex items-center gap-2 pt-1">
          {thread.citations > 0 && (
            <Badge variant="secondary" className="font-mono text-[10.5px]">
              {thread.citations} citation{thread.citations === 1 ? "" : "s"}
            </Badge>
          )}
          {thread.updated_at && (
            <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
              {thread.updated_at.slice(0, 19)}
            </span>
          )}
        </div>
      </button>
    </article>
  )
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-start gap-2.5">
            <Skeleton className="mt-0.5 size-4" />
            <Skeleton className="size-7 rounded-md" />
            <div className="flex-1">
              <Skeleton className="h-4 w-44" />
              <Skeleton className="mt-1 h-3 w-24" />
            </div>
          </div>
          <Skeleton className="mt-3 h-3 w-full" />
          <Skeleton className="mt-1.5 h-3 w-5/6" />
        </div>
      ))}
    </div>
  )
}

function EmptyState({
  total,
  hasQuery,
}: {
  total: number
  hasQuery: boolean
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-2 py-16 text-center">
      <div className="inline-flex size-10 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <MessageSquare className="size-5" strokeWidth={1.75} />
      </div>
      <h2 className="text-[16px] font-semibold text-foreground">
        {hasQuery ? "No threads match your search." : "No threads yet."}
      </h2>
      <p className="text-[13px] leading-[1.55] text-muted-foreground">
        {hasQuery
          ? `${total} thread${total === 1 ? "" : "s"} indexed, but none contain that string.`
          : "Threads appear here after you ask a question from the Ask page."}
      </p>
    </div>
  )
}
