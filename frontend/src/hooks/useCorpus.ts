// Real-data hooks for the corpus stats + service health pills + settings.
// Stay zero-dep (no TanStack Query) — a useEffect-based poll is enough
// for these small refresh-loop surfaces.

import { useEffect, useState } from "react";
import {
  api,
  type CorpusStats,
  type HealthResponse,
  type PinAction,
  type Settings,
  type ThreadContextDoc,
} from "../lib/api";

export interface UseRefreshable<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Light polling helper. `intervalMs=0` → no polling, only on-mount + reload(). */
function useRefreshing<T>(fetcher: () => Promise<T>, intervalMs: number): UseRefreshable<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcher()
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    if (intervalMs > 0) {
      const id = window.setInterval(() => setTick((t) => t + 1), intervalMs);
      return () => {
        cancelled = true;
        clearInterval(id);
      };
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function useCorpusStats(): UseRefreshable<CorpusStats> {
  // Refresh every 30s — corpus rarely changes by more than that interval
  // while a user is asking questions.
  return useRefreshing(() => api.corpusStats(), 30_000);
}

export function useHealth(): UseRefreshable<HealthResponse> {
  // Refresh every 10s — health pills should reflect a degraded service
  // within seconds, not minutes.
  return useRefreshing(() => api.health(), 10_000);
}

export function useSettings(): UseRefreshable<Settings> & {
  patch: (patch: Partial<Settings>) => Promise<Settings>;
} {
  const base = useRefreshing(() => api.settings(), 0);
  return {
    ...base,
    patch: async (patch) => {
      const next = await api.patchSettings(patch);
      // Optimistic local update so the slide-over reflects the change
      // without a network round-trip on the next render.
      base.reload();
      return next;
    },
  };
}

export function useThreadContext(threadId: string | null): UseRefreshable<ThreadContextDoc> & {
  pin: (chunkId: string, action?: PinAction, note?: string) => Promise<void>;
  unpin: (chunkId: string) => Promise<void>;
  clear: () => Promise<void>;
} {
  const [data, setData] = useState<ThreadContextDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const p: Promise<ThreadContextDoc> = threadId
      ? api.threadContext(threadId)
      : Promise.resolve({ thread_id: "", pins: [] });
    p.then((d) => {
      if (cancelled) return;
      setData(d);
      setError(null);
    })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, tick]);

  const reload = () => setTick((t) => t + 1);

  return {
    data,
    loading,
    error,
    reload,
    pin: async (chunkId, action = "pinned", note) => {
      if (!threadId) return;
      await api.pinChunk(threadId, chunkId, action, note);
      reload();
    },
    unpin: async (chunkId) => {
      if (!threadId) return;
      await api.unpinChunk(threadId, chunkId);
      reload();
    },
    clear: async () => {
      if (!threadId) return;
      await api.clearThreadContext(threadId);
      reload();
    },
  };
}
