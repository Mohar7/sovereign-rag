import { useEffect, useMemo, useState } from "react"
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  type ColumnDef,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table"
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Filter,
  FileText,
  Globe,
  Loader2,
  RefreshCw,
  Search,
  Trash2,
  X,
} from "lucide-react"
import { toast } from "sonner"
import { Trans, useTranslation } from "react-i18next"

import { SourceDrawer } from "@/components/library/source-drawer"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  useDeleteDocumentsBulk,
  useLibrarySearch,
} from "@/hooks/use-library"
import { useIngest } from "@/hooks/use-ingest"
import { api, type DocumentSummary } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { cn, downloadJSON } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Columns
// ─────────────────────────────────────────────────────────────────

type TFunc = ReturnType<typeof useTranslation>["t"]

function makeColumns(t: TFunc): ColumnDef<DocumentSummary>[] {
  return [
    {
      id: "select",
      header: ({ table }) => (
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected()
              ? true
              : table.getIsSomePageRowsSelected()
                ? "indeterminate"
                : false
          }
          onCheckedChange={(v) => table.toggleAllPageRowsSelected(!!v)}
          aria-label={t("pages.library.selectAll")}
        />
      ),
      cell: ({ row }) => (
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(v) => row.toggleSelected(!!v)}
          onClick={(e) => e.stopPropagation()}
          aria-label={t("pages.library.selectRow")}
        />
      ),
      enableSorting: false,
      size: 36,
    },
    {
      accessorKey: "title",
      header: t("pages.library.colTitle"),
      cell: ({ row }) => (
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <FileText className="size-3.5" strokeWidth={2} />
          </span>
          <span className="truncate font-medium text-foreground">
            {row.original.title || t("common.untitled")}
          </span>
        </div>
      ),
    },
    {
      id: "kind",
      header: t("pages.library.colKind"),
      accessorFn: (row) => inferDocKind(row.source_uri),
      enableSorting: false,
      size: 96,
      cell: ({ row }) => {
        const kind = inferDocKind(row.original.source_uri)
        const Icon = kind === "web" ? Globe : FileText
        return (
          <Badge variant="secondary" className="gap-1 font-mono text-[10px] uppercase tracking-wide">
            <Icon className="size-3" strokeWidth={2} />
            {kind}
          </Badge>
        )
      },
    },
    {
      accessorKey: "source_uri",
      header: t("pages.library.colSource"),
      cell: ({ row }) => (
        <span className="truncate font-mono text-[12px] text-muted-foreground">
          {row.original.source_uri || "—"}
        </span>
      ),
    },
    {
      id: "status",
      header: t("pages.library.colStatus"),
      enableSorting: false,
      size: 96,
      // A document only appears in the library once it's fully indexed, so its
      // status is always "ready". (No async indexing queue is surfaced here.)
      cell: () => (
        <Badge variant="success" className="font-mono text-[10px] uppercase tracking-wide">
          {t("pages.library.statusReady")}
        </Badge>
      ),
    },
    {
      accessorKey: "chunks",
      header: t("pages.library.colChunks"),
      cell: ({ row }) => (
        <span className="font-mono tabular-nums text-foreground">
          {formatCount(row.original.chunks)}
        </span>
      ),
    },
  ]
}

// ─────────────────────────────────────────────────────────────────
// Page
// ─────────────────────────────────────────────────────────────────

