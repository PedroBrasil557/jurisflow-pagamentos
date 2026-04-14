import { Link } from '@tanstack/react-router'
import {
  CheckCircle,
  CheckSquare,
  Clock,
  Eye,
  FileText,
  Gavel,
  MoreVertical,
  Pencil,
  XCircle,
} from 'lucide-react'
import { Button } from '#/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '#/components/ui/dropdown-menu'
import type { ResolvedPermissions } from '@/features/permissions/services/permissions.service'
import {
  canAccessChecklist,
  canAccessHistory,
  canCancelProcess,
  canEditLegal,
  canEditProcess,
  canFinalizeProcess,
  canGeneratePdf,
  canStartLegal,
  canViewProcessDetails,
} from '../lib/process-access'
import type { ProcessListItem } from '../services/processes.service'

type ProcessActionsProps = {
  onCancel: (process: ProcessListItem) => void
  onFinalize: (process: ProcessListItem) => void
  onGeneratePdf: (processId: string) => void
  onLegalProcess: (process: ProcessListItem) => void
  onViewHistory: (processId: string) => void
  permissions: ResolvedPermissions
  process: ProcessListItem
}

const terminalStatuses = new Set(['FINALIZADO', 'CANCELADO'])

export function ProcessActions({
  onCancel,
  onFinalize,
  onGeneratePdf,
  onLegalProcess,
  onViewHistory,
  permissions,
  process,
}: ProcessActionsProps) {
  const isTerminal = terminalStatuses.has(process.status)
  const relationship = process.relationship
  const canEdit = !isTerminal && canEditProcess(permissions, relationship)
  const canViewDetails =
    !canEdit && canViewProcessDetails(permissions, relationship)
  const canOpenChecklist = canAccessChecklist(permissions, relationship)
  const canStartLegalAction =
    process.status === 'DOCUMENTACAO_PRONTA' &&
    canStartLegal(permissions, relationship)
  const canEditLegalAction =
    process.status === 'EM_PROCESSO' && canEditLegal(permissions, relationship)
  const canFinalizeAction =
    process.status === 'EM_PROCESSO' &&
    canFinalizeProcess(permissions, relationship)
  const canGeneratePdfAction = canGeneratePdf(permissions, relationship)
  const canViewHistoryAction = canAccessHistory(permissions, relationship)
  const canCancel = !isTerminal && canCancelProcess(permissions, relationship)

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label="Abrir acoes do processo"
          size="icon-sm"
          variant="ghost"
        >
          <MoreVertical className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canEdit ? (
          <DropdownMenuItem asChild>
            <Link
              className="no-underline"
              params={{ processId: process.id }}
              preload={false}
              to="/processos/$processId/editar"
            >
              <Pencil className="mr-2 size-4" />
              Editar
            </Link>
          </DropdownMenuItem>
        ) : canViewDetails ? (
          <DropdownMenuItem asChild>
            <Link
              className="no-underline"
              params={{ processId: process.id }}
              preload={false}
              to="/processos/$processId/editar"
            >
              <Eye className="mr-2 size-4" />
              Ver detalhes
            </Link>
          </DropdownMenuItem>
        ) : null}
        {canOpenChecklist ? (
          <DropdownMenuItem asChild>
            <Link
              className="no-underline"
              params={{ processId: process.id }}
              preload={false}
              to="/processos/$processId/checklist"
            >
              <CheckSquare className="mr-2 size-4" />
              Checklist
            </Link>
          </DropdownMenuItem>
        ) : null}

        {canStartLegalAction || canEditLegalAction || canFinalizeAction ? (
          <DropdownMenuSeparator />
        ) : null}

        {canStartLegalAction ? (
          <DropdownMenuItem onClick={() => onLegalProcess(process)}>
            <Gavel className="mr-2 size-4" />
            Iniciar processo
          </DropdownMenuItem>
        ) : null}
        {canEditLegalAction ? (
          <DropdownMenuItem onClick={() => onLegalProcess(process)}>
            <Gavel className="mr-2 size-4" />
            Editar processo juridico
          </DropdownMenuItem>
        ) : null}
        {canFinalizeAction ? (
          <DropdownMenuItem onClick={() => onFinalize(process)}>
            <CheckCircle className="mr-2 size-4" />
            Finalizar processo
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        {canGeneratePdfAction ? (
          <DropdownMenuItem onClick={() => onGeneratePdf(process.id)}>
            <FileText className="mr-2 size-4" />
            Gerar PDF
          </DropdownMenuItem>
        ) : null}
        {canViewHistoryAction ? (
          <DropdownMenuItem onClick={() => onViewHistory(process.id)}>
            <Clock className="mr-2 size-4" />
            Historico
          </DropdownMenuItem>
        ) : null}

        {canCancel ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => onCancel(process)}
            >
              <XCircle className="mr-2 size-4" />
              Cancelar
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
