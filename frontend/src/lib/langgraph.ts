// LangGraph SDK client setup.
//
// In dev, Vite proxies /lg/* to the langgraph-dev server on :2024, so the
// browser sees a same-origin server and no CORS dance.  In prod, set
// VITE_LANGGRAPH_URL at build time to the deployed LangGraph endpoint.

import { Client } from "@langchain/langgraph-sdk";

const RAW_URL = import.meta.env.VITE_LANGGRAPH_URL?.trim();
const API_URL = RAW_URL && RAW_URL.length > 0 ? RAW_URL : "/lg";

export const ASSISTANT_ID =
  import.meta.env.VITE_LANGGRAPH_ASSISTANT?.trim() || "sovereign_qa";

export const client = new Client({
  apiUrl: API_URL,
  // langgraph-sdk passes this header on every request; safe to leave empty
  // when talking to a local `langgraph dev` server.
  apiKey: import.meta.env.VITE_LANGGRAPH_API_KEY?.trim() || undefined,
});
