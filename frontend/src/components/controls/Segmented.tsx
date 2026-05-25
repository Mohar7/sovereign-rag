interface Props<T extends string> {
  options: readonly T[];
  active: T;
  disabled?: boolean;
  /** Optional hover tooltip per option (e.g. {"Semantic": "Splits by meaning…"}). */
  tooltips?: Partial<Record<T, string>>;
  onChange?: (next: T) => void;
}

export function Segmented<T extends string>({
  options,
  active,
  disabled,
  tooltips,
  onChange,
}: Props<T>) {
  return (
    <div className={`segmented ${disabled ? "disabled" : ""}`}>
      {options.map((o) => (
        <button
          key={o}
          className={`seg ${o === active ? "active" : ""}`}
          type="button"
          title={tooltips?.[o]}
          disabled={disabled}
          onClick={() => !disabled && onChange?.(o)}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