export function LibraryPage() {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [sorting, setSorting] = useState<SortingState>([
    { id: "chunks", desc: true },
  ])
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({})
  const [drawerDoc, setDrawerDoc] = useState<DocumentSummary | null>(null)
  const [kindFilters, setKindFilters] = useState<Set<string>>(new Set())

  const docs = useLibrarySearch(query)
  const allDocs = docs.data ?? []

  // Filter client-side by kind (derived from source_uri). The backend
  // doesn't store kind yet — when it does, replace `inferDocKind` with the
  // server-provided field. See task #67-follow-up.
  const data = useMemo(() => {
    if (kindFilters.size === 0) return allDocs
    return allDocs.filter((d) => kindFilters.has(inferDocKind(d.source_uri)))
  }, [allDocs, kindFilters])

  // Counts per kind for the rail (computed from unfiltered set).
  const kindCounts = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {}
    for (const d of allDocs) {
      const k = inferDocKind(d.source_uri)
      m[k] = (m[k] ?? 0) + 1
    }
    return m
  }, [allDocs])

  const toggleKind = (k: string) =>
    setKindFilters((prev) => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k)
      else next.add(k)
      return next
    })

  // Allow deep-linking to a specific doc, e.g. /library?doc=<doc_id>. When the
  // matching row is in the current result set we open the SourceDrawer to it.
  useEffect(() => {
    const docId = new URLSearchParams(window.location.search).get("doc")
    if (!docId || drawerDoc) return
    const found = data.find((d) => d.doc_id === docId)
    if (found) setDrawerDoc(found)
  }, [data, drawerDoc])

  const columns = useMemo(() => makeColumns(t), [t])
  const table = useReactTable({
    data,
    columns,
    state: { sorting, rowSelection },
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getRowId: (row) => row.doc_id,
    enableRowSelection: true,
  })

  const selectedCount = Object.keys(rowSelection).length
  const total = data.length
  const selectedIds = Object.keys(rowSelection)
  const selectedDocs = data.filter((d) => rowSelection[d.doc_id])

  const bulkDelete = useDeleteDocumentsBulk()
  const ingest = useIngest()
  const [confirmDelete, setConfirmDelete] = useState(false)

  const onBulkReindex = async () => {
    const urlDocs = selectedDocs.filter((d) => /^https?:\/\//.test(d.source_uri))
    const skipped = selectedDocs.length - urlDocs.length
    if (urlDocs.length === 0) {
      toast.error(t("pages.library.reindexNothingTitle"), {
        description: t("pages.library.reindexNothingDesc"),
      })
      return
    }
    if (skipped > 0) {
      toast(t("pages.library.reindexQueued", { queued: urlDocs.length, skipped }), {
        description: t("pages.library.reindexQueuedDesc"),
      })
    }
    let ok = 0
    let fail = 0
    for (const d of urlDocs) {
      try {
        await ingest.mutateAsync({ type: "url", value: d.source_uri })
        ok++
      } catch (err) {
        fail++
        toast.error(t("pages.library.reindexFailedOne", { title: d.title, message: (err as Error).message }))
      }
    }
    if (fail === 0) {
      toast.success(t("pages.library.reindexDone", { count: ok }))
    } else {
      toast.error(t("pages.library.reindexPartial", { ok, fail }))
    }
    setRowSelection({})
    void docs.refetch()
  }

  const onBulkDelete = () => setConfirmDelete(true)

  const performBulkDelete = async () => {
    try {
      const res = await bulkDelete.mutateAsync(selectedIds)
      const errors = res.results.filter((r) => r.error).length
      if (errors === 0) {
        toast.success(
          t("pages.library.deleteDone", {
            count: res.results.length,
            chunks: formatCount(res.total_chunks_deleted),
          }),
        )
      } else {
        toast.error(
          t("pages.library.deletePartial", {
            deleted: res.results.length - errors,
            failed: errors,
          }),
        )
      }
      setRowSelection({})
      setConfirmDelete(false)
    } catch (err) {
      toast.error(t("pages.library.deleteFailed", { message: (err as Error).message }))
    }
  }

  const onBulkExport = async () => {
    if (selectedDocs.length === 0) return
    const tid = toast.loading(t("pages.library.exportLoading", { count: selectedDocs.length }))
    try {
      const exported = await Promise.all(
        selectedDocs.map(async (d) => ({
          doc: d,
          chunks: await api.documentChunks(d.doc_id).catch(() => []),
        })),
      )
      const payload = {
        generated_at: new Date().toISOString(),
        count: exported.length,
        documents: exported,
      }
      downloadJSON(payload, `library-export-${exported.length}docs.json`)
      toast.success(t("pages.library.exportDone", { count: exported.length }), { id: tid })
    } catch (err) {
      toast.error(t("pages.library.exportFailed", { message: (err as Error).message }), { id: tid })
    }
  }

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full">
      {/* filter rail */}
      <aside className="hidden w-[240px] shrink-0 flex-col border-r border-border bg-background lg:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Filter className="size-3.5 text-muted-foreground" strokeWidth={2} />
            {t("pages.library.filters")}
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-5">
            <div className="space-y-2">
              <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                {t("pages.library.search")}
              </div>
              <div className="relative">
                <Search
                  className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
                  strokeWidth={2}
                />
                <Input
                  placeholder={t("pages.library.searchPlaceholder")}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  className="pl-8 h-9 text-[13px]"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    aria-label={t("actions.clear")}
                  >
                    <X className="size-3" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
            <FilterChecklist
              label={t("pages.library.kind")}
              options={["pdf", "docx", "web", "text", "file"]}
              selected={kindFilters}
              onToggle={toggleKind}
              counts={kindCounts}
            />
            <div className="rounded-md border border-dashed border-border bg-muted/30 px-3 py-2 text-[11.5px] leading-[1.5] text-muted-foreground">
              <Trans
                i18nKey="pages.library.kindNote"
                components={{ code: <code className="font-mono" /> }}
              />
            </div>
          </div>
        </ScrollArea>
      </aside>

      {/* main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* top toolbar */}
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">{t("pages.library.heading")}</h1>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {docs.isLoading
              ? t("common.loading")
              : t("pages.library.documentCount", { count: total, formattedCount: formatCount(total) })}
          </span>
          {selectedCount > 0 && (
            <BulkActionBar
              count={selectedCount}
              onReindex={onBulkReindex}
              onDelete={onBulkDelete}
              onExport={onBulkExport}
              onClear={() => setRowSelection({})}
            />
          )}
          <span className="ml-auto" />
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => void docs.refetch()}
          >
            <RefreshCw
              className={cn("size-3.5", docs.isFetching && "animate-spin")}
              strokeWidth={2}
            />
            {t("actions.refresh")}
          </Button>
        </div>

        {/* table */}
        <div className="relative flex-1 min-h-0 overflow-hidden">
          <ScrollArea className="h-full">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-background">
                {table.getHeaderGroups().map((hg) => (
                  <TableRow key={hg.id}>
                    {hg.headers.map((h) => {
                      const canSort = h.column.getCanSort()
                      const sortDir = h.column.getIsSorted()
                      return (
                        <TableHead
                          key={h.id}
                          style={{ width: h.getSize() }}
                          className={cn(
                            "h-10 font-mono text-[11px] font-medium uppercase tracking-wide text-muted-foreground",
                            canSort && "cursor-pointer select-none",
                          )}
                          onClick={canSort ? h.column.getToggleSortingHandler() : undefined}
                        >
                          <div className="inline-flex items-center gap-1.5">
                            {flexRender(h.column.columnDef.header, h.getContext())}
                            {canSort && (
                              <SortIcon dir={sortDir === false ? undefined : sortDir} />
                            )}
                          </div>
                        </TableHead>
                      )
                    })}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {docs.isLoading
                  ? Array.from({ length: 6 }).map((_, i) => <SkeletonRow key={i} />)
                  : table.getRowModel().rows.length === 0
                    ? (
                      <TableRow>
                        <TableCell colSpan={6} className="py-10 text-center text-[13px] text-muted-foreground">
                          {t("pages.library.noMatch")}
                        </TableCell>
                      </TableRow>
                    )
                    : table.getRowModel().rows.map((row) => (
                        <TableRow
                          key={row.id}
                          data-state={row.getIsSelected() ? "selected" : undefined}
                          tabIndex={0}
                          role="button"
                          className="cursor-pointer outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                          onClick={() => setDrawerDoc(row.original)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault()
                              setDrawerDoc(row.original)
                            }
                          }}
                        >
                          {row.getVisibleCells().map((cell) => (
                            <TableCell key={cell.id}>
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
              </TableBody>
            </Table>
          </ScrollArea>
          {/* protection gradients — fade rows under the sticky header / above the footer */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-10 z-20 h-10"
            style={{ background: "linear-gradient(to bottom, var(--background), transparent)" }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-10"
            style={{ background: "linear-gradient(to top, var(--background), transparent)" }}
          />
        </div>

        {/* foot */}
        <div className="flex items-center justify-between border-t border-border px-6 py-2.5 text-[12px] text-muted-foreground">
          <span>
            {selectedCount > 0
              ? t("pages.library.selectedOfTotal", {
                  selected: formatCount(selectedCount),
                  total: formatCount(total),
                })
              : t("pages.library.documentCount", { count: total, formattedCount: formatCount(total) })}
          </span>
          <span className="font-mono text-[11px]">/api/documents/search</span>
        </div>
      </div>

      <SourceDrawer
        doc={drawerDoc}
        open={drawerDoc != null}
        onOpenChange={(o) => {
          if (!o) setDrawerDoc(null)
        }}
        onDeleted={() => {
          setDrawerDoc(null)
          setRowSelection({})
          void docs.refetch()
        }}
      />

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="inline-flex size-8 items-center justify-center rounded-md bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" strokeWidth={2} />
              </span>
              {t("pages.library.deleteDialogTitle", { count: selectedCount })}
            </DialogTitle>
            <DialogDescription>
              {t("pages.library.deleteDialogDesc", { count: selectedCount })}
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-40 overflow-y-auto rounded-md border border-border bg-muted/30 p-2 text-[12px]">
            <ul className="space-y-1">
              {selectedDocs.slice(0, 30).map((d) => (
                <li
                  key={d.doc_id}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="truncate text-foreground">{d.title || t("common.untitled")}</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                    {t("pages.library.chunksCount", { count: d.chunks, formattedCount: formatCount(d.chunks) })}
                  </span>
                </li>
              ))}
              {selectedDocs.length > 30 && (
                <li className="text-muted-foreground">
                  {t("pages.library.andMore", { count: selectedDocs.length - 30, formattedCount: formatCount(selectedDocs.length - 30) })}
                </li>
              )}
            </ul>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{t("actions.cancel")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={performBulkDelete}
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" strokeWidth={2} />
              )}
              {t("pages.library.deleteN", { count: selectedCount, formattedCount: formatCount(selectedCount) })}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir?: "asc" | "desc" }) {
  if (dir === "asc") return <ArrowUp className="size-3 text-primary" strokeWidth={2} />
  if (dir === "desc") return <ArrowDown className="size-3 text-primary" strokeWidth={2} />
  return <ArrowUpDown className="size-3 opacity-50" strokeWidth={2} />
}

/** Active kind filter. Derives kind from source_uri client-side until the
 *  backend surfaces a stored kind column per document. */
export type DocKind = "pdf" | "docx" | "web" | "text" | "file"

export function inferDocKind(source_uri: string): DocKind {
  const s = source_uri.toLowerCase()
  if (s.endsWith(".pdf")) return "pdf"
  if (s.endsWith(".docx") || s.endsWith(".doc")) return "docx"
  if (s.startsWith("http://") || s.startsWith("https://")) return "web"
  if (s.startsWith("text://") || s.startsWith("inline://")) return "text"
  return "file"
}

function FilterChecklist({
  label,
  options,
  selected,
  onToggle,
  counts,
}: {
  label: string
  options: string[]
  selected: Set<string>
  onToggle: (opt: string) => void
  counts?: Record<string, number>
}) {
  return (
    <div className="space-y-2">
      <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="flex flex-col gap-1.5">
        {options.map((opt) => (
          <label
            key={opt}
            className="flex items-center gap-2 text-[12.5px] text-foreground hover:text-foreground/80"
          >
            <Checkbox
              checked={selected.has(opt)}
              onCheckedChange={() => onToggle(opt)}
            />
            <span className="flex-1">{opt}</span>
            {counts && counts[opt] !== undefined && (
              <span className="font-mono tabular-nums text-[10.5px] text-muted-foreground">
                {counts[opt]}
              </span>
            )}
          </label>
        ))}
      </div>
    </div>
  )
}

function BulkActionBar({
  count,
  onReindex,
  onDelete,
  onExport,
  onClear,
}: {
  count: number
  onReindex: () => void
  onDelete: () => void
  onExport: () => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-1.5">
      <Badge className="font-mono text-[10.5px]">{t("actions.selected", { count })}</Badge>
      <Button variant="outline" size="sm" className="h-7 gap-1.5" onClick={onReindex}>
        <RefreshCw className="size-3" strokeWidth={2} /> {t("pages.library.reindex")}
      </Button>
      <Button variant="outline" size="sm" className="h-7" onClick={onExport}>
        {t("actions.export")}
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10"
        onClick={onDelete}
      >
        <Trash2 className="size-3" strokeWidth={2} /> {t("actions.delete")}
      </Button>
      <Button variant="ghost" size="icon" className="size-7" onClick={onClear} aria-label={t("pages.library.clearSelection")}>
        <X className="size-3.5" strokeWidth={2} />
      </Button>
    </div>
  )
}

function SkeletonRow() {
  return (
    <TableRow>
      <TableCell>
        <Skeleton className="size-4" />
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-3.5 w-44" />
        </div>
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14 rounded-sm" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-64" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-5 w-14 rounded-sm" />
      </TableCell>
      <TableCell>
        <Skeleton className="h-3 w-8" />
      </TableCell>
    </TableRow>
  )
}
