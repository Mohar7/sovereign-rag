import { Artboards } from "./Artboards";
import { AskScreen } from "./AskScreen";
import { ComponentsSheet } from "./ComponentsSheet";
import { EvalsDashboard } from "./screens/Evals";
import { GlobalSettings } from "./screens/GlobalSettings";
import { GraphExplorer } from "./screens/GraphExplorer";
import { Ingest } from "./screens/Ingest";
import { Library } from "./screens/Library";
import { LibraryDetail } from "./screens/LibraryDetail";
import { RunHistory } from "./screens/RunHistory";
import { ThreadsPage } from "./screens/ThreadsPage";
import { useHashRoute } from "./lib/route";

// Routes:
//   /                — live Ask screen (LangGraph SDK + streaming).
//   /artboards       — design QA: five Ask-screen states side by side.
//   /components      — atomic-controls showcase (design system).
//   #library         — corpus document browser.
//   #library/{id}    — single-document detail.
//   #ingest          — full-page ingest job runner.
//   #threads         — card grid of every conversation.
//   #graph           — Neo4j knowledge graph explorer.
//   #evals           — retrieval quality dashboard.
//   #history         — audit log of every Q&A.
//   #settings        — global Settings (Services / Models / Defaults / …).
//
// Hash routing keeps the SPA backend-free and survives a hard reload.

export default function App() {
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const hash = useHashRoute();

  if (path.startsWith("/components") || params.has("components")) {
    return <ComponentsSheet />;
  }
  if (path.startsWith("/artboards") || params.has("artboards")) {
    return <Artboards />;
  }

  // Hash-based subpages of the Ask app.
  if (hash === "library") return <Library />;
  if (hash.startsWith("library/")) {
    const docId = hash.slice("library/".length);
    return <LibraryDetail docId={docId} />;
  }
  if (hash === "ingest") return <Ingest />;
  if (hash === "threads") return <ThreadsPage />;
  if (hash === "graph") return <GraphExplorer />;
  if (hash === "evals") return <EvalsDashboard />;
  if (hash === "history") return <RunHistory />;
  if (hash === "settings") return <GlobalSettings />;

  return <AskScreen />;
}
