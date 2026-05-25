interface Props {
  size?: number
  className?: string
}

/**
 * The sovereign-rag logo mark — two overlapping rounded squares referencing
 * the dual-retriever (graph + vector) fusion. Inlined so `currentColor`
 * cascades from the parent (sidebar foreground, indigo button bg, etc.).
 */
export function BrandMark({ size = 24, className }: Props) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
      style={{ display: "block" }}
    >
      <rect
        x="3"
        y="3"
        width="16"
        height="16"
        rx="3"
        fill="currentColor"
        opacity="0.85"
      />
      <rect
        x="13"
        y="13"
        width="16"
        height="16"
        rx="3"
        fill="currentColor"
      />
    </svg>
  )
}
