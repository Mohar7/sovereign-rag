import { Artboards } from "./Artboards";
import { AskScreen } from "./AskScreen";
import { ComponentsSheet } from "./ComponentsSheet";

export default function App() {
  // Tiny routing — three top-level screens:
  //   /                — live Ask screen (LangGraph SDK + streaming).
  //   /artboards       — five mock states side by side (portfolio QA).
  //   /components      — atomic-controls showcase (design system).
  // Routes don't need a router lib — three branches are easier to read.
  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  if (path.startsWith("/components") || params.has("components")) {
    return <ComponentsSheet />;
  }
  if (path.startsWith("/artboards") || params.has("artboards")) {
    return <Artboards />;
  }
  return <AskScreen />;
}
