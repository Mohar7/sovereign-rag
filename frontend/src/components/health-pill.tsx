import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"

import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

export function HealthPill() {
  const { t } = useTranslation()
  const { data } = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 15_000,
    retry: false,
  })

  const states = data?.services.map((s) => s.state) ?? []
  const worst: "ok" | "warn" | "err" = states.includes("err")
    ? "err"
    : states.includes("warn")
      ? "warn"
      : "ok"

  const color =
    worst === "ok"   ? "bg-success"
    : worst === "warn" ? "bg-warning"
    :                    "bg-destructive"

  return (
    <div className="hidden lg:flex items-center gap-2 px-2 py-1 rounded-full border bg-card text-xs">
      <span className={cn("size-1.5 rounded-full", color)} />
      <span className="text-muted-foreground">{t(`health.${worst}`)}</span>
    </div>
  )
}
