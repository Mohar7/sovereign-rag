import { useState } from "react"
import {
  BarChart3,
  History,
  Inbox,
  Library as LibraryIcon,
  MoreHorizontal,
  Network,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// MobileTabBar
//
// Sticky bottom navigation visible only on sub-md viewports. Five slots —
// four canonical destinations + a "more" overflow that opens a Sheet for
// the secondary surfaces (settings / graph / evals / history). Matches
// the design's mobile.jsx layout: pill icons, label below, ~22px icon size,
// `padding-bottom: 18px` to clear the iOS home indicator.
// ─────────────────────────────────────────────────────────────────

export type MobileNavKey =
  | "ask"
  | "library"
  | "ingest"
  | "threads"
  | "graph"
  | "evals"
  | "history"
  | "settings"

interface Tab {
  key: MobileNavKey
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  path: string
}

const PRIMARY: Tab[] = [
  { key: "ask", label: "ask", icon: Sparkles, path: "/" },
  { key: "library", label: "library", icon: LibraryIcon, path: "/library" },
  { key: "ingest", label: "ingest", icon: Inbox, path: "/ingest" },
  { key: "threads", label: "threads", icon: Share2, path: "/threads" },
]

const OVERFLOW: Tab[] = [
  { key: "graph", label: "graph", icon: Network, path: "/graph" },
  { key: "evals", label: "evals", icon: BarChart3, path: "/evals" },
  { key: "history", label: "history", icon: History, path: "/history" },
  { key: "settings", label: "settings", icon: Settings, path: "/settings" },
]

export function MobileTabBar({ active }: { active: MobileNavKey }) {
  const [moreOpen, setMoreOpen] = useState(false)
  const overflowActive = OVERFLOW.some((t) => t.key === active)

  const navigate = (path: string) => {
    if (window.location.pathname !== path) {
      window.history.pushState({}, "", path)
      window.dispatchEvent(new PopStateEvent("popstate"))
    }
    setMoreOpen(false)
  }

  return (
    <>
      <nav
        aria-label="mobile navigation"
        // `md:hidden` so this only shows on mobile + small tablets. The
        // surrounding SidebarInset already has bottom padding via a global
        // class below, so the composer / page content clears this bar.
        className={cn(
          "fixed inset-x-0 bottom-0 z-40 flex md:hidden",
          "items-center justify-around gap-1",
          "border-t border-border bg-background/85 backdrop-blur-md",
          "pb-[max(env(safe-area-inset-bottom),0.5rem)] pt-2",
        )}
      >
        {PRIMARY.map((t) => (
          <TabButton
            key={t.key}
            tab={t}
            active={active === t.key}
            onClick={() => navigate(t.path)}
          />
        ))}
        <TabButton
          tab={{ key: "more", label: "more", icon: MoreHorizontal, path: "" } as Tab}
          active={overflowActive}
          onClick={() => setMoreOpen(true)}
        />
      </nav>

      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent
          side="bottom"
          // Matches the design's bottom-sheet pattern. The Sheet primitive
          // already handles the backdrop blur + dismiss-on-outside-click.
          className="rounded-t-2xl p-0"
        >
          <SheetHeader className="border-b border-border px-5 py-4">
            <SheetTitle className="text-[15px]">More</SheetTitle>
          </SheetHeader>
          <ul className="p-2">
            {OVERFLOW.map((t) => {
              const Icon = t.icon
              const isActive = active === t.key
              return (
                <li key={t.key}>
                  <button
                    type="button"
                    onClick={() => navigate(t.path)}
                    className={cn(
                      "flex w-full items-center gap-3 rounded-lg px-3 py-3 text-left",
                      isActive
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="size-4" strokeWidth={2} />
                    <span className="text-[14px] capitalize">{t.label}</span>
                  </button>
                </li>
              )
            })}
          </ul>
          {/* respect the iOS home indicator inside the Sheet too */}
          <div className="h-[max(env(safe-area-inset-bottom),0.5rem)]" />
        </SheetContent>
      </Sheet>
    </>
  )
}

function TabButton({
  tab,
  active,
  onClick,
}: {
  tab: Tab
  active: boolean
  onClick: () => void
}) {
  const Icon = tab.icon
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "inline-flex flex-1 flex-col items-center gap-0.5 rounded-md px-2 py-1",
        "text-[10.5px]",
        active ? "font-semibold text-primary" : "text-muted-foreground",
      )}
    >
      <Icon className="size-5" strokeWidth={active ? 2.25 : 2} />
      <span className="lowercase">{tab.label}</span>
    </button>
  )
}
