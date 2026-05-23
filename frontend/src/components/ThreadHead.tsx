interface Props {
  title: string;
  model?: string;
  retrieveK?: number;
  rerankK?: number;
  graphOn?: boolean;
  fallbackOn?: boolean;
}

export function ThreadHead({
  title,
  model = "kimi-k2.6",
  retrieveK = 50,
  rerankK = 5,
  graphOn = true,
  fallbackOn = true,
}: Props) {
  return (
    <div className="thread-head">
      <span className="t-title">{title}</span>
      <span className="t-meta">
        <span className="knob">
          <span className="lab">model</span> <span className="v">{model}</span>
        </span>
        <span className="knob">
          <span className="lab">k_ret</span> <span className="val">{retrieveK}</span>
        </span>
        <span className="knob">
          <span className="lab">k_rer</span> <span className="val">{rerankK}</span>
        </span>
        <span className="knob">
          <span className="lab">graph</span>{" "}
          <span className={graphOn ? "on" : "off"}>●</span>{" "}
          <span className="v">{graphOn ? "on" : "off"}</span>
        </span>
        <span className="knob">
          <span className="lab">fallback</span>{" "}
          <span className={fallbackOn ? "on" : "off"}>●</span>{" "}
          <span className="v">{fallbackOn ? "on" : "off"}</span>
        </span>
      </span>
    </div>
  );
}
