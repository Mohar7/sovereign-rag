import { useEffect, useMemo, useRef, useState } from "react"
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type Simulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force"
import { Loader2, Network, RefreshCw, Search, Share2, X } from "lucide-react"
import { useTranslation } from "react-i18next"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  useGraphEntities,
  useGraphNeighborhood,
  useGraphStats,
} from "@/hooks/use-graph"
import type { EntityRow, GraphEdge, GraphNode } from "@/lib/api"
import { formatCount } from "@/lib/format"
import { cn } from "@/lib/utils"

// ─────────────────────────────────────────────────────────────────
// Simulation primitives — extend d3 base types with our fields
// ─────────────────────────────────────────────────────────────────

interface SimNode extends SimulationNodeDatum {
  id: string
  label: string
  type?: string | null
  mentions: number
  distance: number
}

interface SimLink extends SimulationLinkDatum<SimNode> {
  type: string
  description?: string | null
}

// Stage size — the simulation runs in this coordinate space, rendered as a
// responsive SVG via viewBox. 960×640 matches the design hero proportions.
const STAGE_W = 960
const STAGE_H = 640

/** Map mentions → glyph radius. Sub-linear so a 100-mention hub isn't a blob. */
function radiusForMentions(m: number): number {
  return 8 + Math.min(20, Math.sqrt(Math.max(0, m)) * 2.5)
}

/** Colour a node by its extracted entity kind (the design-system encoding). */
const KIND_COLOR: Record<string, string> = {
  person: "var(--chart-4)",
  organization: "var(--primary)",
  location: "var(--warning)",
  concept: "var(--chart-2)",
  technology: "var(--success)",
  event: "var(--destructive)",
}
function kindColor(type?: string | null): string {
  if (!type) return "var(--muted-foreground)"
  return KIND_COLOR[type.toLowerCase()] ?? "var(--muted-foreground)"
}

// ─────────────────────────────────────────────────────────────────
// Graph page
// ─────────────────────────────────────────────────────────────────

