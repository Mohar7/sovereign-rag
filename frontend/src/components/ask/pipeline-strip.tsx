import {
  Check,
  CircleDot,
  CloudDownload,
  CornerDownLeft,
  Gauge,
  Globe,
  Layers,
  Loader2,
  RotateCcw,
  Scale,
  ScanSearch,
  Sparkles,
  User,
  Wand2,
} from "lucide-react"
import { useTranslation } from "react-i18next"

import { cn } from "@/lib/utils"
import type { GradeModel } from "@/lib/api"
import { GradeChip } from "@/components/crag/grade-chip"

// ─────────────────────────────────────────────────────────────────
// PipelineStrip
//
// Renders the RAG pipeline nodes as a horizontal pill row (happy path)
// or as stacked corrective lanes (when the CRAG loop ran).
//
// Happy path: retrieve_local → rerank → grade → generate
// Corrective: three stacked lanes with return arrows:
//   Pass 1 · local: retrieve → rerank → grade (ambiguous/incorrect)
//   Correction · web fallback: transform_query → web_search → human → crawl_index
//   Pass 2 · re-retrieve: retrieve → rerank → grade (correct) → generate
// ─────────────────────────────────────────────────────────────────

export type StageName =
  | "retrieve_local"
  | "rerank"
  | "grade"
  | "transform_query"
  | "web_search"
  | "crawl_index"
  | "generate"

export type StagePhase = "idle" | "running" | "done" | "human"

export interface StageState {
  phase: StagePhase
  /** Elapsed time in ms once the stage is done. */
  elapsedMs?: number
  /** Optional sub-label (e.g. "2 pages · 41 chunks"). */
  mono?: string
}

export interface PipelineStripProps {
  stages: Record<StageName, StageState>
  /** If provided, shows the grade chip next to the grade stage. */
  grade?: GradeModel | null
  /**
   * When true, renders the three-lane corrective view instead of the
   * compact happy-path row. Derive from whether any correction-stage
   * phase is non-idle (the ask page sets this explicitly for clarity).
   */
  corrective?: boolean
}

const STAGE_ORDER_HAPPY: StageName[] = [
  "retrieve_local",
  "rerank",
  "grade",
  "generate",
]

const STAGE_META: Record<
  StageName,
  { labelKey: string; icon: React.ComponentType<{ className?: string }> }
> = {
  retrieve_local: { labelKey: "pages.ask.pipeline.retrieve", icon: ScanSearch },
  rerank: { labelKey: "pages.ask.pipeline.rerank", icon: Scale },
  grade: { labelKey: "pages.ask.pipeline.grade", icon: Gauge },
  transform_query: { labelKey: "pages.ask.pipeline.transformQuery", icon: Wand2 },
  web_search: { labelKey: "pages.ask.pipeline.webSearch", icon: Globe },
  crawl_index: { labelKey: "pages.ask.pipeline.crawlIndex", icon: CloudDownload },
  generate: { labelKey: "pages.ask.pipeline.generate", icon: Sparkles },
}

// ── Happy path ────────────────────────────────────────────────────

export function PipelineStrip({ stages, grade, corrective }: PipelineStripProps) {
  const { t } = useTranslation()

  if (corrective) {
    return <CorrectiveLanes stages={stages} grade={grade} />
  }

  return (
    <ol
      aria-label={t("pages.ask.pipeline.progress")}
      className="flex items-center gap-1.5 rounded-full border border-border bg-card/60 px-2 py-1.5 text-[12px]"
    >
      {STAGE_ORDER_HAPPY.map((name, i) => {
        const stage = stages[name]
        const meta = STAGE_META[name]
        return (
          <li key={name} className="flex items-center gap-1.5">
            {i > 0 && <Connector active={stage.phase !== "idle"} />}
            <StagePill
              name={name}
              stage={stage}
              meta={meta}
              gradeChip={name === "grade" && grade ? (
                <GradeChip label={grade.label} confidence={grade.confidence} size="sm" />
              ) : undefined}
            />
          </li>
        )
      })}
    </ol>
  )
}

// ── Corrective lanes ──────────────────────────────────────────────

