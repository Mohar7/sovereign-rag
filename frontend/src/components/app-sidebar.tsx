import {
  BarChart3,
  BookOpen,
  History,
  Inbox,
  MessageSquare,
  Network,
  Send,
  Settings as SettingsIcon,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { BrandMark } from "@/components/brand-mark"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar"
import { UserMenu } from "@/components/user-menu"

type NavKey =
  | "ask"
  | "library"
  | "ingest"
  | "threads"
  | "graph"
  | "evals"
  | "history"
  | "settings"

interface Props {
  active: NavKey
  onNavigate: (key: NavKey) => void
}

export function AppSidebar({ active, onNavigate }: Props) {
  const { t } = useTranslation()
  const items: { key: NavKey; icon: typeof BookOpen; href: string }[] = [
    { key: "ask",      icon: Send,          href: "/" },
    { key: "library",  icon: BookOpen,      href: "/library" },
    { key: "ingest",   icon: Inbox,         href: "/ingest" },
    { key: "threads",  icon: MessageSquare, href: "/threads" },
    { key: "graph",    icon: Network,       href: "/graph" },
    { key: "evals",    icon: BarChart3,     href: "/evals" },
    { key: "history",  icon: History,       href: "/history" },
    { key: "settings", icon: SettingsIcon,  href: "/settings" },
  ]
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="/" onClick={(e) => { e.preventDefault(); onNavigate("ask") }}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <BrandMark size={16} className="text-primary-foreground" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{t("brand.name")}</span>
                  <span className="truncate text-xs text-muted-foreground">{t("brand.tagline")}</span>
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => {
                const Icon = it.icon
                return (
                  <SidebarMenuItem key={it.key}>
                    <SidebarMenuButton
                      isActive={active === it.key}
                      tooltip={t(`nav.${it.key}`)}
                      asChild
                    >
                      <a href={it.href} onClick={(e) => { e.preventDefault(); onNavigate(it.key) }}>
                        <Icon />
                        <span>{t(`nav.${it.key}`)}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <UserMenu />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

export type { NavKey }
