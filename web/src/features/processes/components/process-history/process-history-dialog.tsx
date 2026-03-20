import { useInfiniteQuery } from '@tanstack/react-query'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  CheckCircle,
  Clock,
  FileText,
  Loader2,
  MessageSquare,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useRef } from 'react'
import { Skeleton } from '#/components/ui/skeleton'
import { AppDialog } from '@/shared/components/app-dialog'
import { formatDateTimeMedium } from '@/shared/lib/format'
import { processHistoryOptions } from '../../services/processes.queries'
import type { ProcessHistoryItem } from '../../services/processes.service'

type ProcessHistoryDialogProps = {
  onClose: () => void
  open: boolean
  processId: string
}

const eventConfig: Record<
  string,
  { icon: LucideIcon; color: string; label: string }
> = {
  CREATED: {
    icon: Plus,
    color: 'text-emerald-500 bg-emerald-500/10',
    label: 'Processo criado',
  },
  UPDATED: {
    icon: Pencil,
    color: 'text-blue-500 bg-blue-500/10',
    label: 'Dados atualizados',
  },
  STATUS_CHANGED: {
    icon: ArrowRight,
    color: 'text-primary bg-primary/10',
    label: 'Status alterado',
  },
  CANCELLED: {
    icon: XCircle,
    color: 'text-red-500 bg-red-500/10',
    label: 'Processo cancelado',
  },
  PDF_GENERATED: {
    icon: FileText,
    color: 'text-violet-500 bg-violet-500/10',
    label: 'PDF gerado',
  },
  DOCUMENT_UPLOADED: {
    icon: Upload,
    color: 'text-blue-500 bg-blue-500/10',
    label: 'Documento anexado',
  },
  DOCUMENT_REPLACED: {
    icon: RefreshCw,
    color: 'text-amber-500 bg-amber-500/10',
    label: 'Documento substituido',
  },
  DOCUMENT_DELETED: {
    icon: Trash2,
    color: 'text-red-500 bg-red-500/10',
    label: 'Documento removido',
  },
  DOCUMENT_MARKED_OK_WITHOUT_FILE: {
    icon: CheckCircle,
    color: 'text-emerald-500 bg-emerald-500/10',
    label: 'Documento marcado como ok',
  },
  DOCUMENT_UNMARKED_OK_WITHOUT_FILE: {
    icon: XCircle,
    color: 'text-amber-500 bg-amber-500/10',
    label: 'Ok sem arquivo desmarcado',
  },
  DOCUMENT_OBSERVATION_UPDATED: {
    icon: MessageSquare,
    color: 'text-blue-500 bg-blue-500/10',
    label: 'Observacao atualizada',
  },
}

const fallbackConfig = {
  icon: ArrowRight,
  color: 'text-muted-foreground bg-muted',
  label: 'Evento',
}

function getFieldLabel(field: string) {
  const labels: Record<string, string> = {
    fullName: 'Nome completo',
    birthDate: 'Data de nascimento',
    nationality: 'Nacionalidade',
    maritalStatus: 'Estado civil',
    profession: 'Profissao',
    ownerType: 'Tipo de proprietario',
    cpf: 'CPF',
    rg: 'RG',
    cadunico: 'CadUnico',
    propertyPaidOff: 'Imovel quitado',
    deliveredMoreThanTenYears: 'Entregue ha mais de 10 anos',
    purchaseAgreementLessThanTenYears: 'Contrato com menos de 10 anos',
    state: 'UF',
    city: 'Cidade',
    district: 'Bairro',
    housingComplex: 'Conjunto/Residencial',
    street: 'Rua/Logradouro',
    number: 'Numero',
    complement: 'Complemento',
    zipcode: 'CEP',
    email: 'E-mail',
    whatsapp: 'WhatsApp',
    witness1Id: 'Testemunha 1',
    witness2Id: 'Testemunha 2',
    observation: 'Observacao',
  }

  return labels[field] ?? field
}

