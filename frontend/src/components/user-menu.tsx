import { ChevronsUpDown, Languages, Monitor, Moon, Sun } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useTheme } from "@/lib/theme"

/** The dropdown body (theme + language switchers) shared by both triggers. */
function UserMenuItems() {
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()
  return (
    <>
      <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
        {t("topbar.user")}
      </DropdownMenuLabel>
      <DropdownMenuSeparator />

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          {theme === "dark" ? <Moon /> : theme === "light" ? <Sun /> : <Monitor />}
          <span>{t("userMenu.theme")}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as "light" | "dark" | "system")}>
            <DropdownMenuRadioItem value="light"><Sun /> {t("userMenu.themeLight")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark"><Moon /> {t("userMenu.themeDark")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system"><Monitor /> {t("userMenu.themeSystem")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>

      <DropdownMenuSub>
        <DropdownMenuSubTrigger>
          <Languages />
          <span>{t("userMenu.language")}</span>
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuRadioGroup
            value={i18n.resolvedLanguage ?? "en"}
            onValueChange={(v) => { void i18n.changeLanguage(v) }}
          >
            <DropdownMenuRadioItem value="en">{t("userMenu.languageEn")}</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="ru">{t("userMenu.languageRu")}</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  )
}

/** Sidebar-footer user menu (full-width row trigger). */
export function UserMenu() {
  const { isMobile } = useSidebar()
  const { t } = useTranslation()

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              <Avatar className="h-8 w-8 rounded-md">
                <AvatarFallback className="rounded-md bg-muted text-xs font-medium">U</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{t("topbar.user")}</span>
                <span className="truncate text-xs text-muted-foreground">localhost</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-56 rounded-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={4}
          >
            <UserMenuItems />
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}

/** Compact avatar user menu for the topbar right edge. */
export function TopbarUserMenu() {
  const { t } = useTranslation()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={t("topbar.user")}
          className="inline-flex shrink-0 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-[11px] font-medium text-primary">U</AvatarFallback>
          </Avatar>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 rounded-lg" side="bottom" align="end" sideOffset={8}>
        <UserMenuItems />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
