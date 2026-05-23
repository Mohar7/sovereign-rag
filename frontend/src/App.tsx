import { Artboards } from "./Artboards";
import { AskScreen } from "./AskScreen";

export default function App() {
  // Tiny routing — the only secondary route is /artboards (or ?artboards=1)
  // which renders all five mock states for screenshots / portfolio.
  const isArtboards =
    window.location.pathname.startsWith("/artboards") ||
    new URLSearchParams(window.location.search).has("artboards");
  if (isArtboards) return <Artboards />;
  return <AskScreen />;
}
