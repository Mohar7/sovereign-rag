import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Two upstreams in dev:
//   /lg/*   →  langgraph dev on :2024  (QA graph via SDK)
//   /api/*  →  FastAPI on :8000        (corpus stats, health, settings, …)
//
// In prod the nginx config does the same shape so the SPA never cares
// where its backends physically live.
const LANGGRAPH_URL = process.env.LANGGRAPH_URL || "http://127.0.0.1:2024";
const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000";

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
      "/api": {
        target: FASTAPI_URL,
        changeOrigin: true,
      },
    },
  },
});
