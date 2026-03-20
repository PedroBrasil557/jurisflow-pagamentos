import { formatDateTime } from '@/shared/lib/format'
import type { ProcessListItem } from '../services/processes.service'

export function ProcessLastMovement({ process }: { process: ProcessListItem }) {
  if (!process.lastMovement) {
    return (
      <span className="text-sm text-muted-foreground">Sem movimentacao</span>
    )
  }

  return (
    <div className="grid gap-1">
      <p className="font-semibold  text-foreground">
        {process.lastMovement.label}
      </p>
      <p className="text-sm  text-muted-foreground">
        {process.lastMovement.actorName}
      </p>
      <p className="text-xs  text-muted-foreground">
        {formatDateTime(process.lastMovement.createdAt)}
      </p>
    </div>
  )
}
