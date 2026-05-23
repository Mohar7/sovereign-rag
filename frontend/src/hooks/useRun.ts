// Streaming runner for the QA graph.
//
// Wraps `client.runs.stream(thread_id, "sovereign_qa", …)` and surfaces the
// pieces the UI cares about: streaming text, citations as they land,
// pipeline-step transitions, the HITL interrupt payload, fatal errors.
//
// LangGraph streams several "events" per turn:
//   - "updates"   — node-level deltas, one per node completion.
//   - "values"    — the full state after each step (heavy; we use it to
//                   read final state).
//   - "messages-tuple" / "messages" — streamed LLM tokens.
//   - "interrupt" — the run paused (one of our `interrupt(...)` calls).
//
// We subscribe with mode=["values", "updates", "messages-tuple"] which is
// what `langgraph dev` / Studio uses internally.

import { useCallback, useEffect, useRef, useState } from "react";
import { client, ASSISTANT_ID } from "../lib/langgraph";
import type {
  AskInterrupt,
  CandidateURL,
  Citation,
  CitationKind,
  InspectorChunk,
  InspectorData,
  NodeTiming,
  PipelineStatus,
  Turn,
} from "../lib/types";

type Cmd =
  | { kind: "start"; question: string; threadId: string }
  | { kind: "resume"; threadId: string; approvedUrls: string[] };

interface UseRunState {
  /** Turns belonging to the active thread. */
  turns: Turn[];
  /** `streaming` while the SSE is open, `idle` otherwise. */
  state: "idle" | "streaming" | "error";
  pipeline: PipelineStatus[];
  error: string | null;
  /** Live snapshot for the Retrieval Inspector overlay. Null until the
   * first run starts; reset on each new run. */
  inspector: InspectorData | null;
  /** Cancel any in-flight stream. */
  stop: () => void;
}

const EMPTY_INSPECTOR: InspectorData = {
  question: null,
  run_id: null,
  total_ms: null,
  node_timings: [],
  reranked: [],
  retrieved: 0,
  used: 0,
  fallback_used: false,
};

/** Translate a chunk-shaped item from the graph state into an InspectorChunk.
 * The reranked list looks like `[{chunk: {chunk_id, doc_id, metadata: {title,
 * source_uri}}, score, source}, ...]`; missing fields fall back to safe blanks
 * so the inspector renders even on partial state. */
function toInspectorChunk(
  rank: number,
  raw: NonNullable<RawState["reranked"]>[number],
  rerankTopK: number,
): InspectorChunk {
  const chunk = raw.chunk ?? {};
  const meta = chunk.metadata ?? {};
  const uri = meta.source_uri ?? "";
  const kind: CitationKind = uri.startsWith("http") ? "web" : "vector";
  return {
    rank,
    doc_id: chunk.doc_id ?? "",
    chunk_id: chunk.chunk_id ?? "",
    title: meta.title ?? "(untitled)",
    source_uri: uri,
    score: typeof raw.score === "number" ? raw.score : 0,
    kind,
    used: rank <= rerankTopK,
  };
}

interface RawState {
  question?: string;
  reranked?: Array<{
    chunk?: {
      chunk_id?: string;
      doc_id?: string;
      raw_text?: string;
      page?: number | null;
      metadata?: { title?: string; source_uri?: string };
    };
    score?: number;
    source?: string;
  }>;
  candidates?: unknown[];
  citations?: Citation[];
  answer?: string;
  used?: number;
  retrieved?: number;
  fallback_used?: boolean;
}

const PIPELINE_ORDER = [
  "embed query",
  "milvus",
  "neo4j",
  "dedupe",
  "rerank",
  "generate",
] as const;

const ALL_PENDING: PipelineStatus[] = PIPELINE_ORDER.map((step) => ({
  step,
  state: "pending",
}));

function markUntil(steps: PipelineStatus[], live: (typeof PIPELINE_ORDER)[number]): PipelineStatus[] {
  let seenLive = false;
  return steps.map((s) => {
    if (s.step === live) {
      seenLive = true;
      return { ...s, state: "live" };
    }
    if (!seenLive) return { ...s, state: "done" };
    return { ...s, state: "pending" };
  });
}

