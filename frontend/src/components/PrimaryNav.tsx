// 48px vertical nav rail that anchors every top-level screen.
//
// Routes are hash-based — `/library`, `/ingest`, `/threads`, etc. — because we
// avoid pulling react-router for a 9-route app. The rail itself just sets the
// hash; the App router renders whichever screen matches.
//
// The `hitl` prop drives the warm-orange dot on items that have human-in-the-
// loop work pending (today: any thread paused at an `interrupt(...)`). The
// caller (AskScreen / each top-level screen) computes this from useThreads.

import type { ReactNode } from "react";

export type NavSection =
  | "ask"
  | "library"
  | "ingest"
  | "threads"
  | "graph"
  | "evals"
  | "history"
  | "settings";

interface NavItem {
  id: NavSection;
  k: string;
  title: string;
  hash: string;
  svg: ReactNode;
}

const NAV_ITEMS: NavItem[] = [
  {
    id: "ask",
    k: "1",
    title: "Ask",
    hash: "",
    svg: <path d="M4 6h16M4 12h12M4 18h8" />,
  },
  {
    id: "library",
    k: "2",
    title: "Library",
    hash: "#library",
    svg: <path d="M4 4h6v16H4zM14 4h6v16h-6z" />,
  },
  {
    id: "ingest",
    k: "3",
    title: "Ingest",
    hash: "#ingest",
    svg: <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />,
  },
  {
    id: "threads",
    k: "4",
    title: "Threads",
    hash: "#threads",
    svg: (
      <>
        <circle cx="6" cy="7" r="2" />
        <circle cx="6" cy="17" r="2" />
        <circle cx="18" cy="12" r="2" />
        <path d="M8 7h10M8 17h10M6 9v6" />
      </>
    ),
  },
  {
    id: "graph",
    k: "5",
    title: "Graph",
    hash: "#graph",
    svg: (
      <>
        <circle cx="6" cy="6" r="2" />
        <circle cx="18" cy="6" r="2" />
        <circle cx="12" cy="18" r="2" />
        <circle cx="12" cy="12" r="2" />
        <path d="M7 7l4 4M17 7l-4 4M12 14v3M10 19l-3-2M14 19l3-2" />
      </>
    ),
  },
  {
    id: "evals",
    k: "6",
    title: "Evals",
    hash: "#evals",
    svg: <path d="M4 18V6M4 18h16M8 14V8M12 14v-4M16 14v-7" />,
  },
  {
    id: "history",
    k: "7",
    title: "History",
    hash: "#history",
    svg: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  },
  {
    id: "settings",
    k: ",",
    title: "Settings",
    hash: "#settings",
    svg: (
      <>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1" />
      </>
    ),
  },
];

interface Props {
  active?: NavSection;
  /** Sections that should show the warm HITL dot (e.g. ["threads"]). */
  hitl?: NavSection[];
  /** Top-bar health → drives the small dot at the bottom of the rail. */
  servicesState?: "ok" | "warn" | "err";
}

function go(hash: string) {
  // Setting `pathname` to "/" keeps the hash router clean across SPA navigation.
  if (window.location.hash === hash) return;
  window.location.hash = hash;
}

function NavBtn({ item, active, hitl }: { item: NavItem; active: boolean; hitl: boolean }) {
  return (
    <button
      type="button"
      className={`pn-item ${active ? "active" : ""}`}
      title={`${item.title} · ⌘${item.k}`}
      onClick={() => go(item.hash)}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        {item.svg}
      </svg>
      {hitl && <span className="badge-dot" />}
    </button>
  );
}

export function PrimaryNav({ active = "ask", hitl = [], servicesState = "ok" }: Props) {
  return (
    <nav className="primary-nav">
      <span className="pn-mark" title="sovereign-rag" />
      {NAV_ITEMS.slice(0, 4).map((it) => (
        <NavBtn key={it.id} item={it} active={active === it.id} hitl={hitl.includes(it.id)} />
      ))}
      <span className="pn-divider" />
      {NAV_ITEMS.slice(4, 7).map((it) => (
        <NavBtn key={it.id} item={it} active={active === it.id} hitl={hitl.includes(it.id)} />
      ))}
      <span className="pn-spacer" />
      <NavBtn item={NAV_ITEMS[7]!} active={active === "settings"} hitl={false} />
      <span className="pn-status" title={`services ${servicesState}`}>
        <span className={`dot ${servicesState !== "ok" ? servicesState : ""}`} />
      </span>
    </nav>
  );
}
