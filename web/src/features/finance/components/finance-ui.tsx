import { Link } from '@tanstack/react-router'
import { Inbox, Lock, type LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '#/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '#/components/ui/card'
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '#/components/ui/empty'
import { Skeleton } from '#/components/ui/skeleton'
import { cn } from '#/lib/utils'
import { QueryError } from '@/shared/components/query-error'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatCents } from '../lib/finance-money'

export function FinanceSection({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string
  description?: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="space-y-1">
          <CardTitle className="text-base">{title}</CardTitle>
          {description ? (
            <p className="text-sm text-muted-foreground">{description}</p>
          ) : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  )
}

export function LoadingState({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-live="polite" className="space-y-2">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: rows }, (_, i) => i + 1).map((line) => (
        <Skeleton className="h-9 w-full" key={`linha-${line}`} />
      ))}
    </div>
  )
}

export function EmptyState({
  title,
  description,
  icon: Icon = Inbox,
  action,
}: {
  title: string
  description?: string
  icon?: LucideIcon
  action?: ReactNode
}) {
  return (
    <Empty className="border">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <Icon />
        </EmptyMedia>
        <EmptyTitle>{title}</EmptyTitle>
        {description ? (
          <EmptyDescription>{description}</EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  )
}

export function DeniedState({ message }: { message?: string }) {
  return (
    <EmptyState
      description={
        message ??
        'Seu perfil não tem acesso a esta área financeira. Solicite ao administrador.'
      }
      icon={Lock}
      title="Acesso não permitido"
    />
  )
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown
  onRetry?: () => void
}) {
  return (
    <QueryError
      message={error instanceof Error ? error.message : undefined}
      onRetry={onRetry}
    />
  )
}

export function Money({
  cents,
  className,
  strong,
}: {
  cents: number | null | undefined
  className?: string
  strong?: boolean
}) {
  return (
    <span
      className={cn(
        'tabular-nums whitespace-nowrap',
        strong && 'font-semibold text-foreground',
        className,
      )}
    >
      {formatCents(cents)}
    </span>
  )
}

export function StatPill({
  label,
  cents,
  hint,
}: {
  label: string
  cents: number
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-xl font-semibold tabular-nums">
        {formatCents(cents)}
      </p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  )
}

export function Tone({
  map,
  value,
}: {
  map: Record<
    string,
    { label: string; tone: 'success' | 'warning' | 'info' | 'error' | 'ghost' }
  >
  value: string
}) {
  const entry = map[value] ?? { label: value, tone: 'ghost' as const }
  return <StatusBadge tone={entry.tone}>{entry.label}</StatusBadge>
}

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Button asChild size="sm" variant="ghost">
      <Link className="no-underline" preload={false} to={to}>
        ← {label}
      </Link>
    </Button>
  )
}

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null
  return (
    <p className="text-xs text-destructive" role="alert">
      {message}
    </p>
  )
}
