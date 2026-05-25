import { Ban, Loader2, Pin, PinOff, Plus, Trash2 } from "lucide-react"
import { useState } from "react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  useThreadContext,
  useThreadContextClear,
  useThreadContextDelete,
  useThreadContextUpsert,
} from "@/hooks/use-thread-context"
import type { PinAction, PinEntry } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// ContextManagerSheet
//
// Right-side Sheet anchored to the active thread. Pinned chunks ride
// through every subsequent /ask turn; excluded chunks are blacklisted.
// State lives entirely server-side under /api/threads/{id}/context — this
// component is a thin form over those endpoints.
// ─────────────────────────────────────────────────────────────────

interface Props {
  threadId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ContextManagerSheet({ threadId, open, onOpenChange }: Props) {
  const ctx = useThreadContext(threadId)
  const upsert = useThreadContextUpsert(threadId)
  const remove = useThreadContextDelete(threadId)
  const clear = useThreadContextClear(threadId)

  const [draftChunkId, setDraftChunkId] = useState("")
  const [draftAction, setDraftAction] = useState<PinAction>("pinned")
  const [draftNote, setDraftNote] = useState("")

  const pins = (ctx.data?.pins ?? []).filter((p) => p.action === "pinned")
  const exclusions = (ctx.data?.pins ?? []).filter((p) => p.action === "excluded")

  const submit = async () => {
    const id = draftChunkId.trim()
    if (!id) return
    try {
      await upsert.mutateAsync({
        chunk_id: id,
        action: draftAction,
        note: draftNote.trim() || null,
      })
      setDraftChunkId("")
      setDraftNote("")
      toast.success(draftAction === "pinned" ? "Pinned." : "Excluded.")
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  const handleClear = async () => {
    if (!ctx.data || ctx.data.pins.length === 0) return
    if (!window.confirm("Clear every pin and exclusion in this thread?")) return
    try {
      const res = await clear.mutateAsync()
      toast.success(`Cleared ${res.removed} entr${res.removed === 1 ? "y" : "ies"}.`)
    } catch (err) {
      toast.error((err as Error).message)
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[560px] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Pin className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="text-[15px] font-semibold leading-[1.35]">
                Context manager
              </SheetTitle>
              {threadId ? (
                <SheetDescription className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  thread {threadId}
                </SheetDescription>
              ) : (
                <SheetDescription className="mt-1 text-[12px] text-muted-foreground">
                  Open a thread first; pins are scoped per conversation.
                </SheetDescription>
              )}
            </div>
          </div>
          {threadId && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant="secondary" className="font-mono text-[10.5px]">
                {pins.length} pinned
              </Badge>
              <Badge variant="outline" className="font-mono text-[10.5px]">
                {exclusions.length} excluded
              </Badge>
              <Button
                variant="outline"
                size="sm"
                className="ml-auto h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                onClick={handleClear}
                disabled={clear.isPending || (ctx.data?.pins.length ?? 0) === 0}
              >
                {clear.isPending ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Trash2 className="size-3" strokeWidth={2} />
                )}
                Clear all
              </Button>
            </div>
          )}
        </SheetHeader>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-5 space-y-5">
            {!threadId && (
              <p className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-center text-[13px] text-muted-foreground">
                Pins live on the thread checkpoint. Open or start a thread to
                begin pinning chunks.
              </p>
            )}

            {threadId && (
              <>
                <Section title="Add a pin or exclusion">
                  <div className="space-y-2.5">
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Input
                        placeholder="chunk_id"
                        value={draftChunkId}
                        onChange={(e) => setDraftChunkId(e.target.value)}
                        className="font-mono text-[12.5px]"
                      />
                      <ActionToggle value={draftAction} onChange={setDraftAction} />
                    </div>
                    <Input
                      placeholder="note (optional)"
                      value={draftNote}
                      onChange={(e) => setDraftNote(e.target.value)}
                      className="text-[12.5px]"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[11.5px] leading-[1.45] text-muted-foreground">
                        Find chunk ids in the citations list or the Library
                        chunks tab — they're stable across runs.
                      </p>
                      <Button
                        size="sm"
                        onClick={submit}
                        disabled={!draftChunkId.trim() || upsert.isPending}
                        className="gap-1.5"
                      >
                        {upsert.isPending ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          <Plus className="size-3" strokeWidth={2} />
                        )}
                        Add
                      </Button>
                    </div>
                  </div>
                </Section>

                <Section
                  title={`Pinned · ${pins.length}`}
                  hint="Carried into every subsequent /ask turn on this thread."
                >
                  {ctx.isLoading ? (
                    <Loading />
                  ) : pins.length === 0 ? (
                    <Empty kind="pinned" />
                  ) : (
                    <PinList
                      entries={pins}
                      onRemove={(chunkId) =>
                        remove.mutate(chunkId, {
                          onSuccess: () => toast.success("Removed."),
                          onError: (e) => toast.error(e.message),
                        })
                      }
                    />
                  )}
                </Section>

                <Section
                  title={`Excluded · ${exclusions.length}`}
                  hint="Skipped during reranking even when they score highly."
                >
                  {ctx.isLoading ? (
                    <Loading />
                  ) : exclusions.length === 0 ? (
                    <Empty kind="excluded" />
                  ) : (
                    <PinList
                      entries={exclusions}
                      onRemove={(chunkId) =>
                        remove.mutate(chunkId, {
                          onSuccess: () => toast.success("Removed."),
                          onError: (e) => toast.error(e.message),
                        })
                      }
                    />
                  )}
                </Section>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}

// ─────────────────────────────────────────────────────────────────
// internals
// ─────────────────────────────────────────────────────────────────

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <section>
      <div className="mb-2">
        <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {title}
        </div>
        {hint && (
          <p className="mt-0.5 text-[11.5px] leading-[1.45] text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      {children}
    </section>
  )
}

function ActionToggle({
  value,
  onChange,
}: {
  value: PinAction
  onChange: (next: PinAction) => void
}) {
  return (
    <div className="inline-flex overflow-hidden rounded-md border border-border">
      {(["pinned", "excluded"] as const).map((a) => {
        const Icon = a === "pinned" ? Pin : Ban
        return (
          <button
            key={a}
            type="button"
            onClick={() => onChange(a)}
            className={
              value === a
                ? "inline-flex items-center gap-1 bg-primary/10 px-3 py-1.5 text-[12px] text-primary"
                : "inline-flex items-center gap-1 bg-card px-3 py-1.5 text-[12px] text-muted-foreground hover:bg-muted"
            }
          >
            <Icon className="size-3" strokeWidth={2} />
            {a}
          </button>
        )
      })}
    </div>
  )
}

function PinList({
  entries,
  onRemove,
}: {
  entries: PinEntry[]
  onRemove: (chunkId: string) => void
}) {
  return (
    <ul className="space-y-1.5">
      {entries.map((p) => (
        <li
          key={p.chunk_id}
          className="flex items-start gap-2 rounded-md border border-border bg-card px-3 py-2"
        >
          <span
            className={
              p.action === "pinned"
                ? "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary"
                : "mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
            }
          >
            {p.action === "pinned" ? (
              <Pin className="size-3" strokeWidth={2} />
            ) : (
              <Ban className="size-3" strokeWidth={2} />
            )}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-mono text-[12px]">{p.chunk_id}</div>
            {p.note && (
              <p className="mt-0.5 text-[11.5px] leading-[1.45] text-muted-foreground">
                {p.note}
              </p>
            )}
            <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
              {p.created_at ? new Date(p.created_at).toLocaleString() : "—"}
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-7"
            onClick={() => onRemove(p.chunk_id)}
            aria-label="remove"
          >
            <PinOff className="size-3.5" strokeWidth={2} />
          </Button>
        </li>
      ))}
    </ul>
  )
}

function Loading() {
  return (
    <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
      <Loader2 className="size-3.5 animate-spin" /> loading…
    </div>
  )
}

function Empty({ kind }: { kind: PinAction }) {
  return (
    <p className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[12px] text-muted-foreground">
      No {kind} chunks yet.
    </p>
  )
}
