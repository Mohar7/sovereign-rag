import { useCallback, useEffect, useRef, useState } from "react"

import type { AskRequest, CandidateUrl, CitationModel, GradeLabel } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// Event schema — must mirror api/ask/router.py:_stream_generator
// ─────────────────────────────────────────────────────────────────

/**
 * Per-stage timings reported by the backend. Each key is one of the graph's
 * node names; values are elapsed milliseconds. `total` is wall-clock from
 * the start of stream generation to the final done event.
 *
 * Keys are optional because a request that fails mid-stream may not have
 * reached every node.
 */
export interface StageTimings {
  retrieve_local?: number
  rerank?: number
  grade?: number
  transform_query?: number
  web_search?: number
  crawl_index?: number
  generate?: number
  total?: number
}

export type StreamEvent =
  | { type: "open"; thread_id: string }
  | { type: "node"; name: string; phase: "start" | "done"; elapsed_ms?: number }
  | { type: "token"; delta: string }
  | { type: "citations"; items: CitationModel[] }
  | {
      type: "done"
      thread_id: string
      answer: string | null
      citations: CitationModel[]
      retrieved: number
      used: number
      timings?: StageTimings
      fallback_used?: boolean
      grade?: GradeLabel | null
    }
  | { type: "error"; message: string }
  | { type: "grade"; label: GradeLabel; confidence: number; reason: string }
  | {
      type: "interrupt"
      thread_id: string
      reason: "approve_urls"
      candidate_urls: CandidateUrl[]
    }
  | { type: "crawl_progress"; url: string; status: "crawling" | "indexed" | "failed"; chunks?: number }

export interface UseAskStreamOptions {
  onOpen?: (threadId: string) => void
  onNode?: (name: string, phase: "start" | "done", elapsedMs?: number) => void
  onToken?: (delta: string) => void
  onCitations?: (items: CitationModel[]) => void
  onDone?: (final: Extract<StreamEvent, { type: "done" }>) => void
  onError?: (message: string) => void
  onGrade?: (label: GradeLabel, confidence: number, reason: string) => void
  onInterrupt?: (payload: Extract<StreamEvent, { type: "interrupt" }>) => void
  onCrawlProgress?: (ev: Extract<StreamEvent, { type: "crawl_progress" }>) => void
}

interface UseAskStreamReturn {
  submit: (req: AskRequest) => void
  submitResume: (body: { thread_id: string; approved_urls: string[] }) => void
  cancel: () => void
  isStreaming: boolean
}

/**
 * Open a streaming POST /ask/stream and dispatch parsed SSE events through
 * the option callbacks. The hook owns one in-flight stream at a time —
 * submitting again cancels any prior stream.
 */
export function useAskStream(options: UseAskStreamOptions = {}): UseAskStreamReturn {
  const optsRef = useRef(options)
  optsRef.current = options

  const abortRef = useRef<AbortController | null>(null)
  const [isStreaming, setIsStreaming] = useState(false)

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
  }, [])

  useEffect(() => cancel, [cancel])

  /** Shared stream-reading loop used by both submit and submitResume. */
  const runStream = useCallback(
    (url: string, body: unknown, ac: AbortController) => {
      void (async () => {
        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(body),
            signal: ac.signal,
          })
          if (!r.ok) {
            const text = await r.text().catch(() => r.statusText)
            throw new Error(`${r.status} ${text || r.statusText}`)
          }
          if (!r.body) throw new Error("No response body")

          const reader = r.body.getReader()
          const decoder = new TextDecoder()
          let buffer = ""

          while (true) {
            const { value, done } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const blocks = buffer.split("\n\n")
            buffer = blocks.pop() ?? ""
            for (const block of blocks) {
              const line = block.split("\n").find((l) => l.startsWith("data: "))
              if (!line) continue
              const json = line.slice(6).trim()
              if (!json) continue
              let event: StreamEvent
              try {
                event = JSON.parse(json) as StreamEvent
              } catch {
                continue
              }
              dispatch(event, optsRef.current)
            }
          }
        } catch (err) {
          if ((err as Error).name === "AbortError") return
          const msg = err instanceof Error ? err.message : String(err)
          optsRef.current.onError?.(msg)
        } finally {
          setIsStreaming(false)
          abortRef.current = null
        }
      })()
    },
    [],
  )

  const submit = useCallback(
    (req: AskRequest) => {
      cancel()
      const ac = new AbortController()
      abortRef.current = ac
      setIsStreaming(true)
      runStream("/ask/stream", req, ac)
    },
    [cancel, runStream],
  )

  const submitResume = useCallback(
    (body: { thread_id: string; approved_urls: string[] }) => {
      cancel()
      const ac = new AbortController()
      abortRef.current = ac
      setIsStreaming(true)
      runStream("/ask/resume/stream", body, ac)
    },
    [cancel, runStream],
  )

  return { submit, submitResume, cancel, isStreaming }
}

function dispatch(event: StreamEvent, opts: UseAskStreamOptions) {
  switch (event.type) {
    case "open":
      opts.onOpen?.(event.thread_id)
      return
    case "node":
      opts.onNode?.(event.name, event.phase, event.elapsed_ms)
      return
    case "token":
      opts.onToken?.(event.delta)
      return
    case "citations":
      opts.onCitations?.(event.items)
      return
    case "done":
      opts.onDone?.(event)
      return
    case "error":
      opts.onError?.(event.message)
      return
    case "grade":
      opts.onGrade?.(event.label, event.confidence, event.reason)
      return
    case "interrupt":
      opts.onInterrupt?.(event)
      return
    case "crawl_progress":
      opts.onCrawlProgress?.(event)
      return
  }
}
