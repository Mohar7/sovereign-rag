import { useEffect, useMemo, useState } from "react"
import {
  BarChart3,
  Database,
  Eye,
  FileText,
  History,
  Library as LibraryIcon,
  MessageSquare,
  Moon,
  Network,
  Plus,
  Settings,
  Sparkles,
  Sun,
  Upload,
  Wand2,
} from "lucide-react"
import { toast } from "sonner"

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useTheme } from "@/lib/theme"
import { useLibrarySearch } from "@/hooks/use-library"
import { useThreadsList } from "@/hooks/use-threads"

type NavKey =
  | "ask"
  | "library"
  | "ingest"
  | "threads"
  | "graph"
  | "evals"
  | "history"
  | "settings"

const NAV_TARGETS: Array<{ key: NavKey; label: string; path: string; icon: React.ComponentType<{ className?: string }> }> = [
  { key: "ask",      label: "Ask",          path: "/",         icon: Sparkles },
  { key: "library",  label: "Library",      path: "/library",  icon: LibraryIcon },
  { key: "ingest",   label: "Ingest",       path: "/ingest",   icon: Upload },
  { key: "threads",  label: "Threads",      path: "/threads",  icon: MessageSquare },
  { key: "graph",    label: "Graph",        path: "/graph",    icon: Network },
  { key: "evals",    label: "Evals",        path: "/evals",    icon: BarChart3 },
  { key: "history",  label: "Run history",  path: "/history",  icon: History },
  { key: "settings", label: "Settings",     path: "/settings", icon: Settings },
]

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const [search, setSearch] = useState("")
  const { theme, setTheme } = useTheme()

  // Pull recent threads + docs for the palette body. Both keep their own
  // React Query caches; opening the palette is cheap.
  const threads = useThreadsList(20)
  const docs = useLibrarySearch("", 20)

  // Reset search when the palette closes so the next open starts fresh.
  useEffect(() => {
    if (!open) setSearch("")
  }, [open])

  const filteredThreads = useMemo(() => (threads.data ?? []).slice(0, 5), [threads.data])
  const filteredDocs = useMemo(() => (docs.data ?? []).slice(0, 5), [docs.data])

  // Wrap a side-effect so every CommandItem closes the dialog after firing.
  const run = (fn: () => void) => () => {
    fn()
    onOpenChange(false)
  }

  const navigate = (path: string) =>
    run(() => {
      if (window.location.pathname + window.location.search !== path) {
        window.history.pushState({}, "", path)
        window.dispatchEvent(new PopStateEvent("popstate"))
      }
    })

  const toggleTheme = run(() => {
    const next = theme === "dark" ? "light" : "dark"
    setTheme(next)
    toast.success(`Theme: ${next}`)
  })

  const wipeCorpus = run(() => {
    const confirmed = window.confirm(
      "Wipe the entire corpus (Milvus + Neo4j)? This is irreversible.",
    )
    if (!confirmed) return
    void (async () => {
      try {
        const r = await fetch("/admin/wipe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: "corpus", confirm: "wipe" }),
        })
        if (!r.ok) throw new Error(`${r.status} ${r.statusText}`)
        toast.success("Corpus wiped.")
      } catch (err) {
        toast.error(`Wipe failed: ${(err as Error).message}`)
      }
    })()
  })

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Command palette"
      description="Search threads, documents, and actions"
    >
      <CommandInput
        value={search}
        onValueChange={setSearch}
        placeholder="Search threads, documents, actions…"
      />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={navigate("/")}>
            <Plus className="mr-2 size-4" /> New thread
            <CommandShortcut>⌘N</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={navigate("/ingest")}>
            <Upload className="mr-2 size-4" /> Ingest a document
            <CommandShortcut>⌘U</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={navigate("/settings")}>
            <Settings className="mr-2 size-4" /> Open settings
            <CommandShortcut>⌘,</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={toggleTheme}>
            {theme === "dark" ? (
              <Sun className="mr-2 size-4" />
            ) : (
              <Moon className="mr-2 size-4" />
            )}
            Toggle theme
            <CommandShortcut>⌘⇧L</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={wipeCorpus}>
            <Wand2 className="mr-2 size-4 text-destructive" />
            <span className="text-destructive">Wipe corpus</span>
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />

        <CommandGroup heading="Navigate">
          {NAV_TARGETS.map((n) => {
            const Icon = n.icon
            return (
              <CommandItem key={n.key} onSelect={navigate(n.path)} value={`go ${n.label}`}>
                <Icon className="mr-2 size-4" />
                Go to {n.label}
              </CommandItem>
            )
          })}
        </CommandGroup>

        {filteredThreads.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Threads">
              {filteredThreads.map((t) => {
                const title = t.question || "(untitled thread)"
                const sub = `${t.thread_id.slice(0, 8)} · ${t.citations} cites`
                return (
                  <CommandItem
                    key={t.thread_id}
                    value={`thread ${title} ${t.thread_id}`}
                    onSelect={navigate(`/?thread=${encodeURIComponent(t.thread_id)}`)}
                  >
                    <MessageSquare className="mr-2 size-4" />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{title}</span>
                      <span className="truncate font-mono text-[11px] text-muted-foreground">
                        {sub}
                      </span>
                    </div>
                  </CommandItem>
                )
              })}
            </CommandGroup>
          </>
        )}

        {filteredDocs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Documents">
              {filteredDocs.map((d) => (
                <CommandItem
                  key={d.doc_id}
                  value={`doc ${d.title} ${d.source_uri}`}
                  onSelect={navigate(`/library?doc=${encodeURIComponent(d.doc_id)}`)}
                >
                  <FileText className="mr-2 size-4" />
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{d.title || "untitled"}</span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground">
                      {d.chunks} chunks · {d.source_uri.slice(0, 60)}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="System">
          <CommandItem onSelect={navigate("/api/health")} value="health endpoint">
            <Database className="mr-2 size-4" />
            Probe service health
          </CommandItem>
          <CommandItem onSelect={navigate("/?inspector=open")} value="inspector">
            <Eye className="mr-2 size-4" />
            Open retrieval inspector
            <CommandShortcut>⌘I</CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}

/**
 * Bind ⌘K (and ⌘shift+L for theme, ⌘, for settings, ⌘N for new thread) globally.
 * Returns the open/setOpen pair so the caller mounts <CommandPalette> with them.
 */
export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  const { theme, setTheme } = useTheme()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // ⌘K / Ctrl+K toggles the palette.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      // ⌘shift+L toggles theme without opening the palette.
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "l") {
        e.preventDefault()
        setTheme(theme === "dark" ? "light" : "dark")
        return
      }
      // ⌘, opens settings.
      if ((e.metaKey || e.ctrlKey) && e.key === ",") {
        e.preventDefault()
        window.history.pushState({}, "", "/settings")
        window.dispatchEvent(new PopStateEvent("popstate"))
        return
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [theme, setTheme])

  return { open, setOpen }
}
