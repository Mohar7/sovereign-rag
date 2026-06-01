import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { AppSidebar, type NavKey } from "@/components/app-sidebar"
import { CommandPalette, useCommandPalette } from "@/components/command-palette"
import { MobileTabBar } from "@/components/mobile-tab-bar"
import { PageStub } from "@/components/page-stub"
import { Topbar } from "@/components/topbar"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { AskPage } from "@/pages/Ask"
import { EvalsPage } from "@/pages/Evals"
import { GraphPage } from "@/pages/Graph"
import { HistoryPage } from "@/pages/History"
import { IngestPage } from "@/pages/Ingest"
import { LibraryPage } from "@/pages/Library"
import { SettingsPage } from "@/pages/Settings"
import { ThreadsPage } from "@/pages/Threads"

function pathToKey(pathname: string): NavKey {
  if (pathname.startsWith("/library")) return "library"
  if (pathname.startsWith("/ingest")) return "ingest"
  if (pathname.startsWith("/threads")) return "threads"
  if (pathname.startsWith("/graph")) return "graph"
  if (pathname.startsWith("/evals")) return "evals"
  if (pathname.startsWith("/history")) return "history"
  if (pathname.startsWith("/settings")) return "settings"
  return "ask"
}

const KEY_TO_PATH: Record<NavKey, string> = {
  ask: "/",
  library: "/library",
  ingest: "/ingest",
  threads: "/threads",
  graph: "/graph",
  evals: "/evals",
  history: "/history",
  settings: "/settings",
}

export default function App() {
  const { t } = useTranslation()
  const [page, setPage] = useState<NavKey>(() => pathToKey(window.location.pathname))
  const palette = useCommandPalette()

  useEffect(() => {
    const onPop = () => setPage(pathToKey(window.location.pathname))
    window.addEventListener("popstate", onPop)
    return () => window.removeEventListener("popstate", onPop)
  }, [])

  const onNavigate = (key: NavKey) => {
    const next = KEY_TO_PATH[key]
    if (window.location.pathname !== next) {
      window.history.pushState({}, "", next)
    }
    setPage(key)
  }

  return (
    <SidebarProvider>
      <AppSidebar active={page} onNavigate={onNavigate} />
      <SidebarInset className="min-w-0 overflow-hidden">
        <Topbar page={page} onOpenCommand={() => palette.setOpen(true)} />
        <main className="min-w-0 flex-1 overflow-hidden">
          {page === "ask" ? (
            <AskPage />
          ) : page === "library" ? (
            <LibraryPage />
          ) : page === "ingest" ? (
            <IngestPage />
          ) : page === "threads" ? (
            <ThreadsPage />
          ) : page === "graph" ? (
            <GraphPage />
          ) : page === "evals" ? (
            <EvalsPage />
          ) : page === "history" ? (
            <HistoryPage />
          ) : page === "settings" ? (
            <SettingsPage />
          ) : (
            <PageStub title={t(`pages.${page}.title`, { defaultValue: page })}>
              <p className="text-sm text-muted-foreground">
                {t(`pages.${page}.empty`, { defaultValue: "" })}
              </p>
            </PageStub>
          )}
        </main>
      </SidebarInset>
      <MobileTabBar active={page} />
      <CommandPalette open={palette.open} onOpenChange={palette.setOpen} />
    </SidebarProvider>
  )
}