export function GraphPage() {
  const { t } = useTranslation()
  const [seed, setSeed] = useState<string | null>(null)
  const [depth, setDepth] = useState(2)
  const [search, setSearch] = useState("")
  const [hovered, setHovered] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const stats = useGraphStats()
  const entities = useGraphEntities(search, 25)
  const nbh = useGraphNeighborhood(seed, depth, 80)

  // Auto-seed with the most-mentioned entity once the entity list is in.
  useEffect(() => {
    if (seed || !entities.data || entities.data.length === 0) return
    setSeed(entities.data[0].name)
  }, [seed, entities.data])

  return (
    <div className="flex h-[calc(100svh-4rem-3.5rem)] md:h-[calc(100svh-4rem)] min-h-0 w-full overflow-hidden">
      {/* left rail: seed picker + corpus stats */}
      <aside className="hidden w-[280px] shrink-0 flex-col border-r border-border bg-background lg:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="flex items-center gap-2 text-[14px] font-semibold">
            <Network className="size-3.5 text-muted-foreground" strokeWidth={2} />
            {t("pages.graph.explorer")}
          </div>
          {stats.data && (
            <p className="mt-2 font-mono text-[11px] leading-[1.55] text-muted-foreground">
              {t("pages.graph.corpusStats", {
                entities: formatCount(stats.data.entities),
                relations: formatCount(stats.data.relations),
                mentions: formatCount(stats.data.mentions),
              })}
            </p>
          )}
        </div>
        <div className="border-b border-border px-4 py-3 space-y-2">
          <div className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
            {t("pages.graph.seedEntity")}
          </div>
          <div className="relative">
            <Search
              className="absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
              strokeWidth={2}
            />
            <Input
              placeholder={t("pages.graph.searchEntities")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-8 h-8 text-[13px]"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-3" strokeWidth={2} />
              </button>
            )}
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
              {t("pages.graph.depth")}
            </span>
            {[1, 2, 3].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDepth(d)}
                className={cn(
                  "inline-flex h-6 min-w-6 items-center justify-center rounded border px-1.5 font-mono text-[11px]",
                  depth === d
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-card hover:bg-muted",
                )}
              >
                {d}
              </button>
            ))}
          </div>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          {entities.isLoading && (
            <div className="p-4 text-[12.5px] text-muted-foreground">
              {t("common.loading")}
            </div>
          )}
          {!entities.isLoading && (entities.data?.length ?? 0) === 0 && (
            <div className="p-4 text-[12.5px] text-muted-foreground">
              {t("pages.graph.noEntitiesMatch")}
            </div>
          )}
          <ul className="p-2">
            {(entities.data ?? []).map((e) => (
              <EntityListItem
                key={e.name}
                entity={e}
                selected={seed === e.name}
                onClick={() => {
                  setSeed(e.name)
                  setSelected(null)
                }}
              />
            ))}
          </ul>
        </ScrollArea>
      </aside>

      {/* canvas */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-6 py-3">
          <h1 className="text-[15px] font-semibold tracking-tight">
            {seed ? (
              <>
                {t("pages.graph.neighborhoodOf")}{" "}
                <span className="text-primary">{seed}</span>
              </>
            ) : (
              t("pages.graph.title")
            )}
          </h1>
          {nbh.data && (
            <span className="font-mono text-[11.5px] text-muted-foreground">
              {t("pages.graph.canvasStats", {
                nodes: formatCount(nbh.data.nodes.length),
                edges: formatCount(nbh.data.edges.length),
                depth: nbh.data.depth,
              })}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => void nbh.refetch()}
            disabled={!seed}
          >
            <RefreshCw
              className={cn("size-3.5", nbh.isFetching && "animate-spin")}
              strokeWidth={2}
            />
            {t("actions.refresh")}
          </Button>
        </div>
        <div className="relative flex-1 overflow-hidden">
          {/* dot-grid — the only grid texture in the system (24px pitch, --border @40%) */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              backgroundImage:
                "radial-gradient(circle, color-mix(in oklab, var(--border) 40%, transparent) 1px, transparent 1px)",
              backgroundSize: "24px 24px",
            }}
          />
          {nbh.isLoading && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              <Loader2 className="mr-2 size-3.5 animate-spin" />
              {t("pages.graph.expanding")}
            </div>
          )}
          {!nbh.isLoading && !nbh.data && !seed && (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-muted-foreground">
              {t("pages.graph.pickSeed")}
            </div>
          )}
          {nbh.data && (
            <GraphCanvas
              nodes={nbh.data.nodes}
              edges={nbh.data.edges}
              hovered={hovered}
              selected={selected}
              onHover={setHovered}
              onSelect={(id) => setSelected((cur) => (cur === id ? null : id))}
            />
          )}
        </div>
      </div>

      {/* right panel: selected node details */}
      <aside className="hidden w-[300px] shrink-0 flex-col border-l border-border bg-background xl:flex">
        <div className="border-b border-border px-4 py-3">
          <div className="text-[14px] font-semibold">
            {t("pages.graph.selection")}
          </div>
          <p className="mt-0.5 text-[11.5px] text-muted-foreground">
            {t("pages.graph.selectionHint")}
          </p>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <SelectionPanel
            neighborhood={nbh.data}
            selected={selected}
            onPickSeed={(name) => {
              setSeed(name)
              setSelected(null)
            }}
          />
        </ScrollArea>
      </aside>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────
// Entity list item (left rail)
// ─────────────────────────────────────────────────────────────────

function EntityListItem({
  entity,
  selected,
  onClick,
}: {
  entity: EntityRow
  selected: boolean
  onClick: () => void
}) {
  useTranslation()
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className={cn(
          "flex w-full items-baseline gap-2 rounded-md px-2.5 py-1.5 text-left transition-colors",
          selected ? "bg-primary/10" : "hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "block size-1.5 shrink-0 rounded-full",
            selected ? "bg-primary" : "bg-muted-foreground/50",
          )}
        />
        <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">
          {entity.name}
        </span>
        {entity.type && (
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            {entity.type}
          </span>
        )}
        <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">
          {formatCount(entity.mentions)}
        </span>
      </button>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────────
// Canvas — force-directed SVG render
// ─────────────────────────────────────────────────────────────────

interface CanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  hovered: string | null
  selected: string | null
  onHover: (id: string | null) => void
  onSelect: (id: string) => void
}