function markAllDone(steps: PipelineStatus[]): PipelineStatus[] {
  return steps.map((s) => ({ ...s, state: "done" }));
}

/** Translate a Citation's source into a chip kind. */
function citationsWithKinds(cs: Citation[]): Citation[] {
  return cs.map((c) => {
    const isWeb = c.source_uri.startsWith("http://") || c.source_uri.startsWith("https://");
    return { ...c, kind: c.kind ?? (isWeb ? "hybrid" : "hybrid") };
  });
}

/** Pull candidate URLs out of an interrupt event regardless of shape. */
function parseInterrupt(payload: unknown): AskInterrupt | null {
  if (!payload || typeof payload !== "object") return null;
  const wrapper = payload as { value?: unknown };
  const value = wrapper.value !== undefined ? wrapper.value : payload;
  if (!value || typeof value !== "object") return null;
  const v = value as { reason?: unknown; candidate_urls?: unknown };
  if (v.reason !== "approve_urls") return null;
  const rawUrls = Array.isArray(v.candidate_urls) ? v.candidate_urls : [];
  const urls: CandidateURL[] = [];
  for (const item of rawUrls) {
    if (item && typeof item === "object") {
      const i = item as { url?: unknown; title?: unknown; snippet?: unknown };
      if (typeof i.url === "string" && i.url.length > 0) {
        urls.push({
          url: i.url,
          title: typeof i.title === "string" ? i.title : "",
          snippet: typeof i.snippet === "string" ? i.snippet : "",
        });
      }
    }
  }
  return { reason: "approve_urls", candidate_urls: urls };
}

/** Convert a token-chunk from the LangGraph "messages-tuple" event into
 *  the accumulated assistant text. The exact shape depends on the SDK
 *  version, so we accept a loose union. */
function extractTokenText(event: unknown): string {
  if (!event) return "";
  // Newer SDK: ["messages-tuple", [message, metadata]] — message has .content
  if (Array.isArray(event) && event.length === 2) {
    const [maybeMsg] = event;
    if (maybeMsg && typeof maybeMsg === "object") {
      const m = maybeMsg as { content?: unknown };
      if (typeof m.content === "string") return m.content;
      if (Array.isArray(m.content)) {
        return m.content
          .map((c) =>
            c && typeof c === "object" && "text" in c
              ? String((c as { text: unknown }).text ?? "")
              : ""
          )
          .join("");
      }
    }
  }
  return "";
}