/** Three-lane corrective strip — matches CorrectiveStripMobile structure. */
function CorrectiveLanes({
  stages,
  grade,
}: {
  stages: Record<StageName, StageState>
  grade?: GradeModel | null
}) {
  const { t } = useTranslation()

  return (
    <div
      data-active
      className="rounded-[var(--radius-lg)] border border-border bg-card px-[18px] py-4"
    >
      {/* Header */}
      <div className="mb-3 flex items-center gap-2.5">
        <Layers className="size-[15px] text-muted-foreground shrink-0" />
        <span className="font-mono text-[12.5px] text-muted-foreground">
          {t("pages.ask.pipeline.progress")}
        </span>
        <span className="flex-1" />
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-2 py-0.5 text-[11px] font-medium text-warning">
          <RotateCcw className="size-[10px]" />
          {t("pages.ask.pipeline.selfCorrected")}
        </span>
      </div>

      {/* Pass 1 — local corpus */}
      <LaneSection
        label={t("pages.ask.pipeline.pass1")}
        tone="muted"
      >
        <LaneRow name="retrieve_local" stage={stages.retrieve_local} />
        <LaneRow name="rerank" stage={stages.rerank} />
        <LaneRow
          name="grade"
          stage={stages.grade}
          chip={
            grade && (grade.label === "ambiguous" || grade.label === "incorrect") ? (
              <GradeChip label={grade.label} confidence={grade.confidence} size="sm" />
            ) : undefined
          }
        />
      </LaneSection>

      {/* Return arrow */}
      <ReturnArrow label={t("pages.ask.pipeline.sourcesAmbiguous")} />

      {/* Correction lane — web fallback */}
      <LaneSection
        label={t("pages.ask.pipeline.correction")}
        tone="warn"
      >
        <LaneRow name="transform_query" stage={stages.transform_query} />
        <LaneRow name="web_search" stage={stages.web_search} />
        {/* Human decision placeholder row */}
        <HumanDecisionRow stage={stages.web_search} />
        <LaneRow name="crawl_index" stage={stages.crawl_index} />
      </LaneSection>

      {/* Return arrow */}
      <ReturnArrow label={t("pages.ask.pipeline.reRetrieveWithCrawled")} />

      {/* Pass 2 — re-retrieve */}
      <LaneSection
        label={t("pages.ask.pipeline.pass2")}
        tone="brand"
      >
        <LaneRow name="retrieve_local" stage={stages.retrieve_local} label={`${t("pages.ask.pipeline.retrieve")} (2)`} />
        <LaneRow name="rerank" stage={stages.rerank} label={`${t("pages.ask.pipeline.rerank")} (2)`} />
        <LaneRow
          name="grade"
          stage={stages.grade}
          label={t("pages.ask.pipeline.grade")}
          chip={
            grade && grade.label === "correct" ? (
              <GradeChip label="correct" confidence={grade.confidence} size="sm" />
            ) : undefined
          }
        />
        <LaneRow name="generate" stage={stages.generate} />
      </LaneSection>
    </div>
  )
}

// ── Lane building blocks ──────────────────────────────────────────

function LaneSection({
  label,
  tone,
  children,
}: {
  label: string
  tone: "muted" | "warn" | "brand"
  children: React.ReactNode
}) {
  const borderColor =
    tone === "warn"
      ? "color-mix(in oklab, var(--warning) 45%, transparent)"
      : tone === "brand"
        ? "color-mix(in oklab, var(--primary) 45%, transparent)"
        : "var(--border)"

  return (
    <div
      className="mb-1 pl-3"
      style={{ borderLeft: `2px solid ${borderColor}` }}
    >
      <LaneTag tone={tone}>{label}</LaneTag>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}

function LaneTag({
  children,
  tone = "muted",
}: {
  children: React.ReactNode
  tone?: "muted" | "warn" | "brand"
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center gap-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-[0.04em]",
        tone === "warn" && "text-warning",
        tone === "brand" && "text-primary",
        tone === "muted" && "text-muted-foreground",
      )}
    >
      {children}
    </div>
  )
}

function LaneRow({
  name,
  stage,
  label: labelOverride,
  chip,
}: {
  name: StageName
  stage: StageState
  label?: string
  chip?: React.ReactNode
}) {
  const { t } = useTranslation()
  const meta = STAGE_META[name]
  const Icon = meta.icon
  const isDone = stage.phase === "done"
  const isRunning = stage.phase === "running"
  const isHuman = stage.phase === "human"

  return (
    <div className="flex items-center gap-2.5 py-[9px]">
      {/* Icon box */}
      <div
        className={cn(
          "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
          isHuman && "bg-warning/14 text-warning",
          (isDone || isRunning) && !isHuman && "bg-primary/11 text-primary",
          !isDone && !isRunning && !isHuman && "bg-muted text-muted-foreground",
        )}
      >
        {isRunning ? (
          <Loader2 className="size-[14px] animate-spin" />
        ) : (
          <Icon className="size-[14px]" />
        )}
      </div>

      {/* Label + mono */}
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "flex items-center gap-1 text-[13px] font-medium",
            !isDone && !isRunning && !isHuman && "text-muted-foreground",
          )}
        >
          {isDone && <Check className="size-[11px] shrink-0 text-primary" />}
          <span>{labelOverride ?? t(meta.labelKey)}</span>
        </div>
        {stage.mono && (
          <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
            {stage.mono}
          </div>
        )}
      </div>

      {/* Grade chip or ms */}
      {chip}
      {!chip && isDone && typeof stage.elapsedMs === "number" && (
        <span className="shrink-0 font-mono text-[11px] text-muted-foreground tabular-nums">
          {formatMs(stage.elapsedMs)}
        </span>
      )}
    </div>
  )
}