function GraphCanvas({ nodes, edges, hovered, selected, onHover, onSelect }: CanvasProps) {
  // Tick counter forces React to re-render on every simulation tick. The
  // simulation mutates `simNodes` in place; pulling them through state keeps
  // SVG positions reactive without copying the node array on every tick.
  const [, setTick] = useState(0)
  const simNodesRef = useRef<SimNode[]>([])
  const simLinksRef = useRef<SimLink[]>([])
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null)

  // Rebuild the simulation whenever the input data changes (new neighborhood).
  useEffect(() => {
    // Stop any prior simulation so we don't get callbacks against stale state.
    simRef.current?.stop()

    const simNodes: SimNode[] = nodes.map((n) => ({
      id: n.id,
      label: n.label,
      type: n.type,
      mentions: n.mentions,
      distance: n.distance,
      // d3-force respects pre-populated x/y; seeding around the centre helps
      // the layout converge without an ugly initial explosion.
      x: STAGE_W / 2 + (Math.random() - 0.5) * 60,
      y: STAGE_H / 2 + (Math.random() - 0.5) * 60,
    }))
    const byId = new Map(simNodes.map((n) => [n.id, n]))
    const simLinks: SimLink[] = edges
      .map((e): SimLink | null => {
        const source = byId.get(e.source)
        const target = byId.get(e.target)
        if (!source || !target) return null
        return { source, target, type: e.type, description: e.description }
      })
      .filter((l): l is SimLink => l !== null)

    simNodesRef.current = simNodes
    simLinksRef.current = simLinks

    const sim = forceSimulation<SimNode>(simNodes)
      .force(
        "link",
        forceLink<SimNode, SimLink>(simLinks)
          .id((d) => d.id)
          .distance(110)
          .strength(0.4),
      )
      .force("charge", forceManyBody<SimNode>().strength(-280))
      .force("center", forceCenter(STAGE_W / 2, STAGE_H / 2))
      .force("collide", forceCollide<SimNode>().radius((d) => radiusForMentions(d.mentions) + 4))
      .alpha(1)
      .alphaDecay(0.04)

    sim.on("tick", () => setTick((t) => t + 1))
    simRef.current = sim

    return () => {
      sim.stop()
    }
  }, [nodes, edges])

  const simNodes = simNodesRef.current
  const simLinks = simLinksRef.current

  // Track which links touch the focused (hovered/selected) node so they can
  // be highlighted; everything else dims.
  const focused = selected ?? hovered
  const focusedSet = useMemo(() => {
    if (!focused) return null
    const ids = new Set<string>([focused])
    for (const l of simLinks) {
      const s = (l.source as SimNode).id
      const t = (l.target as SimNode).id
      if (s === focused) ids.add(t)
      if (t === focused) ids.add(s)
    }
    return ids
  }, [focused, simLinks])

  return (
    <svg
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      preserveAspectRatio="xMidYMid meet"
      className="absolute inset-0 size-full"
      onClick={() => onHover(null)}
    >
      {/* Edges */}
      <g>
        {simLinks.map((l, i) => {
          const a = l.source as SimNode
          const b = l.target as SimNode
          const hot = focusedSet ? focusedSet.has(a.id) && focusedSet.has(b.id) : false
          const dimmed = focusedSet != null && !hot
          return (
            <line
              key={i}
              x1={a.x ?? 0}
              y1={a.y ?? 0}
              x2={b.x ?? 0}
              y2={b.y ?? 0}
              stroke={hot ? "var(--primary)" : "var(--border)"}
              strokeWidth={hot ? 1.5 : 1}
              strokeOpacity={dimmed ? 0.2 : hot ? 0.85 : 0.55}
            />
          )
        })}
      </g>
      {/* Nodes */}
      <g>
        {simNodes.map((n) => {
          const r = radiusForMentions(n.mentions)
          const isSelected = selected === n.id
          const isHovered = hovered === n.id
          const halo = isSelected || isHovered
          const dimmed = focusedSet != null && !focusedSet.has(n.id)
          return (
            <g
              key={n.id}
              transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
              onMouseEnter={() => onHover(n.id)}
              onMouseLeave={() => onHover(null)}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(n.id)
              }}
              style={{ cursor: "pointer", opacity: dimmed ? 0.35 : 1 }}
            >
              {halo && (
                <circle
                  r={r + 8}
                  fill="none"
                  stroke="var(--primary)"
                  strokeWidth={1.5}
                  strokeOpacity={0.5}
                />
              )}
              <circle
                r={r}
                fill={kindColor(n.type)}
                stroke="var(--background)"
                strokeWidth={2}
              />
              <text
                y={r + 12}
                textAnchor="middle"
                fontFamily="var(--font-sans)"
                fontSize={11.5}
                fill="var(--foreground)"
                style={{ pointerEvents: "none" }}
              >
                {n.label.length > 22 ? `${n.label.slice(0, 20)}…` : n.label}
              </text>
            </g>
          )
        })}
      </g>
    </svg>
  )
}

