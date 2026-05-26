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
        `Indexed “${result.title}” — ${result.chunks_indexed} chunks.`,
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
      toast.error(`Ingest failed: ${err}`)
    }
    return Object.assign(finish, { fail })
  }

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-border px-6 py-4">
          <h1 className="text-[15px] font-semibold tracking-tight">Ingest</h1>
          <p className="mt-1 text-[13px] leading-[1.55] text-muted-foreground">
            Bring a URL, a file, or web-search hits into the corpus. Indexing
            runs Milvus hybrid + Neo4j entity extraction on each document.
          </p>
        </header>

        <ScrollArea className="flex-1 min-h-0">
          <div className="mx-auto w-full max-w-3xl p-6">
            <Tabs defaultValue="url">
              <TabsList className="mb-5 w-full max-w-full overflow-x-auto">
                <TabsTrigger value="url" className="gap-1.5">
                  <LinkIcon className="size-3.5" strokeWidth={2} /> URL
                </TabsTrigger>
                <TabsTrigger value="file" className="gap-1.5">
                  <FileText className="size-3.5" strokeWidth={2} /> File
                </TabsTrigger>
                <TabsTrigger value="web" className="gap-1.5">
                  <Search className="size-3.5" strokeWidth={2} /> Web search
                </TabsTrigger>
                <TabsTrigger value="text" className="gap-1.5">
                  Paste text
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
            URL to crawl
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
            Crawl4AI renders the page (JS-aware) and converts to markdown.
            Chunked + embedded into Milvus and the knowledge graph.
          </p>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button onClick={submit} disabled={!url.trim() || ingest.isPending}>
            {ingest.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowRight className="size-3.5" strokeWidth={2} />
            )}
            {ingest.isPending ? "Indexing…" : "Crawl + index"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function FileIngestForm({ pushJob }: FormProps) {
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
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed p-8 transition-colors",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border bg-muted/30 hover:bg-muted/50",
          )}
        >
          <Upload className="size-6 text-muted-foreground" strokeWidth={1.75} />
          <span className="text-[13px] text-foreground">
            {file
              ? file.name
              : dragOver
                ? "Release to attach"
                : "Drop a PDF / DOCX or click to choose."}
          </span>
          {file && (
            <span className="font-mono text-[11px] text-muted-foreground">
              {(file.size / 1024).toFixed(1)} KB
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
              Clear
            </Button>
          )}
          <Button onClick={submit} disabled={!file || ingest.isPending}>
            {ingest.isPending ? (
              <Loader2 className="size-3.5 animate-spin" strokeWidth={2} />
            ) : (
              <ArrowRight className="size-3.5" strokeWidth={2} />
            )}
            {ingest.isPending ? "Parsing…" : "Parse + index"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function WebIngestForm({ pushJob }: FormProps) {
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
              placeholder="Search the web…"
              className="pl-8"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setSubmitted(query.trim())}
            />
          </div>
          <Button onClick={() => setSubmitted(query.trim())} disabled={!query.trim()}>
            Search
          </Button>
        </div>

        {search.isLoading && (
          <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> searching SearxNG…
          </div>
        )}

        {search.data && search.data.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            No results for {`"${submitted}"`}.
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
                {selectedCount} of {search.data.length} selected
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
                Ingest selected
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function TextIngestForm({ pushJob }: FormProps) {
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
            Title (optional)
          </Label>
          <Input
            id="ingest-title"
            placeholder="Auto-derived from first line if empty"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="ingest-text" className="text-[12.5px] font-medium">
            Text
          </Label>
          <Textarea
            id="ingest-text"
            rows={8}
            placeholder="Paste markdown or plain text…"
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
            {ingest.isPending ? "Indexing…" : "Index text"}
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
  if (jobs.length === 0) return null

  const openInLibrary = (docId: string) => {
    const next = `/library?doc=${encodeURIComponent(docId)}`
    window.history.pushState({}, "", next)
    window.dispatchEvent(new PopStateEvent("popstate"))
  }

  return (
    <section className="mt-8">
      <h2 className="mb-3 text-[12.5px] font-semibold uppercase tracking-wide text-muted-foreground">
        Recent jobs
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
                j.status === "ok" && "bg-emerald-500/15 text-emerald-500",
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
                    {j.result.chunks_indexed} chunks
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
                    {((j.endedAt - j.startedAt) / 1000).toFixed(1)}s
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
                    Open in Library
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
  const rows = useMemo<Array<[string, string | number | boolean]>>(() => {
    if (!settings) return []
    return [
      ["embed provider", settings.embed_provider],
      ["embed model", settings.embed_model],
      ["embed dim", settings.embed_dim],
      ["contextual retrieval", settings.enable_contextual_retrieval],
      ["graph retrieval", settings.enable_graph_retrieval],
      ["reranker", settings.reranker_model],
      ["device", settings.reranker_device],
    ]
  }, [settings])

  return (
    <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background lg:flex">
      <div className="border-b border-border px-4 py-3">
        <div className="text-[14px] font-semibold">Indexing parameters</div>
        <p className="mt-0.5 text-[12px] text-muted-foreground">
          Applied to every ingest. Change them in Settings.
        </p>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-1.5">
          {loading && (
            <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
              <Loader2 className="size-3 animate-spin" /> loading…
            </div>
          )}
          {rows.map(([label, value]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-3 border-b border-border/40 py-1.5 text-[12.5px]"
            >
              <span className="text-muted-foreground">{label}</span>
              <span className="font-mono tabular-nums text-foreground">
                {typeof value === "boolean" ? (value ? "on" : "off") : String(value)}
              </span>
            </div>
          ))}
        </div>
        <div className="mx-4 mt-3 rounded-md border border-dashed border-border bg-muted/30 px-3 py-2.5 text-[11.5px] leading-[1.55] text-muted-foreground">
          Live pipeline view (per-stage timing via SSE) is a follow-up — the
          current /api/ingest call is synchronous and reports the final{" "}
          <span className="inline-flex items-center gap-1">
            <Globe className="size-3" /> doc_id + chunks
          </span>{" "}
          on completion.
        </div>
      </ScrollArea>
    </aside>
  )
}