/** Placeholder row for the "human decision" step in the correction lane. */
function HumanDecisionRow({ stage }: { stage: StageState }) {
  const { t } = useTranslation()
  const isDone = stage.phase === "done"
  return (
    <div className="flex items-center gap-2.5 py-[9px]">
      <div className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg bg-warning/14 text-warning">
        <User className="size-[14px]" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[13px] font-medium text-warning">
          {t("pages.ask.pipeline.humanDecision")}
        </div>
      </div>
      {isDone && (
        <span className="inline-flex items-center gap-1 rounded-full border border-warning/35 bg-warning/10 px-1.5 py-0.5 text-[11px] font-medium text-warning">
          <Check className="size-[10px]" />
          {t("pages.ask.pipeline.approved")}
        </span>
      )}
    </div>
  )
}

function ReturnArrow({ label }: { label: string }) {
  return (
    <div className="my-3 flex items-center gap-2.5 pl-1">
      <div className="inline-flex size-[26px] items-center justify-center rounded-[7px] bg-primary/11 text-primary">
        <CornerDownLeft className="size-[14px]" />
      </div>
      <span className="font-mono text-[11.5px] font-medium text-primary">
        {label}
      </span>
      <div
        className="h-px flex-1"
        style={{ background: "color-mix(in oklab, var(--primary) 22%, transparent)" }}
      />
    </div>
  )
}

// ── Shared sub-components ─────────────────────────────────────────

function StagePill({
  name,
  stage,
  meta,
  gradeChip,
}: {
  name: StageName
  stage: StageState
  meta: (typeof STAGE_META)[StageName]
  gradeChip?: React.ReactNode
}) {
  const { t } = useTranslation()
  const isRunning = stage.phase === "running"
  const isDone = stage.phase === "done"
  return (
    <span
      data-stage={name}
      data-phase={stage.phase}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 font-mono",
        "transition-colors duration-[120ms]",
        isDone && "bg-primary/10 text-primary",
        isRunning && "bg-primary/15 text-primary ring-1 ring-primary/40",
        !isDone && !isRunning && "text-muted-foreground",
      )}
    >
      <StatusIcon phase={stage.phase} />
      <span className="text-[11.5px] uppercase tracking-wide">{t(meta.labelKey)}</span>
      {isDone && typeof stage.elapsedMs === "number" && (
        <span className="font-mono text-[10.5px] tabular-nums opacity-80">
          {formatMs(stage.elapsedMs)}
        </span>
      )}
      {isRunning && (
        <span className="font-mono text-[10.5px] uppercase opacity-80">{t("status.live")}</span>
      )}
      {gradeChip}
    </span>
  )
}

function StatusIcon({ phase }: { phase: StagePhase }) {
  if (phase === "running") {
    return <Loader2 className="size-3 animate-spin" />
  }
  if (phase === "done") {
    return <Check className="size-3" />
  }
  // idle / human
  return <CircleDot className="size-3 opacity-50" />
}

function Connector({ active }: { active: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-px w-3 transition-colors duration-[120ms]",
        active ? "bg-primary/60" : "bg-border",
      )}
    />
  )
}

function formatMs(n: number): string {
  if (n < 1000) return `${n}ms`
  return `${(n / 1000).toFixed(1)}s`
}

/** Helper: derive the initial `stages` map for a new turn. */
export function emptyStages(): Record<StageName, StageState> {
  return {
    retrieve_local: { phase: "idle" },
    rerank: { phase: "idle" },
    grade: { phase: "idle" },
    transform_query: { phase: "idle" },
    web_search: { phase: "idle" },
    crawl_index: { phase: "idle" },
    generate: { phase: "idle" },
  }
}