// ─────────────────────────────────────────────────────────────────
// Right panel — selected node details + neighbour list
// ─────────────────────────────────────────────────────────────────

function SelectionPanel({
  neighborhood,
  selected,
  onPickSeed,
}: {
  neighborhood: { nodes: GraphNode[]; edges: GraphEdge[] } | undefined
  selected: string | null
  onPickSeed: (name: string) => void
}) {
  const { t } = useTranslation()
  if (!neighborhood) {
    return (
      <div className="p-4 text-[12.5px] text-muted-foreground">
        {t("pages.graph.loadNeighborhood")}
      </div>
    )
  }
  if (!selected) {
    return (
      <div className="p-4 text-[12.5px] text-muted-foreground">
        {t("pages.graph.nothingSelected")}
      </div>
    )
  }
  const node = neighborhood.nodes.find((n) => n.id === selected)
  if (!node) {
    return (
      <div className="p-4 text-[12.5px] text-muted-foreground">
        {t("pages.graph.nodeNotInView")}
      </div>
    )
  }
  const incident = neighborhood.edges.filter(
    (e) => e.source === selected || e.target === selected,
  )
  return (
    <div className="p-4 space-y-4">
      <div>
        <h2 className="break-words text-[15px] font-semibold leading-[1.35] text-foreground">
          {node.label}
        </h2>
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          {node.type && (
            <Badge variant="outline" className="font-mono text-[10.5px]">
              {node.type}
            </Badge>
          )}
          <Badge variant="secondary" className="font-mono text-[10.5px]">
            {t("pages.graph.mentionsCount", {
              count: node.mentions,
              formatted: formatCount(node.mentions),
            })}
          </Badge>
          <Badge variant="outline" className="font-mono text-[10.5px]">
            {node.distance === 0
              ? t("pages.graph.seed")
              : t("pages.graph.hopsCount", { count: node.distance })}
          </Badge>
        </div>
        {node.description && (
          <p className="mt-2 text-[12.5px] leading-[1.55] text-muted-foreground">
            {node.description}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="mt-3 h-7 w-full justify-center gap-1.5"
          onClick={() => onPickSeed(node.id)}
          disabled={node.distance === 0}
        >
          <Share2 className="size-3.5" strokeWidth={2} />
          {t("pages.graph.recenterOnThis")}
        </Button>
      </div>

      <div>
        <div className="mb-1.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
          {t("pages.graph.relations")} · {formatCount(incident.length)}
        </div>
        {incident.length === 0 ? (
          <p className="text-[12px] italic text-muted-foreground">
            {t("pages.graph.noIncidentEdges")}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {incident.map((e, i) => {
              const other = e.source === selected ? e.target : e.source
              return (
                <li
                  key={`${e.source}-${e.type}-${e.target}-${i}`}
                  className="rounded-md border border-border bg-card px-2.5 py-1.5"
                >
                  <div className="flex items-baseline gap-2 text-[12.5px]">
                    <span className="font-medium text-foreground truncate">{other}</span>
                  </div>
                  <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-wide text-muted-foreground">
                    {e.type || t("pages.graph.relatedFallback")}
                  </div>
                  {e.description && (
                    <p className="mt-1 text-[11.5px] leading-[1.4] text-muted-foreground">
                      {e.description}
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
