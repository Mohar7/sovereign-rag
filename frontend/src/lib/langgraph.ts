// LangGraph SDK client setup.
//
// In dev, Vite proxies /lg/* to the langgraph-dev server on :2024, so the
// browser sees a same-origin server and no CORS dance.  In prod, set
// VITE_LANGGRAPH_URL at build time to the deployed LangGraph endpoint.

import { Client } from "@langchain/langgraph-sdk";

// The SDK's `prepareFetchOptions` calls `new URL(...)` directly, so it
// needs an absolute URL — a bare path like "/lg" throws
// "TypeError: Invalid URL". When no explicit upstream is set, anchor
// the path on the current page's origin so it works for both
// `vite dev --host 0.0.0.0` (where origin = the Tailscale IP we opened
// the page from) and an nginx prod build (where it's the same host).
const RAW_URL = import.meta.env.VITE_LANGGRAPH_URL?.trim();
const API_URL =
  RAW_URL && RAW_URL.length > 0
    ? RAW_URL
    : typeof window !== "undefined"
      ? `${window.location.origin}/lg`
      : "http://localhost:5173/lg";

export const ASSISTANT_ID =
  import.meta.env.VITE_LANGGRAPH_ASSISTANT?.trim() || "sovereign_qa";

export const client = new Client({
  apiUrl: API_URL,
  // langgraph-sdk passes this header on every request; safe to leave empty
  // when talking to a local `langgraph dev` server.
  apiKey: import.meta.env.VITE_LANGGRAPH_API_KEY?.trim() || undefined,
});
