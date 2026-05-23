interface Props {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  onChange?: (next: number) => void;
}

export function NumInput({ value, min = -Infinity, max = Infinity, step = 1, onChange }: Props) {
  const adjust = (delta: number) => {
    if (!onChange) return;
    const next = Math.max(min, Math.min(max, value + delta));
    if (next !== value) onChange(next);
  };
  return (
    <span className="num-input">
      <span className="step left" onClick={() => adjust(-step)} role="button">
        −
      </span>
      <span className="val">{value}</span>
      <span className="step right" onClick={() => adjust(step)} role="button">
        +
      </span>
    </span>
  );
}
