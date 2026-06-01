import { useMemo, useRef, useState } from "react"
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ExternalLink,
  FileText,
  Globe,
  Link as LinkIcon,
  Loader2,
  Search,
  Upload,
  XCircle,
} from "lucide-react"
import { Trans, useTranslation } from "react-i18next"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { useFileIngest, useIngest, useWebSearch } from "@/hooks/use-ingest"
import { useSettings } from "@/hooks/use-settings"
import type { IngestResponse } from "@/lib/api"
import { formatCount, formatDecimal } from "@/lib/format"
import { cn } from "@/lib/utils"

// One row in the bottom "recent jobs" list.
interface IngestJob {
  id: number
  kind: "url" | "text" | "file" | "web"
  label: string
  status: "running" | "ok" | "error"
  result?: IngestResponse
  error?: string
  startedAt: number
  endedAt?: number
}

export function IngestPage() {
  const { t } = useTranslation()
  const [jobs, setJobs] = useState<IngestJob[]>([])
  const jobIdRef = useRef(0)
  const settings = useSettings()

  const pushJob = (
    kind: IngestJob["kind"],
    label: string,
  ): ((result: IngestResponse) => void) & {
    fail: (err: string) => void
  } => {
    const id = ++jobIdRef.current
    setJobs((prev) => [
      { id, kind, label, status: "running", startedAt: performance.now() },
      ...prev,
    ])
    const finish = (result: IngestResponse) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? { ...j, status: "ok", result, endedAt: performance.now() }
            : j,
        ),
      )
      toast.success(
        t("pages.ingest.toastIndexed", {
          title: result.title,
          count: result.chunks_indexed,
          chunks: formatCount(result.chunks_indexed),
        }),
      )
    }
    const fail = (err: string) => {
      setJobs((prev) =>
        prev.map((j) =>
          j.id === id
            ? { ...j, status: "error", error: err, endedAt: performance.now() }
            : j,
        ),
      )
      toast.error(t("pages.ingest.toastFailed", { error: err }))
    }
    return Object.assign(finish, { fail })
  }

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border px-6 py-4">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {t("pages.ingest.heading")}
          </h1>
          <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">
            {t("pages.ingest.subtitle")}
          </p>
        </header>

        <ScrollArea className="flex-1 min-h-0">
          <div className="mx-auto w-full max-w-3xl p-6">
            <Tabs defaultValue="url">
              <TabsList className="mb-5 w-full max-w-full overflow-x-auto">
                <TabsTrigger value="url" className="gap-1.5">
                  <LinkIcon className="size-3.5" strokeWidth={2} />{" "}
                  {t("pages.ingest.tabs.url")}
                </TabsTrigger>
                <TabsTrigger value="file" className="gap-1.5">
                  <FileText className="size-3.5" strokeWidth={2} />{" "}
                  {t("pages.ingest.tabs.file")}
                </TabsTrigger>
                <TabsTrigger value="web" className="gap-1.5">
                  <Search className="size-3.5" strokeWidth={2} />{" "}
                  {t("pages.ingest.tabs.web")}
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5">
                  {t("pages.ingest.tabs.text")}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="url"><UrlIngestForm pushJob={pushJob} /></TabsContent>
              <TabsContent value="file"><FileIngestForm pushJob={pushJob} /></TabsContent>
              <TabsContent value="web"><WebIngestForm pushJob={pushJob} /></TabsContent>
              <TabsContent value="text"><TextIngestForm pushJob={pushJob} /></TabsContent>
            </Tabs>

            <JobsList jobs={jobs} />
          </div>
        </ScrollArea>
      </div>

      <KnobsRail settings={settings.data} loading={settings.isLoading} />
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Tab forms
// ─────────────────────────────────────────────────────────────────

interface PushJob {
  (result: IngestResponse): void
  fail: (err: string) => void
}
interface FormProps {
  pushJob: (kind: IngestJob["kind"], label: string) => PushJob
}

