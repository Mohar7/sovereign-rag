// The Ask screen — the design's centerpiece. Wires the components to the
// live LangGraph backend via the SDK hooks (useThreads, useRun).
// Five visual states from the design appear naturally as the data evolves:
//   - Empty       → no thread selected & no turns
//   - Hero        → turns with citations, idle composer
//   - Mid-stream  → useRun.state === "streaming"
//   - HITL        → the last assistant turn has a `.interrupt`
//   - Error       → useRun.state === "error"
//
// Plus five overlay surfaces from the v2 design:
//   - Settings panel (TopBar ⚙)
//   - Retrieval inspector (SourcesRail ⚙ INSPECT)
//   - Context manager (TopBar context button — to wire)
//   - Source detail drawer (click a citation chip or a source card)
//   - Command palette (⌘K)

import { useCallback, useEffect, useMemo, useState } from "react";
import { ApprovalCard } from "./components/ApprovalCard";
import { Composer } from "./components/Composer";
import { Empty } from "./components/Empty";
import { ErrorBanner } from "./components/ErrorBanner";
import { PipelineStatus as PipelineStatusBar } from "./components/PipelineStatus";
import { SourceCard } from "./components/SourceCard";
import { SourcesRail } from "./components/SourcesRail";
import { ThreadHead } from "./components/ThreadHead";
import { ThreadsRail } from "./components/ThreadsRail";
import { TopBar } from "./components/TopBar";
import { Turn } from "./components/Turn";
import { CommandPalette } from "./features/CommandPalette";
import { ContextManager } from "./features/ContextManager";
import { IngestSheet } from "./features/IngestSheet";
import { RetrievalInspector } from "./features/RetrievalInspector";
import { SettingsPanel } from "./features/SettingsPanel";
import { SourceDetailDrawer } from "./features/SourceDetailDrawer";
import { useCorpusStats, useHealth, useSettings, useThreadContext } from "./hooks/useCorpus";
import { useRun } from "./hooks/useRun";
import { useThreads } from "./hooks/useThreads";
import type { ServiceHealth, Turn as TurnT } from "./lib/types";

type IngestMode = "url" | "text" | "web";
type Overlay =
  | "settings"
  | "inspector"
  | "context"
  | "source"
  | "palette"
  | `ingest:${IngestMode}`
  | null;

