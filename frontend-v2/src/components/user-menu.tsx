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

export function UserMenu() {
  const { isMobile } = useSidebar()
  const { t, i18n } = useTranslation()
  const { theme, setTheme } = useTheme()

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
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  )
}