function UrlIngestForm({ pushJob }: FormProps) {
  const { t } = useTranslation()
  const [url, setUrl] = useState("")
  const ingest = useIngest()

  const submit = () => {
    const trimmed = url.trim()
    if (!trimmed) return
    const finish = pushJob("url", trimmed)
    ingest.mutate(
      { type: "url", value: trimmed },
      {
        onSuccess: (data) => {
          finish(data)
          setUrl("")
        },
        onError: (err) => finish.fail(err.message),
      },
    )
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ingest-url" className="text-[12.5px] font-medium">
            {t("pages.ingest.url.label")}
          </Label>
          <Input
            id="ingest-url"
            placeholder="https://example.com/article"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            disabled={ingest.isPending}
          />
          <p className="text-[12px] text-muted-foreground">
            {t("pages.ingest.url.hint")}
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button onClick={submit} disabled={!url.trim() || ingest.isPending}>
            {ingest.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowRight className="size-3.5" strokeWidth={2} />
            )}
            {ingest.isPending
              ? t("pages.ingest.indexing")
              : t("pages.ingest.url.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FileIngestForm({ pushJob }: FormProps) {
  const { t } = useTranslation()
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const ingest = useFileIngest()
  const inputRef = useRef<HTMLInputElement>(null)

  const submit = () => {
    if (!file) return
    const finish = pushJob("file", file.name)
    ingest.mutate(file, {
      onSuccess: (data) => {
        finish(data)
        setFile(null)
        if (inputRef.current) inputRef.current.value = ""
      },
      onError: (err) => finish.fail(err.message),
    })
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <label
          htmlFor="ingest-file"
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragOver(false)
            const dropped = e.dataTransfer.files?.[0]
            if (dropped) setFile(dropped)
          }}
          className={cn(
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-[14px] border border-dashed p-8 transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-primary/40 bg-primary/[0.03] hover:bg-primary/[0.05]",
          )}
        >
          <Upload className="size-6 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[13px] text-foreground">
            {file
              ? file.name
              : dragOver
                ? t("pages.ingest.file.releaseToAttach")
                : t("pages.ingest.file.dropzone")}
          </span>
          {file && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {t("pages.ingest.file.sizeKb", {
                size: formatDecimal(file.size / 1024, 1),
              })}
            </span>
          )}
          <input
            ref={inputRef}
            id="ingest-file"
            type="file"
            accept=".pdf,.docx,.doc,.txt,.md"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        <div className="flex items-center justify-end gap-2">
          {file && !ingest.isPending && (
            <Button variant="ghost" onClick={() => setFile(null)}>
              {t("actions.clear")}
            </Button>
          )}
          <Button onClick={submit} disabled={!file || ingest.isPending}>
            {ingest.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowRight className="size-3.5" strokeWidth={2} />
            )}
            {ingest.isPending
              ? t("pages.ingest.parsing")
              : t("pages.ingest.file.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WebIngestForm({ pushJob }: FormProps) {
  const { t } = useTranslation()
  const [query, setQuery] = useState("")
  const [submitted, setSubmitted] = useState("")
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const search = useWebSearch(submitted, submitted.length > 0)
  const ingest = useIngest()

  const toggle = (url: string) =>
    setSelected((prev) => ({ ...prev, [url]: !prev[url] }))

  const ingestSelected = async () => {
    const urls = Object.entries(selected)
      .filter(([, v]) => v)
      .map(([k]) => k)
    if (urls.length === 0) return
    for (const url of urls) {
      const finish = pushJob("web", url)
      try {
        const data = await ingest.mutateAsync({ type: "url", value: url })
        finish(data)
      } catch (err) {
        finish.fail((err as Error).message)
      }
    }
    setSelected({})
  }

  const selectedCount = Object.values(selected).filter(Boolean).length

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              placeholder={t("pages.ingest.web.searchPlaceholder")}
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSubmitted(query.trim())}
            />
          </div>
          <Button onClick={() => setSubmitted(query.trim())} disabled={!query.trim()}>
            {t("actions.search")}
          </Button>
        </div>

        {search.isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" />{" "}
            {t("pages.ingest.web.searching")}
          </div>
        )}

        {search.data && search.data.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            {t("pages.ingest.web.noResults", { query: submitted })}
          </p>
        )}

        {search.data && search.data.length > 0 && (
          <>
            <ul className="divide-y divide-border rounded-lg border border-border">
              {search.data.map((hit) => (
                <li
                  key={hit.url}
                  className="flex items-start gap-3 p-3"
                >
                  <Checkbox
                    checked={!!selected[hit.url]}
                    onCheckedChange={() => toggle(hit.url)}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-medium text-foreground">
                      {hit.title || hit.url}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[11.5px] text-muted-foreground">
                      {hit.url}
                    </div>
                    {hit.snippet && (
                      <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-[1.5] text-muted-foreground">
                        {hit.snippet}
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between">
              <span className="text-[12px] text-muted-foreground">
                {t("pages.ingest.web.selectedOf", {
                  selected: formatCount(selectedCount),
                  total: formatCount(search.data.length),
                })}
              </span>
              <Button
                onClick={ingestSelected}
                disabled={selectedCount === 0 || ingest.isPending}
              >
                {ingest.isPending ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="size-3.5" />
                )}
                {t("pages.ingest.web.ingestSelected")}
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TextIngestForm({ pushJob }: FormProps) {
  const { t } = useTranslation()
  const [text, setText] = useState("")
  const [title, setTitle] = useState("")
  const ingest = useIngest()

  const submit = () => {
    const trimmed = text.trim()
    if (!trimmed) return
    const finish = pushJob("text", title.trim() || trimmed.slice(0, 60))
    ingest.mutate(
      { type: "text", value: trimmed, title: title.trim() || undefined },
      {
        onSuccess: (data) => {
          finish(data)
          setText("")
          setTitle("")
        },
        onError: (err) => finish.fail(err.message),
      },
    )
  }

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="ingest-title" className="text-[12.5px] font-medium">
            {t("pages.ingest.text.titleLabel")}
          </Label>
          <Input
            id="ingest-title"
            placeholder={t("pages.ingest.text.titlePlaceholder")}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ingest-text" className="text-[12.5px] font-medium">
            {t("pages.ingest.text.textLabel")}
          </Label>
          <Textarea
            id="ingest-text"
            rows={8}
            placeholder={t("pages.ingest.text.textPlaceholder")}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </div>
        <div className="flex items-center justify-end">
          <Button onClick={submit} disabled={!text.trim() || ingest.isPending}>
            {ingest.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Check className="size-3.5" />
            )}
            {ingest.isPending
              ? t("pages.ingest.indexing")
              : t("pages.ingest.text.submit")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────
// Recent jobs list
// ─────────────────────────────────────────────────────────────────

function JobsList({ jobs }: { jobs: IngestJob[] }) {
  const { t } = useTranslation()
  if (jobs.length === 0) return null

  const openInLibrary = (docId: string) => {
    const next = `/library?doc=${encodeURIComponent(docId)}`
    window.history.pushState({}, "", next)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        {t("pages.ingest.recent")}
      </h2>
      <ul className="space-y-2">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="flex items-start gap-3 rounded-lg border border-border bg-card p-3"
          >
            <span
              className={cn(
                "mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md",
                j.status === "ok" && "bg-success/15 text-success",
                j.status === "running" && "bg-primary/15 text-primary",
                j.status === "error" && "bg-destructive/15 text-destructive",
              )}
            >
              {j.status === "ok" && <Check className="size-4" strokeWidth={2.25} />}
              {j.status === "running" && (
                <Loader2 className="size-4 animate-spin" strokeWidth={2} />
              )}
              {j.status === "error" && (
                <XCircle className="size-4" strokeWidth={2} />
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <Badge variant="secondary" className="font-mono text-[10px] uppercase">
                  {j.kind}
                </Badge>
                <span className="truncate text-[13.5px] font-medium text-foreground">
                  {j.result?.title ?? j.label}
                </span>
                {j.result && (
                  <Badge variant="outline" className="ml-auto font-mono text-[10.5px]">
                    {t("pages.ingest.chunksCount", {
                      count: j.result.chunks_indexed,
                      chunks: formatCount(j.result.chunks_indexed),
                    })}
                  </Badge>
                )}
              </div>
              {j.result?.source_uri && (
                <a
                  href={j.result.source_uri.startsWith("http") ? j.result.source_uri : undefined}
                  className="mt-1 inline-flex items-center gap-1 truncate font-mono text-[11.5px] text-muted-foreground hover:text-foreground"
                  target="_blank"
                  rel="noreferrer"
                >
                  {j.result.source_uri}
                  {j.result.source_uri.startsWith("http") && (
                    <ExternalLink className="size-3" strokeWidth={2} />
                  )}
                </a>
              )}
              {j.error && (
                <div className="mt-1 break-words font-mono text-[11.5px] text-destructive">
                  {j.error}
                </div>
              )}
              <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                {j.endedAt && (
                  <span className="font-mono">
                    {t("pages.ingest.elapsedSeconds", {
                      seconds: formatDecimal(
                        (j.endedAt - j.startedAt) / 1000,
                        1,
                      ),
                    })}
                  </span>
                )}
                {j.result && (
                  <span className="truncate font-mono">
                    {j.result.doc_id.slice(0, 16)}
                  </span>
                )}
                {j.result && (
                  <button
                    type="button"
                    onClick={() => openInLibrary(j.result!.doc_id)}
                    className="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-primary hover:bg-muted"
                  >
                    {t("pages.ingest.openInLibrary")}
                    <ArrowRight className="size-3" strokeWidth={2} />
                  </button>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

// ─────────────────────────────────────────────────────────────────
// Right rail: chunking + retrieval knobs (read-only here)
// ─────────────────────────────────────────────────────────────────

function KnobsRail({
  settings,
  loading,
}: {
  settings: ReturnType<typeof useSettings>["data"]
  loading: boolean
}) {
  const { t } = useTranslation()
  const rows = useMemo<Array<[string, string | number | boolean]>>(() => {
    if (!settings) return []
    return [
      [t("pages.ingest.knobs.embedProvider"), settings.embed_provider],
      [t("pages.ingest.knobs.embedModel"), settings.embed_model],
      [t("pages.ingest.knobs.embedDim"), settings.embed_dim],
      [
        t("pages.ingest.knobs.contextualRetrieval"),
        settings.enable_contextual_retrieval,
      ],
      [t("pages.ingest.knobs.graphRetrieval"), settings.enable_graph_retrieval],
      [t("pages.ingest.knobs.reranker"), settings.reranker_model],
      [t("pages.ingest.knobs.device"), settings.reranker_device],
    ]
  }, [settings, t])

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background lg:flex">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[14px] font-semibold">
          {t("pages.ingest.knobs.title")}
        </div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          {t("pages.ingest.knobs.subtitle")}
        </p>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-1.5">
          {loading && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> {t("common.loading")}
            </div>
          )}
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 text-[12.5px]"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {typeof value === "boolean"
                  ? value
                    ? t("pages.ingest.knobs.on")
                    : t("pages.ingest.knobs.off")
                  : String(value)}
              </span>
            </div>
          ))}
        </div>
        <div className="mx-4 mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11.5px] leading-[1.55] text-muted-foreground">
          <Trans
            i18nKey="pages.ingest.knobs.pipelineNote"
            components={{
              docref: (
                <span className="inline-flex items-center gap-1">
                  <Globe className="size-3" />
                </span>
              ),
            }}
          />
        </div>
      </ScrollArea>
    </aside>
  )
}