export function AskScreen() {
  const { threads, refresh: refreshThreads, create: createThread } = useThreads();
  const { data: corpus } = useCorpusStats();
  const { data: health } = useHealth();
  const { data: settings, patch: patchSettings } = useSettings();
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const threadCtx = useThreadContext(activeThread);
  const { turns, setTurns, state, pipeline, error, inspector, stop, start, resume } = useRun([]);
  const [composerValue, setComposerValue] = useState("");
  const [activeCitation, setActiveCitation] = useState<number | undefined>();

  // Overlay state — only one panel is ever visible at a time.
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [paletteQuery, setPaletteQuery] = useState("");
  const closeOverlay = useCallback(() => setOverlay(null), []);

  const lastAssistant = useMemo(
    () => [...turns].reverse().find((t) => t.role === "assistant"),
    [turns]
  );

  // Global keyboard shortcuts: ⌘K opens palette; Esc closes any overlay.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOverlay((o) => (o === "palette" ? null : "palette"));
        return;
      }
      if (e.key === "Escape" && overlay) {
        e.preventDefault();
        closeOverlay();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [overlay, closeOverlay]);

  const onSelectThread = useCallback(
    (id: string) => {
      if (id === activeThread) return;
      setActiveThread(id);
      setTurns([]);
      setActiveCitation(undefined);
    },
    [activeThread, setTurns]
  );

  const onNewThread = useCallback(async () => {
    const id = await createThread();
    setActiveThread(id);
    setTurns([]);
    setActiveCitation(undefined);
  }, [createThread, setTurns]);

  const onSubmit = useCallback(async () => {
    const q = composerValue.trim();
    if (!q) return;
    let threadId = activeThread;
    if (!threadId) {
      threadId = await createThread(q.slice(0, 60));
      setActiveThread(threadId);
    }
    setComposerValue("");
    await start(q, threadId);
    void refreshThreads();
  }, [activeThread, composerValue, createThread, refreshThreads, start]);

  // Used by the Empty-state ASK suggestion cards: same flow as a composer
  // submit but with the chosen question instead of whatever's in the box.
  const askDirect = useCallback(
    async (question: string) => {
      const q = question.trim();
      if (!q) return;
      let threadId = activeThread;
      if (!threadId) {
        threadId = await createThread(q.slice(0, 60));
        setActiveThread(threadId);
      }
      await start(q, threadId);
      void refreshThreads();
    },
    [activeThread, createThread, refreshThreads, start],
  );

  // Used by ingest/web sheets — refresh the corpus pill after a doc is added.
  // The /api/corpus/stats hook polls every 30s so we don't strictly need this,
  // but a force-bust makes the UI feel instant.
  const onIngested = useCallback(() => {
    void refreshThreads();
  }, [refreshThreads]);

  const onApprove = useCallback(
    async (approvedUrls: string[]) => {
      if (!activeThread) return;
      await resume(activeThread, approvedUrls);
      void refreshThreads();
    },
    [activeThread, refreshThreads, resume]
  );

  const onSkipApproval = useCallback(async () => {
    await onApprove([]);
  }, [onApprove]);

  const onCitationClick = useCallback((idx: number) => {
    setActiveCitation(idx);
    setOverlay("source");
  }, []);

  const topbarState: "ok" | "streaming" | "hitl" | "error" =
    state === "error"
      ? "error"
      : state === "streaming"
        ? "streaming"
        : lastAssistant?.status === "interrupted"
          ? "hitl"
          : "ok";

  const threadTitle =
    threads.find((t) => t.thread_id === activeThread)?.title ||
    (turns[0]?.role === "user" ? turns[0].content.slice(0, 40) : "untitled");

  const lastQuestion = useMemo(() => {
    for (let i = turns.length - 1; i >= 0; i--) {
      const t = turns[i];
      if (t && t.role === "user") return t.content;
    }
    return "";
  }, [turns]);

  // Health pills want a Partial<ServiceHealth>; map api ServiceStatus[] into that.
  const healthMap: Partial<ServiceHealth> = useMemo(() => {
    const out: Partial<ServiceHealth> = {};
    for (const s of health?.services ?? []) {
      if (
        s.name === "milvus" ||
        s.name === "neo4j" ||
        s.name === "postgres" ||
        s.name === "searxng" ||
        s.name === "ollama" ||
        s.name === "openai"
      ) {
        out[s.name] = s.state;
      }
    }
    return out;
  }, [health]);

  return (
    <div className="ask">
      <TopBar
        threadTitle={threadTitle}
        state={topbarState}
        corpusDocs={corpus?.documents ?? 0}
        corpusChunks={corpus?.chunks ?? 0}
        health={healthMap}
        onOpenSettings={() => setOverlay("settings")}
        onOpenContext={() => setOverlay("context")}
      />
      <ThreadsRail
        threads={threads}
        activeId={activeThread}
        onSelect={onSelectThread}
        onNew={onNewThread}
      />

      <main className="center">
        <ThreadHead
          title={threadTitle}
          model={settings?.llm_model ?? "kimi-k2.6"}
          retrieveK={settings?.retrieve_top_k ?? 50}
          rerankK={settings?.rerank_top_k ?? 5}
          graphOn={settings?.enable_graph_retrieval ?? true}
          fallbackOn={(settings?.web_fallback_min_chunks ?? 3) > 0}
        />

        {turns.length === 0 && state === "idle" ? (
          <Empty
            onSuggestion={(s) => setComposerValue(s)}
            onAsk={(q) => void askDirect(q)}
            onIngest={() => setOverlay("ingest:url")}
            onWeb={() => setOverlay("ingest:web")}
            corpus={
              corpus
                ? {
                    docs: corpus.documents,
                    chunks: corpus.chunks,
                    entities: corpus.entities,
                    relations: corpus.relations,
                    lastIndexed: corpus.last_indexed ?? "—",
                  }
                : undefined
            }
          />
        ) : (
          <div className="conversation">
            {state === "error" && error && (
              <ErrorBanner
                label="backend"
                message="A request to the LangGraph server failed mid-flight"
                code={error.slice(0, 80)}
                onRetry={() => void refreshThreads()}
              />
            )}
            {renderTurns(
              turns,
              activeCitation,
              onCitationClick,
              state,
              pipeline,
              onApprove,
              onSkipApproval
            )}
          </div>
        )}

        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={onSubmit}
          onStop={stop}
          state={state === "streaming" ? "streaming" : "idle"}
          model={settings?.llm_model ?? "kimi-k2.6"}
          retrieveK={settings?.retrieve_top_k ?? 50}
          rerankK={settings?.rerank_top_k ?? 5}
          graphOn={settings?.enable_graph_retrieval ?? true}
          fallbackMin={settings?.web_fallback_min_chunks ?? 3}
        />
      </main>

      <SourcesRail
        title={state === "streaming" ? "Sources · streaming" : "Sources cited"}
        count={lastAssistant?.citations?.length ?? 0}
        retrieved={lastAssistant?.retrieved ?? 0}
        used={lastAssistant?.used ?? 0}
        onInspect={() => setOverlay("inspector")}
      >
        {renderSources(lastAssistant, activeCitation, onCitationClick, state)}
      </SourcesRail>

      {/* Overlays — rendered last so they sit above the ask grid. */}
      {overlay === "settings" && (
        <SettingsPanel
          settings={settings}
          onPatch={patchSettings}
          onClose={closeOverlay}
        />
      )}
      {overlay === "inspector" && (
        <RetrievalInspector
          data={inspector}
          question={lastQuestion}
          settings={
            settings
              ? {
                  embed_model: settings.embed_model,
                  embed_dim: settings.embed_dim,
                  rrf_k: settings.rrf_k,
                  reranker_model: settings.reranker_model,
                }
              : null
          }
          onClose={closeOverlay}
        />
      )}
      {overlay === "context" && (
        <ContextManager
          threadId={activeThread}
          turns={turns}
          contextWindow={256_000}
          threadCtx={threadCtx}
          onClose={closeOverlay}
        />
      )}
      {overlay === "source" &&
        activeCitation != null &&
        lastAssistant?.citations?.[activeCitation] && (
          <SourceDetailDrawer
            n={activeCitation + 1}
            citation={lastAssistant.citations[activeCitation]!}
            settings={settings}
            pinned={(threadCtx.data?.pins ?? []).some(
              (p) =>
                p.chunk_id === lastAssistant.citations![activeCitation]!.chunk_id &&
                p.action === "pinned",
            )}
            excluded={(threadCtx.data?.pins ?? []).some(
              (p) =>
                p.chunk_id === lastAssistant.citations![activeCitation]!.chunk_id &&
                p.action === "excluded",
            )}
            onPin={(id) => threadCtx.pin(id, "pinned")}
            onUnpin={(id) => threadCtx.unpin(id)}
            onExclude={(id) => threadCtx.pin(id, "excluded")}
            onRerank={() => {
              // Re-fire the most recent user question against the active thread.
              const lastUserTurn = [...turns].reverse().find((t) => t.role === "user");
              if (lastUserTurn && activeThread) {
                void start(lastUserTurn.content, activeThread);
                closeOverlay();
              }
            }}
            onOpenInLibrary={(_docId) => {
              // Open the palette with the doc title prefilled so the
              // user lands on its other chunks. The Documents section in
              // the palette fans out to /api/documents/search live.
              const title = lastAssistant.citations![activeCitation]!.title;
              setPaletteQuery(title);
              setOverlay("palette");
            }}
            onClose={closeOverlay}
          />
        )}
      {overlay === "palette" && (
        <CommandPalette
          threads={threads}
          initialQuery={paletteQuery}
          onSelectThread={(id) => {
            onSelectThread(id);
            setPaletteQuery("");
            closeOverlay();
          }}
          onOpenSettings={() => setOverlay("settings")}
          onClose={() => {
            setPaletteQuery("");
            closeOverlay();
          }}
        />
      )}
      {overlay?.startsWith("ingest:") && (
        <IngestSheet
          initialMode={overlay.slice("ingest:".length) as IngestMode}
          onIndexed={onIngested}
          onClose={closeOverlay}
        />
      )}
    </div>
  );
}

