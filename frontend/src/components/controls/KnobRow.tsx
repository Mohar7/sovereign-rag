import type { ReactNode } from "react";

interface Props {
  label: string;
  help?: ReactNode;
  children: ReactNode;
}

/** A two-column row used in SettingsPanel and ContextManager:
 *    [label + optional muted help text]   [control]
 *  Keeps controls aligned and the label column at a fixed width via CSS. */
export function KnobRow({ label, help, children }: Props) {
  return (
    <div className="knob-row">
      <div className="label">
        {label}
        {help && <span className="help">{help}</span>}
      </div>
      <div className="control">{children}</div>
    </div>
  );
}
