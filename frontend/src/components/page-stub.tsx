import type { ReactNode } from "react"

interface Props {
  title: string
  subtitle?: string
  children?: ReactNode
}

/** A neutral page wrapper used by every route stub until the real screen lands. */
export function PageStub({ title, subtitle, children }: Props) {
  return (
    <div className="mx-auto w-full max-w-screen-2xl px-6 lg:px-8 2xl:px-10 py-8 2xl:py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-3xl 2xl:text-4xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {subtitle && (
          <p className="text-base text-muted-foreground max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      {children && <div className="mt-10">{children}</div>}
    </div>
  )
}
