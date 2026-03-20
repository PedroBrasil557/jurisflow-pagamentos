import { cn } from '#/lib/utils'

type StatusTone = 'error' | 'ghost' | 'info' | 'success' | 'warning'

const toneClasses: Record<StatusTone, string> = {
  success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  info: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  error: 'bg-red-500/15 text-red-600 dark:text-red-400',
  ghost: 'bg-muted text-muted-foreground',
}

type StatusBadgeProps = {
  children: string
  className?: string
  tone: StatusTone
}

export function StatusBadge({ children, className, tone }: StatusBadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}
