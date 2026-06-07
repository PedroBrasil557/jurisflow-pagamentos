import { X } from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import {
  processStatusLabels,
  type ProcessStatusValue,
} from '../../services/processes.service'
import { formatShortDate } from './process-filters.utils'

type ProcessFilterChipsProps = {
  statuses: ProcessStatusValue[]
  createdFrom?: string
  createdTo?: string
  onRemoveStatus: (status: ProcessStatusValue) => void
  onRemovePeriod: () => void
  onClearAll: () => void
}

function periodLabel(createdFrom?: string, createdTo?: string): string | null {
  if (createdFrom && createdTo) {
    return `Período: ${formatShortDate(createdFrom)} – ${formatShortDate(createdTo)}`
  }

  if (createdFrom) {
    return `Período: a partir de ${formatShortDate(createdFrom)}`
  }

  if (createdTo) {
    return `Período: até ${formatShortDate(createdTo)}`
  }

  return null
}

export function ProcessFilterChips({
  statuses,
  createdFrom,
  createdTo,
  onRemoveStatus,
  onRemovePeriod,
  onClearAll,
}: ProcessFilterChipsProps) {
  const period = periodLabel(createdFrom, createdTo)
  const hasFilters = statuses.length > 0 || period !== null

  if (!hasFilters) {
    return null
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {statuses.map((status) => (
        <Badge className="gap-1 pr-1" key={status} variant="secondary">
          {`Etapa: ${processStatusLabels[status]}`}
          <button
            aria-label={`Remover filtro ${processStatusLabels[status]}`}
            className="rounded-sm text-muted-foreground hover:text-foreground"
            onClick={() => onRemoveStatus(status)}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </Badge>
      ))}

      {period ? (
        <Badge className="gap-1 pr-1" variant="secondary">
          {period}
          <button
            aria-label="Remover filtro de período"
            className="rounded-sm text-muted-foreground hover:text-foreground"
            onClick={onRemovePeriod}
            type="button"
          >
            <X className="size-3.5" />
          </button>
        </Badge>
      ) : null}

      <Button
        className="h-7 px-2 text-muted-foreground"
        onClick={onClearAll}
        size="sm"
        type="button"
        variant="ghost"
      >
        Limpar tudo
      </Button>
    </div>
  )
}
