import { AlertTriangle } from 'lucide-react'
import { StatusBadge } from '@/shared/components/status-badge'
import type { ProcessChecklistItem } from '../services/processes.service'

function getChecklistStatusTone(status: string) {
  switch (status) {
    case 'ANEXADO':
      return 'success' as const
    case 'OK_SEM_ARQUIVO':
      return 'info' as const
    case 'APROVADO':
      return 'success' as const
    case 'REJEITADO':
      return 'error' as const
    default:
      return 'ghost' as const
  }
}

function getChecklistStatusLabel(status: string) {
  switch (status) {
    case 'OK_SEM_ARQUIVO':
      return 'Ok sem arquivo'
    default:
      return status
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())
  }
}

function getChecklistItemSecondaryLabel(item: ProcessChecklistItem) {
  if (item.currentFiles.length > 0) {
    return item.currentFiles.length === 1
      ? '1 arquivo atual'
      : `${item.currentFiles.length} arquivos atuais`
  }

  if (item.status === 'OK_SEM_ARQUIVO') {
    return 'Ok sem arquivo'
  }

  return item.documentType.isRequired ? 'Pendente' : 'Documento opcional'
}

export function ChecklistStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={getChecklistStatusTone(status)}>
      {getChecklistStatusLabel(status)}
    </StatusBadge>
  )
}

export function ChecklistItemCard({
  item,
  onOpen,
  flagged = false,
}: {
  item: ProcessChecklistItem
  onOpen: (item: ProcessChecklistItem) => void
  // Tem pendencia bloqueante (reviewFlag) ligada a este doc — eco do banner.
  flagged?: boolean
}) {
  const numberPrefix = item.documentType.number
    ? `${item.documentType.number}. `
    : ''

  return (
    <button
      className="cursor-pointer rounded-[1.75rem] border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/6"
      onClick={() => onOpen(item)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-2">
          <p className="text-lg font-semibold text-foreground">
            {`${numberPrefix}${item.documentType.label}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {getChecklistItemSecondaryLabel(item)}
          </p>
          {flagged ? (
            <span className="flex items-center gap-1 text-amber-600 text-xs dark:text-amber-400">
              <AlertTriangle className="size-3" />
              Pendência impede a conclusão — ver no topo
            </span>
          ) : null}
        </div>

        <ChecklistStatusBadge status={item.status} />
      </div>

      {item.observation ? (
        <div className="mt-4 rounded-2xl border border-border bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Observacao
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.observation}
          </p>
        </div>
      ) : null}
    </button>
  )
}
