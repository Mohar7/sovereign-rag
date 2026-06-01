import { useEffect, useRef, useState } from "react"
import { Download, ExternalLink, FileText, Layers, Loader2, Network, Trash2, X } from "lucide-react"
import { toast } from "sonner"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useDeleteDocument } from "@/hooks/use-library"
import { useDocumentChunks, useEntities } from "@/hooks/use-source-detail"
import type { DocumentSummary } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { cn, downloadJSON } from "@/lib/utils"

interface Props {
  doc: DocumentSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onDeleted?: () => void
  /**
   * When set, the drawer auto-switches to the "Chunks" tab, scrolls the
   * matching chunk into view, and rings it with a primary border. Used by
   * the Ask page so clicking a citation lands the reader on the exact chunk
   * that backed the answer.
   */
  focusChunkId?: string | null
}

export function SourceDrawer({ doc, open, onOpenChange, onDeleted, focusChunkId }: Props) {
  const { t } = useTranslation()
  const chunks = useDocumentChunks(doc?.doc_id ?? null)
  const entities = useEntities(doc?.doc_id ?? null)
  const deleteDoc = useDeleteDocument()
  const [activeTab, setActiveTab] = useState<string>("chunks")
  const focusedChunkRef = useRef<HTMLElement | null>(null)

  // When opened with a focusChunkId, ensure the Chunks tab is showing.
  useEffect(() => {
    if (open && focusChunkId) setActiveTab("chunks")
  }, [open, focusChunkId])

  // Once chunks have loaded, scroll the focused chunk into view. We can't do
  // this purely with CSS because the ring needs to be measurable after a
  // DOM commit, and ScrollArea wraps the content in its own viewport — so we
  // walk to the closest scroll container and use scrollIntoView on the
  // matching <article>.
  useEffect(() => {
    if (!focusChunkId || !chunks.data) return
    const el = focusedChunkRef.current
    if (!el) return
    // Defer to next frame so the ScrollArea has finished layout.
    const id = window.requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "center" })
    })
    return () => window.cancelAnimationFrame(id)
  }, [focusChunkId, chunks.data])

  const handleExport = () => {
    if (!doc) return
    downloadJSON(
      {
        generated_at: new Date().toISOString(),
        doc,
        chunks: chunks.data ?? [],
        entities: entities.data?.entities ?? [],
        relations: entities.data?.relations ?? [],
      },
      `${doc.doc_id.replace(/[^a-z0-9-]/gi, "_")}.json`,
    )
    toast.success(t("pages.library.exported"))
  }

  const handleDelete = async () => {
    if (!doc) return
    const confirmed = window.confirm(
      t("pages.library.confirmDeleteOne", {
        title: doc.title || doc.doc_id,
        count: doc.chunks,
        formattedCount: formatCount(doc.chunks),
      }),
    )
    if (!confirmed) return
    try {
      const res = await deleteDoc.mutateAsync(doc.doc_id)
      toast.success(
        res.graph_deleted
          ? t("pages.library.deletedOneGraph", {
              title: doc.title,
              count: res.chunks_deleted,
              formattedCount: formatCount(res.chunks_deleted),
            })
          : t("pages.library.deletedOne", {
              title: doc.title,
              count: res.chunks_deleted,
              formattedCount: formatCount(res.chunks_deleted),
            }),
      )
      onOpenChange(false)
      onDeleted?.()
    } catch (err) {
      toast.error(t("pages.library.deleteFailed", { message: (err as Error).message }))
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-[520px] p-0 flex flex-col gap-0"
      >
        <SheetHeader className="border-b border-border px-6 py-4">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <FileText className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0 flex-1">
              <SheetTitle className="line-clamp-2 text-[15px] font-semibold leading-[1.35]">
                {doc?.title ?? t("pages.library.sourceDetail")}
              </SheetTitle>
              {doc && (
                <SheetDescription className="mt-1 truncate font-mono text-[11.5px] text-muted-foreground">
                  {doc.source_uri}
                </SheetDescription>
              )}
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={() => onOpenChange(false)}
              aria-label={t("actions.close")}
            >
              <X className="size-3.5" strokeWidth={2} />
            </Button>
          </div>
          {doc && (
            <>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                <Badge variant="secondary" className="font-mono text-[10.5px]">
                  {/* Prefer the live chunks count from the loaded data so this
                      stays correct when the drawer is opened with a partial
                      DocumentSummary built from a citation (chunks=0). */}
                  {t("pages.library.chunksCount", {
                    count: chunks.data ? chunks.data.length : doc.chunks,
                    formattedCount: formatCount(chunks.data ? chunks.data.length : doc.chunks),
                  })}
                </Badge>
                <Badge variant="outline" className="font-mono text-[10.5px]">
                  {doc.doc_id.slice(0, 8)}
                </Badge>
                {doc.source_uri.startsWith("http") && (
                  <a
                    href={doc.source_uri}
                    target="_blank"
                    rel="noreferrer"
                    className="ml-auto inline-flex items-center gap-1 text-primary hover:underline"
                  >
                    {t("pages.library.openSource")}
                    <ExternalLink className="size-3" strokeWidth={2} />
                  </a>
                )}
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5"
                  onClick={handleExport}
                  disabled={chunks.isLoading}
                >
                  <Download className="size-3" strokeWidth={2} />
                  {t("actions.exportJson")}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
                  onClick={handleDelete}
                  disabled={deleteDoc.isPending}
                >
                  {deleteDoc.isPending ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" strokeWidth={2} />
                  )}
                  {t("pages.library.deleteDocument")}
                </Button>
              </div>
            </>
          )}
        </SheetHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex flex-1 flex-col min-h-0">
          <TabsList className="rounded-none border-b border-border bg-transparent justify-start px-4 py-0 h-10">
            <TabsTrigger value="chunks" className="data-[state=active]:bg-transparent gap-1.5">
              <Layers className="size-3.5" strokeWidth={2} />
              {t("pages.library.tabChunks")}
              {chunks.data && (
                <span className="font-mono text-[10px] text-muted-foreground">
                  {formatCount(chunks.data.length)}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="entities" className="data-[state=active]:bg-transparent">
              {t("pages.library.tabEntities")}
            </TabsTrigger>
            <TabsTrigger value="relations" className="data-[state=active]:bg-transparent">
              {t("pages.library.tabRelations")}
            </TabsTrigger>
            <TabsTrigger value="metadata" className="data-[state=active]:bg-transparent">
              {t("pages.library.tabMetadata")}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="chunks" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <div className="p-5 space-y-2.5">
                {chunks.isLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {t("pages.library.loadingChunks")}
                  </div>
                )}
                {chunks.error && (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-[12.5px] text-destructive">
                    {chunks.error.message}
                  </div>
                )}
                {!chunks.isLoading && (chunks.data?.length ?? 0) === 0 && !chunks.error && (
                  <div className="text-[13px] text-muted-foreground">
                    {t("pages.library.noChunks")}
                  </div>
                )}
                {(chunks.data ?? []).map((c) => {
                  const isFocused = c.chunk_id === focusChunkId
                  return (
                  <article
                    key={c.chunk_id}
                    ref={isFocused ? focusedChunkRef : undefined}
                    className={cn(
                      "rounded-lg border bg-card p-3 transition-colors",
                      isFocused
                        ? "border-primary ring-2 ring-primary/40 bg-primary/[0.04]"
                        : "border-border",
                    )}
                  >
                    <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      <span className="inline-flex size-5 items-center justify-center rounded-[4px] bg-primary/10 font-mono text-[10.5px] font-semibold text-primary">
                        {c.position}
                      </span>
                      {c.page !== null && c.page !== undefined && (
                        <Badge variant="outline" className="font-mono text-[10px]">
                          {t("pages.library.pageLabel", { page: c.page })}
                        </Badge>
                      )}
                      <span className="ml-auto truncate font-mono text-[10.5px]">
                        {c.chunk_id.slice(0, 8)}
                      </span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap break-words text-[12.5px] leading-[1.55] text-foreground">
                      {c.raw_text || t("pages.library.emptyChunk")}
                    </p>
                  </article>
                  )
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="entities" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <div className="p-5">
                {entities.isLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {t("pages.library.loadingEntities")}
                  </div>
                )}
                {!entities.isLoading && (entities.data?.entities ?? []).length === 0 && (
                  <div className="text-[13px] text-muted-foreground">
                    {t("pages.library.noEntities")}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {(entities.data?.entities ?? []).map((e) => (
                    <span
                      key={e.name + e.type}
                      className="inline-flex items-baseline gap-1.5 rounded-md border border-border bg-card px-2 py-1 text-[12px]"
                    >
                      <span className="font-medium text-foreground">{e.name}</span>
                      <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                        {e.type}
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="relations" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <div className="p-5">
                {entities.isLoading && (
                  <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                    <Loader2 className="size-3.5 animate-spin" /> {t("pages.library.loadingRelations")}
                  </div>
                )}
                {!entities.isLoading && (entities.data?.relations ?? []).length === 0 && (
                  <div className="text-[13px] text-muted-foreground">
                    {t("pages.library.noRelations")}
                  </div>
                )}
                <ul className="space-y-2">
                  {(entities.data?.relations ?? []).map(([s, p, o], i) => (
                    <li
                      key={`${s}-${p}-${o}-${i}`}
                      className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-[12.5px]"
                    >
                      <Network
                        className="size-3.5 shrink-0 text-primary"
                        strokeWidth={2}
                      />
                      <span className="font-medium text-foreground">{s}</span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {p}
                      </span>
                      <span className="font-medium text-foreground">{o}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="metadata" className="flex-1 min-h-0 mt-0">
            <ScrollArea className="h-full">
              <div className="p-5">
                {doc && (
                  <dl className="grid grid-cols-[120px_1fr] gap-y-2.5 text-[13px]">
                    <dt className="text-muted-foreground">doc_id</dt>
                    <dd className="break-all font-mono">{doc.doc_id}</dd>
                    <dt className="text-muted-foreground">title</dt>
                    <dd className="text-foreground">{doc.title}</dd>
                    <dt className="text-muted-foreground">source_uri</dt>
                    <dd className="break-all font-mono text-[12px]">
                      {doc.source_uri}
                    </dd>
                    <dt className="text-muted-foreground">chunks</dt>
                    <dd className="font-mono tabular-nums">{doc.chunks}</dd>
                  </dl>
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  )
}