export function useRun(initialTurns: Turn[]): UseRunState & {
  start: (question: string, threadId: string) => Promise<void>;
  resume: (threadId: string, approvedUrls: string[]) => Promise<void>;
  /** Replace the conversation when the active thread changes. */
  setTurns: (turns: Turn[]) => void;
} {
  const [turns, setTurns] = useState<Turn[]>(initialTurns);
  const [state, setState] = useState<"idle" | "streaming" | "error">("idle");
  const [pipeline, setPipeline] = useState<PipelineStatus[]>(ALL_PENDING);
  const [error, setError] = useState<string | null>(null);
  const [inspector, setInspector] = useState<InspectorData | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => () => abortRef.current?.abort(), []);

  const stop = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
  }, []);

  const run = useCallback(async (cmd: Cmd) => {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setError(null);
    setState("streaming");

    const assistantTurnId = `a-${Date.now()}`;
    const startedAt = new Date().toISOString();
    let firstTokenAt: number | null = null;

    if (cmd.kind === "start") {
      const userTurn: Turn = {
        id: `u-${Date.now()}`,
        role: "user",
        timestamp: startedAt,
        content: cmd.question,
      };
      const assistantTurn: Turn = {
        id: assistantTurnId,
        role: "assistant",
        timestamp: startedAt,
        content: "",
        status: "streaming",
      };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
    } else {
      // On resume, append a fresh assistant turn (the old one stays
      // interrupted in history).
      setTurns((prev) => [
        ...prev,
        {
          id: assistantTurnId,
          role: "assistant",
          timestamp: startedAt,
          content: "",
          status: "streaming",
        },
      ]);
    }

    setPipeline(markUntil(ALL_PENDING, "embed query"));

    // Reset inspector state for the new run. We seed an open "retrieve_local"
    // node timing because that's effectively running from t=0; the `updates`
    // event for the node closes it on completion.
    const inspectorQuestion = cmd.kind === "start" ? cmd.question : null;
    const t0 = Date.now();
    const nodeTimings: NodeTiming[] = [
      { node: "retrieve_local", started_at_ms: t0, ended_at_ms: null },
    ];
    setInspector({
      ...EMPTY_INSPECTOR,
      question: inspectorQuestion,
      node_timings: nodeTimings,
    });
    const closeNode = (node: string) => {
      const idx = nodeTimings.findIndex(
        (t) => t.node === node && t.ended_at_ms == null,
      );
      if (idx >= 0) {
        const t = nodeTimings[idx]!;
        nodeTimings[idx] = { ...t, ended_at_ms: Date.now() };
      }
    };
    const openNode = (node: string) => {
      nodeTimings.push({ node, started_at_ms: Date.now(), ended_at_ms: null });
    };

    try {
      const streamArgs =
        cmd.kind === "start"
          ? { input: { question: cmd.question } }
          : { command: { resume: { approved_urls: cmd.approvedUrls } } };

      const stream = client.runs.stream(cmd.threadId, ASSISTANT_ID, {
        ...streamArgs,
        streamMode: ["values", "updates", "messages-tuple"],
        signal: ac.signal,
      });

      let accumulated = "";
      // The SDK doesn't expose run_id on the event envelope; fall back to the
      // thread id so the inspector header has something to display.
      let runId: string | null = cmd.threadId;
      let lastRerankK = 5;

      for await (const ev of stream) {
        if (ac.signal.aborted) break;
        const event = ev as {
          event?: string;
          data?: unknown;
          run_id?: string;
          metadata?: { run_id?: string };
        };
        // Some event shapes carry a real run_id in metadata — prefer it.
        const fromEvent = event.run_id ?? event.metadata?.run_id;
        if (fromEvent) runId = fromEvent;

        if (event.event === "messages-tuple" || event.event === "messages") {
          const tokenText = extractTokenText(event.data);
          if (tokenText) {
            if (firstTokenAt == null) firstTokenAt = Date.now();
            accumulated += tokenText;
            const finalText = accumulated;
            setTurns((prev) =>
              prev.map((t) => (t.id === assistantTurnId ? { ...t, content: finalText } : t))
            );
          }
          continue;
        }

        if (event.event === "updates" && event.data && typeof event.data === "object") {
          // event.data is { node_name: partial_state, ... }. LangGraph emits
          // one update per node *completion*; we model timings by opening
          // the next node as soon as the previous one closes, so each node's
          // duration covers the full gap between updates (which is the time
          // the LangGraph runtime actually spent inside that node).
          const updates = event.data as Record<string, unknown>;
          if ("retrieve_local" in updates) {
            closeNode("retrieve_local");
            openNode("rerank");
            setPipeline(markUntil(ALL_PENDING, "dedupe"));
          }
          if ("web_fallback" in updates) {
            closeNode("web_fallback");
            // Web fallback re-runs retrieve_local; track that second retrieval
            // pass separately so its duration shows in the inspector.
            openNode("retrieve_local_2");
            setPipeline(markUntil(ALL_PENDING, "dedupe"));
          }
          if ("rerank" in updates) {
            closeNode("retrieve_local_2"); // no-op if web_fallback didn't fire
            closeNode("rerank");
            openNode("generate");
            setPipeline(markUntil(ALL_PENDING, "rerank"));
          }
          if ("generate" in updates) {
            closeNode("generate");
            setPipeline(markUntil(ALL_PENDING, "generate"));
          }
          // Flush the rolling timings snapshot so the inspector sees the
          // newly-closed nodes as the run progresses.
          setInspector((prev) => ({
            ...(prev ?? EMPTY_INSPECTOR),
            question: inspectorQuestion,
            node_timings: [...nodeTimings],
            run_id: runId,
          }));
          continue;
        }

        if (event.event === "values" && event.data && typeof event.data === "object") {
          const s = event.data as RawState;
          // Mid-stream we may see partial state; just refresh citations and
          // counts so the right rail can render skeletons.
          const cits = Array.isArray(s.citations)
            ? citationsWithKinds(s.citations)
            : undefined;
          setTurns((prev) =>
            prev.map((t) => {
              if (t.id !== assistantTurnId) return t;
              return {
                ...t,
                content: typeof s.answer === "string" && s.answer.length > 0 ? s.answer : t.content,
                citations: cits ?? t.citations,
                retrieved: typeof s.retrieved === "number" ? s.retrieved : t.retrieved,
                used: typeof s.used === "number" ? s.used : t.used,
                fallback_used: typeof s.fallback_used === "boolean" ? s.fallback_used : t.fallback_used,
              };
            })
          );

          // Mirror the chunks into the inspector. The graph populates
          // ``reranked`` only after the rerank node; before that, the array is
          // empty and we leave the inspector's reranked list alone.
          if (Array.isArray(s.reranked) && s.reranked.length > 0) {
            lastRerankK = typeof s.used === "number" ? s.used : lastRerankK;
            const reranked = s.reranked.map((r, i) =>
              toInspectorChunk(i + 1, r, lastRerankK),
            );
            setInspector((prev) => ({
              ...(prev ?? EMPTY_INSPECTOR),
              question: inspectorQuestion,
              run_id: runId,
              node_timings: [...nodeTimings],
              reranked,
              retrieved: typeof s.retrieved === "number" ? s.retrieved : reranked.length,
              used: typeof s.used === "number" ? s.used : lastRerankK,
              fallback_used: !!s.fallback_used,
            }));
          }
          continue;
        }

        if (event.event === "interrupt" || event.event === "__interrupt__") {
          const intr = parseInterrupt(event.data);
          if (intr) {
            setTurns((prev) =>
              prev.map((t) =>
                t.id === assistantTurnId
                  ? { ...t, status: "interrupted", interrupt: intr }
                  : t
              )
            );
          }
          setPipeline(markUntil(ALL_PENDING, "dedupe"));
          setState("idle");
          return;
        }

        if (event.event === "error") {
          throw new Error(String((event.data as { message?: unknown })?.message ?? "stream error"));
        }
      }

      const endedAt = Date.now();
      const ttf = firstTokenAt != null ? firstTokenAt - new Date(startedAt).getTime() : undefined;
      const total = endedAt - new Date(startedAt).getTime();
      setTurns((prev) =>
        prev.map((t) =>
          t.id === assistantTurnId
            ? { ...t, status: "done", ttf_ms: ttf, total_ms: total }
            : t
        )
      );
      setPipeline(markAllDone(ALL_PENDING));
      // Close any still-open nodes (generate is usually still open here
      // because there's no follow-on update event after the last token).
      for (let i = 0; i < nodeTimings.length; i++) {
        const t = nodeTimings[i]!;
        if (t.ended_at_ms == null) {
          nodeTimings[i] = { ...t, ended_at_ms: endedAt };
        }
      }
      setInspector((prev) => ({
        ...(prev ?? EMPTY_INSPECTOR),
        question: inspectorQuestion,
        run_id: runId,
        node_timings: [...nodeTimings],
        total_ms: total,
      }));
      setState("idle");
    } catch (err) {
      if (ac.signal.aborted) {
        setState("idle");
        return;
      }
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setTurns((prev) =>
        prev.map((t) => (t.id === assistantTurnId ? { ...t, status: "error", error: msg } : t))
      );
      setState("error");
    }
  }, []);

  const start = useCallback(
    async (question: string, threadId: string) => {
      await run({ kind: "start", question, threadId });
    },
    [run]
  );

  const resume = useCallback(
    async (threadId: string, approvedUrls: string[]) => {
      await run({ kind: "resume", threadId, approvedUrls });
    },
    [run]
  );

  return { turns, setTurns, state, pipeline, error, inspector, stop, start, resume };
}
