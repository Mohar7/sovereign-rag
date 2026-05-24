// AppShell — the chrome that wraps every non-Ask top-level screen.
//
//   48px nav rail │ 38px top bar
//                 │ filter rail (optional) + main (+ right column when "wide")
//
// CSS hooks (see styles/ask.css):
//   .app                — grid columns: 48 232 1fr
//   .app.with-right     — adds a 372px right column
//   .app.wide-rail      — bumps the filter rail to 280px
//
// The wrapper accepts a `dataLabel` for design-QA tooling and a `topBar`
// slot so callers can inject their own .topbar without losing the grid.

import type { ReactNode } from "react";
import { PrimaryNav, type NavSection } from "./PrimaryNav";

interface Props {
  active: NavSection;
  /** Single string label used by the design-QA canvas tooling. */
  dataLabel?: string;
  /** Show the HITL badge on these nav items. */
  hitl?: NavSection[];
  servicesState?: "ok" | "warn" | "err";
  /** Variant of the grid layout. Default is two-column + main. */
  variant?: "default" | "with-right" | "wide-rail";
  /** Rendered into grid-column 2-from-end (the AppTopBar). */
  topBar: ReactNode;
  /** Optional 232px filter / secondary rail in grid-column 2. */
  rail?: ReactNode;
  /** Main content area in grid-column 3. */
  children: ReactNode;
  /** Optional 372px right column when `variant="with-right"`. */
  right?: ReactNode;
}

export function AppShell({
  active,
  dataLabel,
  hitl,
  servicesState,
  variant = "default",
  topBar,
  rail,
  children,
  right,
}: Props) {
  const cls = `app${variant === "with-right" ? " with-right" : ""}${variant === "wide-rail" ? " wide-rail" : ""}`;
  return (
    <div className={cls} data-screen-label={dataLabel}>
      <PrimaryNav active={active} hitl={hitl} servicesState={servicesState} />
      {topBar}
      {rail ?? <div />}
      <main className="app-main">{children}</main>
      {right}
    </div>
  );
}
