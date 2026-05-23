// The Ask screen — the design's centerpiece. Wires the components to the
// live LangGraph backend via the SDK hooks (useThreads, useRun).
// Five visual states from the design appear naturally as the data evolves:
//   - Empty       → no thread selected & no turns
//   - Hero        → turns with citations, idle composer
//   - Mid-stream  → useRun.state === "streaming"
//   - HITL        → the last assistant turn has a `.interrupt`
//   - Error       → useRun.state === "error"

import { useCallback, useMemo, useState } from "react";
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
import { useRun } from "./hooks/useRun";
import { useThreads } from "./hooks/useThreads";
import type { Turn as TurnT } from "./lib/types";

export function AskScreen() {
  const { threads, refresh: refreshThreads, create: createThread } = useThreads();
  const [activeThread, setActiveThread] = useState<string | null>(null);
  const { turns, setTurns, state, pipeline, error, stop, start, resume } = useRun([]);
  const [composerValue, setComposerValue] = useState("");
  const [activeCitation, setActiveCitation] = useState<number | undefined>();

  const lastAssistant = useMemo(
    () => [...turns].reverse().find((t) => t.role === "assistant"),
    [turns]
  );

  const onSelectThread = useCallback(
    (id: string) => {
      if (id === activeThread) return;
      setActiveThread(id);
      // For a portfolio first iteration we don't reload past turns from the
      // server — the right thing here is to fetch the thread state and
      // re-hydrate. Wiring left as a follow-up.
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

  return (
    <div className="ask">
      <TopBar threadTitle={threadTitle} state={topbarState} />
      <ThreadsRail
        threads={threads}
        activeId={activeThread}
        onSelect={onSelectThread}
        onNew={onNewThread}
      />

      <main className="center">
        <ThreadHead title={threadTitle} />

        {turns.length === 0 && state === "idle" ? (
          <Empty onSuggestion={(s) => setComposerValue(s)} />
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
            {renderTurns(turns, activeCitation, setActiveCitation, state, pipeline, onApprove, onSkipApproval)}
          </div>
        )}

        <Composer
          value={composerValue}
          onChange={setComposerValue}
          onSubmit={onSubmit}
          onStop={stop}
          state={state === "streaming" ? "streaming" : "idle"}
        />
      </main>

      <SourcesRail
        title={state === "streaming" ? "Sources · streaming" : "Sources cited"}
        count={lastAssistant?.citations?.length ?? 0}
        retrieved={lastAssistant?.retrieved ?? 0}
        used={lastAssistant?.used ?? 0}
      >
        {renderSources(lastAssistant, activeCitation, setActiveCitation, state)}
      </SourcesRail>
    </div>
  );
}

function renderTurns(
  turns: TurnT[],
  active: number | undefined,
  setActive: (i: number | undefined) => void,
  state: "idle" | "streaming" | "error",
  pipeline: ReturnType<typeof useRun>["pipeline"],
  onApprove: (urls: string[]) => void,
  onSkip: () => void
) {
  return turns.map((t, i) => {
    const isLastAssistant =
      t.role === "assistant" && i === turns.length - 1;
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
      extras.push(
        <PipelineStatusBar key="pipeline" steps={pipeline} />
      );
    }
    return (
      <Turn
        key={t.id}
        turn={t}
        index={i}
        activeCitation={active}
        onCitationClick={(idx) => setActive(idx)}
        extra={<>{extras}</>}
      />
    );
  });
}

function renderSources(
  lastAssistant: TurnT | undefined,
  active: number | undefined,
  setActive: (i: number | undefined) => void,
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
      onClick={() => setActive(i)}
    />
  ));
}