function renderTurns(
  turns: TurnT[],
  active: number | undefined,
  onCitationClick: (i: number) => void,
  state: "idle" | "streaming" | "error",
  pipeline: ReturnType<typeof useRun>["pipeline"],
  onApprove: (urls: string[]) => void,
  onSkip: () => void
) {
  return turns.map((t, i) => {
    const isLastAssistant = t.role === "assistant" && i === turns.length - 1;
    const extras: React.ReactNode[] = [];
    if (isLastAssistant && t.status === "interrupted" && t.interrupt) {
      const lastUser = [...turns]
        .slice(0, i)
        .reverse()
        .find((tt) => tt.role === "user");
      extras.push(
        <ApprovalCard
          key="approval"
          question={lastUser?.content ?? ""}
          candidates={t.interrupt.candidate_urls}
          onApprove={onApprove}
          onSkip={onSkip}
        />
      );
    }
    if (isLastAssistant && state === "streaming") {
      extras.push(<PipelineStatusBar key="pipeline" steps={pipeline} />);
    }
    return (
      <Turn
        key={t.id}
        turn={t}
        index={i}
        activeCitation={active}
        onCitationClick={onCitationClick}
        extra={<>{extras}</>}
      />
    );
  });
}

function renderSources(
  lastAssistant: TurnT | undefined,
  active: number | undefined,
  onCitationClick: (i: number) => void,
  state: "idle" | "streaming" | "error"
) {
  const cits = lastAssistant?.citations ?? [];
  if (cits.length === 0) {
    if (state === "streaming") {
      return (
        <>
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton-source">
              <div className="bar short" />
              <div className="bar med" />
              <div className="bar" />
            </div>
          ))}
        </>
      );
    }
    return (
      <div className="sources-empty">
        <div className="head">— no citations yet —</div>
        Sources surface here as the model cites them. Each card shows the chunk text, document,
        page, and cross-encoder score.
      </div>
    );
  }
  return cits.map((c, i) => (
    <SourceCard
      key={c.chunk_id || `c-${i}`}
      n={i + 1}
      citation={c}
      active={active === i}
      onClick={() => onCitationClick(i)}
    />
  ));
}
