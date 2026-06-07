import { StatusBadge } from '@/shared/components/status-badge'
import { getProcessStatusLabel } from '../services/processes.service'

function getStatusTone(status: string) {
  switch (status) {
    case 'RASCUNHO':
      return 'ghost' as const
    case 'CADASTRADO':
      return 'ghost' as const
    case 'EM_LOTE':
      return 'warning' as const
    case 'EM_DOCUMENTACAO':
      return 'warning' as const
    case 'DOCUMENTACAO_PRONTA':
      return 'info' as const
    case 'EM_PROCESSO':
      return 'info' as const
    case 'FINALIZADO':
      return 'success' as const
    case 'CANCELADO':
      return 'error' as const
    default:
      return 'ghost' as const
  }
}

export function ProcessStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={getStatusTone(status)}>
      {getProcessStatusLabel(status)}
    </StatusBadge>
  )
}
