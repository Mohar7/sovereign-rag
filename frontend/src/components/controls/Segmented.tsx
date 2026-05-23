interface Props<T extends string> {
  options: readonly T[];
  active: T;
  onChange?: (next: T) => void;
}

export function Segmented<T extends string>({ options, active, onChange }: Props<T>) {
  return (
    <div className="segmented">
      {options.map((o) => (
        <button
          key={o}
          className={`seg ${o === active ? "active" : ""}`}
          type="button"
          onClick={() => onChange?.(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