function HistoryEntry({
  entry,
  isLast,
}: {
  entry: ProcessHistoryItem
  isLast: boolean
}) {
  const config = eventConfig[entry.eventType] ?? fallbackConfig
  const Icon = config.icon
  const changedFields = entry.changedFields as Record<
    string,
    { before: unknown; after: unknown }
  > | null

  return (
    <div className="relative flex gap-4">
      {/* Timeline line */}
      <div className="flex flex-col items-center">
        <div
          className={`flex size-9 shrink-0 items-center justify-center rounded-full ${config.color}`}
        >
          <Icon className="size-4" />
        </div>
        {!isLast ? <div className="mt-1 w-px flex-1 bg-border" /> : null}
      </div>

      {/* Content */}
      <div className="flex-1 pb-8">
        <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between">
          <p className="text-sm font-medium text-foreground">{config.label}</p>
          <time className="text-xs text-muted-foreground">
            {formatDateTimeMedium(entry.createdAt)}
          </time>
        </div>

        <p className="mt-0.5 text-sm text-muted-foreground">
          {entry.actor.name}
        </p>

        {entry.notes ? (
          <p className="mt-2 text-sm italic text-muted-foreground">
            {entry.notes}
          </p>
        ) : null}

        {changedFields && Object.keys(changedFields).length > 0 ? (
          <div className="mt-3 space-y-1.5 rounded-lg border border-border bg-muted/30 p-3">
            <p className="text-xs font-medium text-muted-foreground">
              Campos alterados
            </p>
            {Object.entries(changedFields).map(([field, change]) => (
              <div key={field} className="flex items-baseline gap-1 text-xs">
                <span className="font-medium text-foreground">
                  {getFieldLabel(field)}:
                </span>
                <span className="text-muted-foreground line-through">
                  {String(change.before || '—')}
                </span>
                <span className="text-foreground">
                  → {String(change.after || '—')}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function HistoryLoadingSkeleton() {
  return (
    <div className="space-y-6">
      {['skeleton-1', 'skeleton-2', 'skeleton-3'].map((id) => (
        <div className="flex gap-4" key={id}>
          <Skeleton className="size-9 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2 pt-1">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/4" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function ProcessHistoryDialog({
  onClose,
  open,
  processId,
}: ProcessHistoryDialogProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const query = useInfiniteQuery({
    ...processHistoryOptions(processId),
    enabled: open && !!processId,
  })

  const allItems = query.data?.pages.flatMap((page) => page.items) ?? []

  const handleScroll = useCallback(() => {
    const element = scrollRef.current

    if (!element || query.isFetchingNextPage || !query.hasNextPage) {
      return
    }

    const { scrollTop, scrollHeight, clientHeight } = element
    const distanceToBottom = scrollHeight - scrollTop - clientHeight

    if (distanceToBottom < 100) {
      void query.fetchNextPage()
    }
  }, [query])

  useEffect(() => {
    const element = scrollRef.current

    if (!element) {
      return
    }

    element.addEventListener('scroll', handleScroll)

    return () => {
      element.removeEventListener('scroll', handleScroll)
    }
  }, [handleScroll])

  return (
    <AppDialog
      description="Todos os eventos registrados para este processo."
      icon={Clock}
      maxWidth="2xl"
      onClose={onClose}
      open={open}
      title="Historico do processo"
      variant="info"
    >
      {query.isLoading ? (
        <HistoryLoadingSkeleton />
      ) : query.isError ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          Nao foi possivel carregar o historico.
        </div>
      ) : allItems.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          Nenhum evento registrado.
        </p>
      ) : (
        <div className="max-h-[60vh] overflow-y-auto pr-1" ref={scrollRef}>
          {allItems.map((entry, index) => (
            <HistoryEntry
              entry={entry}
              isLast={index === allItems.length - 1}
              key={entry.id}
            />
          ))}

          {query.isFetchingNextPage ? (
            <div className="flex justify-center py-4">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : null}
        </div>
      )}
    </AppDialog>
  )
}
