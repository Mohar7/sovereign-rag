import { useEffect, useState } from "react"
import { Command as CommandIcon, Search } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbList,
  BreadcrumbPage,
} from "@/components/ui/breadcrumb"
import { Separator } from "@/components/ui/separator"
import { SidebarTrigger } from "@/components/ui/sidebar"
import { HealthPill } from "@/components/health-pill"
import { TopbarUserMenu } from "@/components/user-menu"
import { cn } from "@/lib/utils"
import type { NavKey } from "@/components/app-sidebar"

interface Props {
  page: NavKey
  onOpenCommand?: () => void
}

export function Topbar({ page, onOpenCommand }: Props) {
  const { t } = useTranslation()
  // The topbar is solid at rest and only gains the blur/translucency once
  // content scrolls under it. Scrolling happens inside per-page containers
  // (not the window), so listen in the capture phase to catch any of them.
  const [scrolled, setScrolled] = useState(false)
  // Reset the scrolled state when the page changes (React-blessed
  // adjust-state-during-render pattern — the new page starts at the top).
  const [prevPage, setPrevPage] = useState(page)
  if (page !== prevPage) {
    setPrevPage(page)
    setScrolled(false)
  }
  useEffect(() => {
    const onScroll = (e: Event) => {
      const el = e.target as HTMLElement | null
      setScrolled(!!el && typeof el.scrollTop === "number" && el.scrollTop > 4)
    }
    document.addEventListener("scroll", onScroll, true)
    return () => document.removeEventListener("scroll", onScroll, true)
  }, [])

  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b transition-colors duration-[120ms]",
        scrolled ? "bg-background/75 backdrop-blur-md" : "bg-background",
      )}
    >
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        <Separator orientation="vertical" className="mx-2 h-4" />
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbPage className="lowercase">{t(`nav.${page}`)}</BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
      </div>
      <div className="ml-auto flex items-center gap-2 px-4">
        <Button
          variant="outline"
          size="sm"
          className="hidden md:inline-flex gap-2"
          onClick={onOpenCommand}
        >
          <Search className="size-3.5" />
          <span className="text-muted-foreground">{t("topbar.search")}</span>
          <kbd className="ml-2 inline-flex items-center gap-0.5 rounded border bg-muted px-1.5 text-[10px] font-mono text-muted-foreground">
            <CommandIcon className="size-3" />K
          </kbd>
        </Button>
        <Button
          variant="outline"
          size="icon"
          className="md:hidden"
          aria-label={t("topbar.openCommandPalette")}
          onClick={onOpenCommand}
        >
          <Search className="size-4" />
        </Button>
        <HealthPill />
        <TopbarUserMenu />
      </div>
    </header>
  )
}
