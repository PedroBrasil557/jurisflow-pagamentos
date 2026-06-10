import { Badge } from '#/components/ui/badge'
import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'
import { formatCpf } from '../process-form.utils'
import type { ProcessListItem } from '../services/processes.service'
import { ProcessActions } from './process-actions'
import { ProcessLastMovement } from './process-last-movement'
import { ProcessIngestionBadge } from './process-ingestion-badge'
import { ProcessStatusBadge } from './process-status-badge'

export function ProcessMobileCard({
  onCancel,
  onFinalize,
  onGeneratePdf,
  onLegalProcess,
  onViewHistory,
  permissions,
  process,
}: {
  onCancel: (process: ProcessListItem) => void
  onFinalize: (process: ProcessListItem) => void
  onGeneratePdf: (processId: string) => void
  onLegalProcess: (process: ProcessListItem) => void
  onViewHistory: (processId: string) => void
  permissions: ResolvedPermissions
  process: ProcessListItem
}) {
  return (
    <article className="rounded-3xl border border-border bg-card p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-2">
          <p className="font-semibold  text-foreground">{process.fullName}</p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="">
              {formatCpf(process.cpf)}
            </Badge>
            <ProcessIngestionBadge status={process.ingestionStatus} />
          </div>
        </div>

        <ProcessActions
          onCancel={onCancel}
          onFinalize={onFinalize}
          onGeneratePdf={onGeneratePdf}
          onLegalProcess={onLegalProcess}
          onViewHistory={onViewHistory}
          permissions={permissions}
          process={process}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1">
          <p className="text-[11px] font-semibold  text-muted-foreground">
            Localizacao
          </p>
          <p className="font-medium  text-foreground">
            {process.city} - {process.state}
          </p>
          <p className="text-sm  text-muted-foreground">
            {process.housingComplex}
          </p>
          <p className="text-xs  text-muted-foreground">{process.district}</p>
        </div>

        <div className="grid gap-2">
          <p className="text-[11px] font-semibold  text-muted-foreground">
            Etapa
          </p>
          <ProcessStatusBadge status={process.status} />
        </div>

        <div className="grid gap-1">
          <p className="text-[11px] font-semibold  text-muted-foreground">
            Processo juridico
          </p>
          <p className="font-semibold  text-foreground">
            {process.legalProcess.label}
          </p>
          <p className="text-sm  text-muted-foreground">
            {process.legalProcess.attorneyName
              ? `Responsavel: ${process.legalProcess.attorneyName}`
              : 'Sem responsavel juridico'}
          </p>
        </div>

        <div className="grid gap-1">
          <p className="text-[11px] font-semibold  text-muted-foreground">
            Ultima movimentacao
          </p>
          <ProcessLastMovement process={process} />
        </div>
      </div>
    </article>
  )
}
