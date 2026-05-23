interface Props {
  min?: number;
  max?: number;
  value: number;
  ticks?: number;
  suffix?: string;
  onChange?: (next: number) => void;
}

/** Visual slider — matches the design's `.slider-row` markup.
 *  Click on the track jumps the thumb. Suffix is appended to the value label. */
export function Slider({ min = 0, max = 100, value, ticks = 5, suffix = "", onChange }: Props) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = ((clamped - min) / (max - min)) * 100;

  const handleTrack = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!onChange) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const next = Math.round(min + ratio * (max - min));
    onChange(next);
  };

  return (
    <div className="slider-row">
      <span className="min">{min}</span>
      <div className="slider" onClick={handleTrack}>
        <div className="track" />
        <div className="fill" style={{ width: `${pct}%` }} />
        <div className="ticks">
          {Array.from({ length: ticks }).map((_, i) => (
            <span key={i} className="tick" />
          ))}
        </div>
        <div className="thumb" style={{ left: `${pct}%` }} />
      </div>
      <span className="max">{max}</span>
      <span className="val">
        {value}
        {suffix}
      </span>
    </div>
  );
}
