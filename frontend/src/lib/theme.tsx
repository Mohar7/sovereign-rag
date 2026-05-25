import { createContext, useContext, useEffect, useState } from "react"
import type { ReactNode } from "react"

type Theme = "light" | "dark" | "system"

interface ThemeContextValue {
  theme: Theme
  setTheme: (next: Theme) => void
  resolved: "light" | "dark"
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

const STORAGE_KEY = "sovereign-rag.theme"

function resolveSystem(): "light" | "dark" {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    if (typeof window === "undefined") return "system"
    return (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system"
  })
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    theme === "system" ? resolveSystem() : theme,
  )

  useEffect(() => {
    const r = theme === "system" ? resolveSystem() : theme
    setResolved(r)
    document.documentElement.classList.toggle("dark", r === "dark")
  }, [theme])

  useEffect(() => {
    if (theme !== "system") return
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const r = resolveSystem()
      setResolved(r)
      document.documentElement.classList.toggle("dark", r === "dark")
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [theme])

  const setTheme = (next: Theme) => {
    localStorage.setItem(STORAGE_KEY, next)
    setThemeState(next)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme, resolved }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider")
  return ctx
}
