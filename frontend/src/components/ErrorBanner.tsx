interface Props {
  label: string;
  message: string;
  /** Short code surfaced in the banner — e.g. "SearXNG_UNREACHABLE". */
  code?: string;
  endpoint?: string;
  onRetry?: () => void;
  onDisable?: () => void;
}

export function ErrorBanner({ label, message, code, endpoint, onRetry, onDisable }: Props) {
  return (
    <div className="error-banner">
      <span className="lab">{label}</span>
      <div className="msg">
        {message}
        {code && (
          <>
            : <span className="code">{code}</span>
          </>
        )}
        {endpoint && (
          <>
            {" "}
            at <span className="code">{endpoint}</span>.
          </>
        )}
      </div>
      {onRetry && (
        <button className="retry" type="button" onClick={onRetry}>
          retry
        </button>
      )}
      {onDisable && (
        <button className="retry" type="button" onClick={onDisable}>
          disable fallback
        </button>
      )}
    </div>
  );
}
