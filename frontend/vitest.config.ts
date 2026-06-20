import path from "node:path"

import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

// Standalone test config so the app's vite.config (dev proxy/server) stays
// focused on serving. jsdom + globals give React component tests an auto-cleaned
// DOM; the "@" alias mirrors vite.config so imports resolve identically.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
  },
})
