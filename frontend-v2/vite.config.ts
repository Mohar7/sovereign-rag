import path from "node:path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const DEFAULT_BACKEND = "http://100.81.83.18:8000"

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "")
  const backend = env.VITE_API_BASE || DEFAULT_BACKEND
  const proxy = (target: string) => ({ target, changeOrigin: true })
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
    },
    server: {
      port: 5173,
      // Specific paths only — `/ingest` and `/threads` (etc.) are also
      // *frontend* routes, so we mustn't blanket-proxy them. Each entry
      // below is an exact backend endpoint.
      proxy: {
        "/api": proxy(backend),
        "/ask": proxy(backend),
        "/ask/stream": proxy(backend),
        "/health": proxy(backend),
        "/admin/wipe": proxy(backend),
        "/ingest/search": proxy(backend),
        "/documents/text": proxy(backend),
        "/documents/file": proxy(backend),
        "/documents/url": proxy(backend),
      },
    },
  }
})
