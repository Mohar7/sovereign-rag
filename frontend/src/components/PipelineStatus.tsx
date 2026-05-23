import type { PipelineStatus as Step } from "../lib/types";

interface Props {
  steps: Step[];
  /** "elapsed / target" timer, e.g. "02.8 / ~04.5s" */
  timer?: string;
}

export function PipelineStatus({ steps, timer }: Props) {
  return (
    <div className="pipeline-status">
      {steps.map((s, i) => {
        const cls =
          s.state === "done" ? "step done" : s.state === "live" ? "step live" : "step";
        const label = s.count != null ? `${s.step} · ${s.count}` : s.step;
        return (
          <span key={s.step}>
            <span className={cls}>
              <span className="ic" />
              {label}
            </span>
            {i < steps.length - 1 && <span className="arrow"> ▸ </span>}
          </span>
        );
      })}
      {timer && <span className="timer">{timer}</span>}
    </div>
  );
}
