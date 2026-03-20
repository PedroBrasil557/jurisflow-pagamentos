import type { ReactNode } from 'react'

type PageHeaderProps = {
  children?: ReactNode
  description?: string
  eyebrow?: string
  title: string
}

export function PageHeader({
  children,
  description,
  eyebrow,
  title,
}: PageHeaderProps) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="space-y-1">
        {eyebrow ? (
          <p className="text-xs font-medium text-primary">{eyebrow}</p>
        ) : null}
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">
          {title}
        </h1>
        {description ? (
          <p className="text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children ? (
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      ) : null}
    </div>
  )
}
