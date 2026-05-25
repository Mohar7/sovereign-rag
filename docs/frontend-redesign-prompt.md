# sovereign-rag — Frontend redesign prompt (Claude Design)

Paste the block below into a fresh `claude.ai/design` thread. Use a new conversation — do **not** reuse the previous sovereign-rag design thread (you want a clean canvas without the terminal-aesthetic priors).

---

```
Brand-new design for sovereign-rag. Discard any prior visual direction —
this is a from-scratch redesign in a completely different idiom.

=== WHAT THE APP DOES (functionality is locked, only visuals change) ===

sovereign-rag is a self-hosted retrieval system that lets one user:
- ask questions of an indexed corpus (chat-style, with inline citations)
- ingest PDFs / URLs / web-search results into the corpus
- browse the corpus by document → chunks → entities
- inspect the retrieval pipeline (graph + dense + sparse, RRF fusion, reranking)
- manage per-thread context (pin / exclude chunks, view checkpoints)
- explore the knowledge graph (entity-relation network)
- view eval dashboards (retrieval quality over time)
- configure models, knobs, services

Backend is FastAPI + LangGraph. Frontend is single-user, no auth.

=== NEW AESTHETIC DIRECTION ===

Anti-references: NOT the Bloomberg terminal / IBM Plex Mono / dark
research-instrument look I designed previously. Drop the line-number
gutters, the hairline dotted grids, the IBM Plex Serif italics, the
12-px-everywhere density.

Reference points: Linear · Cal.com · Vercel dashboard · Plane.so ·
Resend dashboard. Clean, modern SaaS. Generous whitespace. Friendly
without being cute. Tools that feel finished.

Tone: confident, calm, approachable. The instrument is still serious
but it doesn't have to LOOK like a terminal to prove it.

=== RESPONSIVE — DESIGN FOR ALL BREAKPOINTS ===

Primary canvas: **1920 × 1080** (16:9 — the native browser viewport on
modern displays). This is where the design must shine and is the target
for every "default" artboard.

Breakpoints to design (Tailwind defaults):
- **2xl · 1920 × 1080** — primary, the hero target. Full sidebar
  expanded, sources/inspector/context panels visible side-by-side.
- **xl · 1280 × 800** — common laptop. Same 3-column shell but
  tighter padding; sidebar may be in icon-rail mode by default.
- **lg · 1024 × 768** — tablet landscape / small laptop. Right-side
  panels (sources rail, inspector) become collapsible drawers triggered
  from the topbar instead of permanent columns.
- **md · 768 × 1024** — tablet portrait. Sidebar collapses to a slide-
  out Sheet behind ☰; the conversation goes full-width; sources rail
  opens as a Sheet from the right.
- **sm · 390 × 844** — mobile (iPhone reference). Single-column
  everywhere; composer sticks to the bottom of the viewport; citation
  chips remain inline; threads / library / ingest / settings each become
  dedicated full-screen views routed via the bottom of the sidebar
  Sheet. Topbar collapses to just brand + search icon + ☰.

Behavior to specify in mocks:
- The collapsible Sidebar (shadcn `Sidebar` primitive) state — show its
  expanded, icon-rail, and Sheet-on-mobile renders.
- Tables (Library, History) — design how they reflow on mobile (cards
  with truncated row data, swipeable, OR horizontal scroll with sticky
  first column — pick one and commit).
- The right-side Sources panel — show how it transitions from permanent
  panel (2xl/xl) → collapsible (lg) → Sheet-from-right (md/sm).
- Composer — show how the chip-button popovers behave on mobile (they
  should become bottom Sheets, not floating popovers).
- Command Palette (⌘K) — on mobile, full-screen modal; on desktop,
  centered Dialog.

For every "major" screen (Ask, Library, Ingest, Threads, Settings) you
must produce artboards at AT LEAST 1920 (hero), one mid breakpoint (lg
or md), and 390 (mobile). The system sheet shows the component matrix.

=== LOCKED STACK (engineering will build this — design around it) ===

UI library: **shadcn/ui** (Radix primitives + Tailwind), "new-york"
style. Use only components that exist in shadcn — Button, Card, Sheet,
Dialog, Drawer, Popover, Tooltip, Sonner (toasts), Tabs, Switch,
Slider, Input, Select, Combobox (Command), DropdownMenu, ContextMenu,
Accordion, Avatar, Badge, Skeleton, Table, Form, ToggleGroup,
Resizable, ScrollArea, Separator, Sidebar (the new shadcn sidebar
primitive), Breadcrumb, Pagination, Alert, Progress.

Router: **TanStack Router** (file-based, type-safe, search params as
state for filters/sort). Design with deep-linkable filtered views in
mind.

Data: **TanStack Query** for server state, **TanStack Table** for the
Library / RunHistory tables, **TanStack Form** for Settings.

Charts: **Recharts** (or shadcn's chart wrapper) for the Evals
dashboard.

Typography: **Inter** for UI + **JetBrains Mono** for code / chunk IDs.
Both have first-class Cyrillic support — verify your sample text
includes Russian. Use fluid type scale that bumps up at 2xl (1920),
e.g. body 15px at lg, 16px at xl, 16-17px at 2xl.

=== i18n REQUIREMENT — design for both languages ===

Every screen must work in English AND Russian. Show each artboard with
either:
- a parallel RU variant artboard (preferred for the hero/empty screens), OR
- key UI strings labeled in both EN and RU in callouts on the artboard

Design considerations:
- Russian UI strings run ~15–25% LONGER than English — buttons, badges,
  table headers, nav items need slack. Avoid fixed-width buttons that
  fit English snugly.
- Cyrillic descenders are taller; bump line-height to 1.55 minimum on
  body copy.
- Number formatting: RU uses thin-space as the thousands separator
  (12 345 not 12,345) and "," as decimal. Show formatted numbers in
  the right locale in your mocks.
- Date format: EN `May 24, 2026` · RU `24 мая 2026`. Show both in
  thread row timestamps.
- Settings labels: every label string in the Settings panel must have
  both EN and RU shown in your mocks so engineering knows the keys to
  put in the locale file.

Locale switcher: in the user-menu dropdown (top-right). Two options:
"English" / "Русский". No flag icons — text only.

=== THEMING ===

Two themes, both must be designed:
- Light (default) — high contrast, off-white background (#fafafa or
  similar), neutral grays, single brand accent
- Dark — true dark mode (NOT the previous near-black; aim for the
  shadcn zinc-950 / slate-900 register)

Pick ONE brand accent color and use it consistently — for the hybrid
retrieval signal, replace the previous blue/lavender/orange triad with
a single accent + neutral state colors (success/warning/error).
Engineering will map the previous "graph/vector/web/HITL" semantic
distinction to icons + labels instead of colors.

=== SCREENS TO DESIGN (same set as before, new clothes) ===

For each numbered screen, deliver at minimum a 1920 hero artboard;
items marked ★ also need lg and 390-mobile variants.

1.  ★ Sidebar shell + topbar — collapsible sidebar (Ask / Library /
    Ingest / Threads / Graph / Evals / History / Settings), topbar with
    breadcrumbs · search · health indicator · user menu (theme +
    locale + about). Show expanded / icon-rail / mobile-Sheet variants.

2.  ★ Ask — the chat-style centerpiece. Conversation in center, sources
    in collapsible right panel. Composer at bottom. States in separate
    artboards:
    - empty (suggestion cards, corpus stats footer)
    - mid-stream (skeleton sources, streaming cursor)
    - HITL approval (URL checklist card inline in the conversation)
    - error (Alert-style banner)
    Citation chips: inline pills with a number, hover-popover showing
    snippet. Distinguish retrieval kind via small icon prefix, not color.

3.  Settings — sheet/sidebar/dialog (your call) with tabs: Retrieval /
    Model / Indexing / Web fallback / Services. Every knob.

4.  Retrieval inspector — full-page or large dialog with pipeline
    timeline + candidates table (use TanStack Table styling).

5.  Context manager — pinned/excluded chunks + checkpoint timeline.

6.  Source detail — drawer with chunk preview, neighbors, entities,
    graph relations.

7.  Command palette (⌘K) — shadcn Command/CommandDialog with Threads /
    Documents / Actions sections.

8.  ★ Library — document table (TanStack Table) with filter sidebar,
    sort, multi-select, bulk actions (Sonner toasts on action). Mobile
    variant: show how the table reflows.

9.  Library detail — single doc view with chunks + extracted entities.

10. ★ Ingest — three tabs (URL / file / web search) with live pipeline
    progress. Mobile variant: tabs collapse to a Select.

11. ★ Threads page — card grid with filter sidebar, multi-select,
    kebab. Mobile variant: single-column card list.

12. Graph explorer — node-link visualization with legend, controls.

13. Evals dashboard — stat cards + line/bar charts (Recharts).

14. Run history — auditable table of past queries.

15. ★ Global settings — services / models / defaults / theme / locale /
    keyboard shortcuts. Mobile variant: vertical tab navigation.

16. Design system reference sheet — color tokens, typography scale
    (fluid across breakpoints), spacing, every shadcn component used,
    in light AND dark, in EN AND RU (sample text in Cyrillic to verify
    the font holds up).

17. Empty / loading / error patterns sheet — how skeletons, empty
    states, and error states look across the app.

18. Breakpoint reference sheet — one artboard showing the same screen
    (Ask hero) rendered at 1920, 1280, 1024, 768, 390 side-by-side, so
    engineering can see the exact transition points.

=== DELIVERABLES ===

- ~25-30 artboards total
- Primary canvas size: 1920 × 1080 (16:9) for hero screens
- Dark variant of at least: Ask hero, Library, Settings, Graph explorer
- Russian variant of at least: Ask hero (empty + mid-stream), Settings
  (one tab), Library
- Mobile variant (390 × 844) of every ★ screen
- One mid-breakpoint variant (1024 or 1280) of every ★ screen
- For each interactive component: show idle / hover / focus / active /
  disabled in the system sheet
- Annotate each card with the shadcn component name(s) used (e.g.
  "Sheet + Tabs + Form + Slider"), so engineering knows what to npx-add
- Mark which Tailwind breakpoint each variant represents
  (sm/md/lg/xl/2xl) in the artboard label

One strong direction, deeply executed. No alternative palettes / layout
variants. Keep the previous app's information density goal but achieve
it through hierarchy and whitespace, not hairlines and 12px text.
```

---

## Notes for the engineering migration (after Claude Design ships)

When the bundle lands, the plan will be:

1. **Scaffold a new Vite project** alongside the existing one (don't delete the old frontend yet — keep it as a reference while porting). Stack: `pnpm create vite@latest` + Tailwind + shadcn `npx shadcn@latest init` + TanStack Router/Query/Table + `i18next` + `react-i18next`.
2. **Pin the component set**: run `npx shadcn@latest add <component>` for exactly the components listed in the prompt; commit `components.json` so adds are reproducible.
3. **Locales**: `src/locales/en.json` and `src/locales/ru.json`, structured by screen. Pull the EN/RU strings directly from the design's labeled mocks.
4. **Keep the existing `/api/*` contract**: copy `src/lib/api.ts` from the old frontend mostly verbatim, then thread it through TanStack Query hooks.
5. **Port screen-by-screen** in this order (matches existing test coverage): Ask → Library → Ingest → Threads → Settings → Inspector → Context → Source → Palette → Graph → Evals → History → GlobalSettings.
6. **Migration switch**: keep both frontends behind separate Vite dev ports until parity is reached, then point launchd's `dev.sovereign-rag.frontend` plist at the new build dir.
