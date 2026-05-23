// Thin wrapper around `client.threads.*` that handles the lifecycle and
// surfaces a stable list ordered by last update.

import { useCallback, useEffect, useState } from "react";
import { client } from "../lib/langgraph";
import type { ThreadSummary } from "../lib/types";

function relTime(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const dt = Date.now() - t;
    if (dt < 60_000) return "just now";
    if (dt < 3_600_000) return `${Math.round(dt / 60_000)}m`;
    if (dt < 86_400_000) return `${Math.round(dt / 3_600_000)}h`;
    return `${Math.round(dt / 86_400_000)}d`;
  } catch {
    return "—";
  }
}

interface ThreadMetadata {
  title?: string;
  question_count?: number;
}

interface RawThread {
  thread_id: string;
  updated_at?: string;
  status?: string;
  interrupts?: Record<string, unknown>;
  metadata?: ThreadMetadata;
  values?: { question?: string };
}

function toSummary(raw: RawThread): ThreadSummary {
  const md = raw.metadata ?? {};
  const title =
    md.title ||
    raw.values?.question?.slice(0, 60) ||
    "untitled";
  return {
    thread_id: raw.thread_id,
    title,
    question_count: md.question_count ?? 1,
    last_activity: raw.updated_at ? relTime(raw.updated_at) : "—",
    paused_at_interrupt:
      raw.status === "interrupted" ||
      (raw.interrupts != null && Object.keys(raw.interrupts).length > 0),
  };
}

export function useThreads() {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      // The SDK paginates; for the rail we cap at 50 most recent.
      const raw = (await client.threads.search({
        limit: 50,
        sortBy: "updated_at",
        sortOrder: "desc",
      })) as unknown as RawThread[];
      setThreads(raw.map(toSummary));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (title?: string): Promise<string> => {
    const metadata: Record<string, unknown> = {};
    if (title) metadata.title = title;
    const t = (await client.threads.create({ metadata })) as { thread_id: string };
    await refresh();
    return t.thread_id;
  }, [refresh]);

  const remove = useCallback(async (id: string) => {
    await client.threads.delete(id);
    await refresh();
  }, [refresh]);

  return { threads, loading, error, refresh, create, remove };
}
