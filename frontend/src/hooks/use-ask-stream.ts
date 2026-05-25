import { useCallback, useEffect, useRef, useState } from "react"

import type { AskRequest, CitationModel } from "@/lib/api"

// ─────────────────────────────────────────────────────────────────
// Event schema — must mirror api/ask/router.py:_stream_generator
// ─────────────────────────────────────────────────────────────────

export type StreamEvent =
  | { type: "open"; thread_id: string }
  | { type: "node"; name: string; phase: "start" | "done" }
  | { type: "token"; delta: string }
  | { type: "citations"; items: CitationModel[] }
  | {
      type: "done"
      thread_id: string
      answer: string | null
      citations: CitationModel[]
      retrieved: number
      used: number
    }
  | { type: "error"; message: string }

export interface UseAskStreamOptions {
  onOpen?: (threadId: string) => void
  onNode?: (name: string, phase: "start" | "done") => void
  onToken?: (delta: string) => void
  onCitations?: (items: CitationModel[]) => void
  onDone?: (final: Extract<StreamEvent, { type: "done" }>) => void
  onError?: (message: string) => void
}

interface UseAskStreamReturn {
  submit: (req: AskRequest) => void
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

  const submit = useCallback(
    (req: AskRequest) => {
      cancel()
      const ac = new AbortController()
      abortRef.current = ac
      setIsStreaming(true)

      void (async () => {
        try {
          const r = await fetch("/ask/stream", {
            method: "POST",
            headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
            body: JSON.stringify(req),
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
    [cancel],
  )

  return { submit, cancel, isStreaming }
}

function dispatch(event: StreamEvent, opts: UseAskStreamOptions) {
  switch (event.type) {
    case "open":
      opts.onOpen?.(event.thread_id)
      return
    case "node":
      opts.onNode?.(event.name, event.phase)
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
  }
}
