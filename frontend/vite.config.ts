import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In dev we run `langgraph dev` (the LangGraph server) on :2024 and proxy
// every LangGraph endpoint through Vite so the browser doesn't see CORS.
// In prod (or self-host), point VITE_LANGGRAPH_URL at the deployed server
// instead — `lib/langgraph.ts` reads the env at module init.
const LANGGRAPH_URL = process.env.LANGGRAPH_URL || "http://127.0.0.1:2024";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/lg": {
        target: LANGGRAPH_URL,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/lg/, ""),
      },
    },
  },
});
