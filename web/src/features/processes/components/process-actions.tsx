import { Link } from '@tanstack/react-router'
import {
  CheckCircle,
  CheckSquare,
  Clock,
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
import type { ProcessListItem } from '../services/processes.service'

type ProcessActionsProps = {
  onCancel: (process: ProcessListItem) => void
  onFinalize: (process: ProcessListItem) => void
  onGeneratePdf: (processId: string) => void
  onLegalProcess: (process: ProcessListItem) => void
  onViewHistory: (processId: string) => void
  process: ProcessListItem
  userRole: string
}

const terminalStatuses = new Set(['FINALIZADO', 'CANCELADO'])
const legalRoles = new Set(['attorney', 'admin'])

export function ProcessActions({
  onCancel,
  onFinalize,
  onGeneratePdf,
  onLegalProcess,
  onViewHistory,
  process,
  userRole,
}: ProcessActionsProps) {
  const isTerminal = terminalStatuses.has(process.status)
  const canManageLegal = legalRoles.has(userRole)
  const canStartLegal =
    canManageLegal && process.status === 'DOCUMENTACAO_PRONTA'
  const canEditLegal = canManageLegal && process.status === 'EM_PROCESSO'
  const canFinalize = canManageLegal && process.status === 'EM_PROCESSO'
  const canCancel = !isTerminal
  const canEdit = !isTerminal

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
        ) : null}
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

        {canStartLegal || canEditLegal || canFinalize ? (
          <DropdownMenuSeparator />
        ) : null}

        {canStartLegal ? (
          <DropdownMenuItem onClick={() => onLegalProcess(process)}>
            <Gavel className="mr-2 size-4" />
            Iniciar processo
          </DropdownMenuItem>
        ) : null}
        {canEditLegal ? (
          <DropdownMenuItem onClick={() => onLegalProcess(process)}>
            <Gavel className="mr-2 size-4" />
            Editar processo juridico
          </DropdownMenuItem>
        ) : null}
        {canFinalize ? (
          <DropdownMenuItem onClick={() => onFinalize(process)}>
            <CheckCircle className="mr-2 size-4" />
            Finalizar processo
          </DropdownMenuItem>
        ) : null}

        <DropdownMenuSeparator />

        <DropdownMenuItem onClick={() => onGeneratePdf(process.id)}>
          <FileText className="mr-2 size-4" />
          Gerar PDF
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onViewHistory(process.id)}>
          <Clock className="mr-2 size-4" />
          Historico
        </DropdownMenuItem>

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
