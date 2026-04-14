import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, Plus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { useSession } from '@/features/auth/hooks/use-session'
import { PageHeader } from '@/shared/components/page-header'
import { SearchInput } from '@/shared/components/search-input'
import {
  DataTable,
  type DataTableColumn,
} from '@/shared/components/ui/data-table'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { downloadFile } from '@/shared/lib/download'
import { ProcessActions } from '../components/process-actions'
import { CancelProcessDialog } from '../components/process-cancel/cancel-process-dialog'
import { FinalizeProcessDialog } from '../components/process-finalize/finalize-process-dialog'
import { ProcessHistoryDialog } from '../components/process-history/process-history-dialog'
import { ProcessLastMovement } from '../components/process-last-movement'
import { LegalProcessDialog } from '../components/process-legal/legal-process-dialog'
import { ProcessMobileCard } from '../components/process-mobile-card'
import { ProcessStatusBadge } from '../components/process-status-badge'
import { canCreateProcess } from '../lib/process-access'
import { formatCpf } from '../process-form.utils'
import { processListOptions } from '../services/processes.queries'
import {
  defaultProcessPageLimit,
  generateProcessPdfRequest,
  getProcessPdfModelsRequest,
  type ProcessListItem,
} from '../services/processes.service'

type ProcessesPageProps = {
  currentPage: number
  currentSearch: string
}

const processTableColumns: readonly DataTableColumn<ProcessListItem>[] = [
  {
    cellClassName: 'min-w-[18rem]',
    header: 'Nome / CPF',
    id: 'identity',
    render: (process) => (
      <div className="grid gap-2">
        <p className="font-semibold  text-foreground">{process.fullName}</p>
        <Badge variant="secondary" className="w-fit ">
          {formatCpf(process.cpf)}
        </Badge>
      </div>
    ),
  },
  {
    cellClassName: 'min-w-[14rem]',
    header: 'Localizacao',
    id: 'location',
    render: (process) => (
      <div className="grid gap-1">
        <p className="font-medium  text-foreground">
          {process.city} - {process.state}
        </p>
        <p className="text-sm  text-muted-foreground">
          {process.housingComplex}
        </p>
        <p className="text-xs  text-muted-foreground">{process.district}</p>
      </div>
    ),
  },
  {
    cellClassName: 'min-w-[11rem]',
    header: 'Etapa',
    id: 'status',
    render: (process) => <ProcessStatusBadge status={process.status} />,
  },
  {
    cellClassName: 'min-w-[14rem]',
    header: 'Processo juridico',
    id: 'legal-process',
    render: (process) => (
      <div className="grid gap-1">
        <p className="font-semibold  text-foreground">
          {process.legalProcess.label}
        </p>
        <p className="text-sm  text-muted-foreground">
          {process.legalProcess.attorneyName
            ? `Responsavel: ${process.legalProcess.attorneyName}`
            : 'Sem responsavel juridico'}
        </p>
      </div>
    ),
  },
  {
    cellClassName: 'min-w-[16rem]',
    header: 'Ultima movimentacao',
    id: 'last-movement',
    render: (process) => <ProcessLastMovement process={process} />,
  },
] as const

export function ProcessesPage({
  currentPage,
  currentSearch,
}: ProcessesPageProps) {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const [search, setSearch] = useState(currentSearch)
  const [historyProcessId, setHistoryProcessId] = useState<string | null>(null)
  const [cancelTarget, setCancelTarget] = useState<ProcessListItem | null>(null)
  const [legalTarget, setLegalTarget] = useState<ProcessListItem | null>(null)
  const [finalizeTarget, setFinalizeTarget] = useState<ProcessListItem | null>(
    null,
  )
  const debouncedSearch = useDebouncedValue(search)

  const query = useQuery(
    processListOptions({
      limit: defaultProcessPageLimit,
      page: currentPage,
      search: debouncedSearch,
    }),
  )

  const data = query.data
  const total = data?.pagination.total ?? 0

  async function handleGeneratePdf(processId: string) {
    try {
      const models = await getProcessPdfModelsRequest(processId)
      const firstModel = models.items[0]

      if (!firstModel) {
        toast.error('Nenhum modelo de PDF disponivel.')
        return
      }

      const result = await generateProcessPdfRequest({
        processId,
        modelKey: firstModel.key,
      })

      await downloadFile(result.document.downloadUrl, result.document.fileName)
      toast.success('PDF gerado com sucesso.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel gerar o PDF.',
      )
    }
  }

  function handleSearchChange(value: string) {
    setSearch(value)

    if (value !== currentSearch) {
      void navigate({
        replace: true,
        search: {
          ...(value ? { search: value } : {}),
          page: 1,
        },
        to: '/processos',
      })
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Processos">
        {canCreateProcess(permissions) ? (
          <Link className="no-underline" preload={false} to="/processos/novo">
            <Button>
              <Plus className="size-4" />
              Criar processo
            </Button>
          </Link>
        ) : null}
      </PageHeader>

      <SearchInput
        containerClassName="w-full sm:max-w-sm"
        onChange={(event) => handleSearchChange(event.target.value)}
        placeholder="Buscar por nome, CPF ou localizacao..."
        value={search}
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {query.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
        <span>{total} registro(s) encontrado(s)</span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <DataTable
            ariaLabel="Tabela de processos"
            columns={[
              ...processTableColumns,
              {
                cellClassName: 'text-right',
                header: 'Acoes',
                headerClassName: 'text-right',
                id: 'actions',
                render: (process: ProcessListItem) => (
                  <ProcessActions
                    onCancel={setCancelTarget}
                    onFinalize={setFinalizeTarget}
                    onGeneratePdf={(id) => void handleGeneratePdf(id)}
                    onLegalProcess={setLegalTarget}
                    onViewHistory={setHistoryProcessId}
                    permissions={permissions}
                    process={process}
                  />
                ),
              },
            ]}
            emptyState={
              <div className="mt-5 rounded-lg border border-dashed border-border bg-muted/35 px-5 py-10 text-center">
                <p className="text-lg font-semibold text-foreground">
                  Nenhum processo encontrado
                </p>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Ajuste a busca ou crie o primeiro processo para iniciar o
                  fluxo.
                </p>
              </div>
            }
            getItemKey={(process) => process.id}
            items={data?.items ?? []}
            pagination={{
              itemLabel: 'processos',
              onPageChange: (nextPage) => {
                void navigate({
                  search: {
                    ...(currentSearch ? { search: currentSearch } : {}),
                    page: nextPage,
                  },
                  to: '/processos',
                })
              },
              page: currentPage,
              pageSize: defaultProcessPageLimit,
              total,
            }}
            renderMobileCard={(process) => (
              <ProcessMobileCard
                onCancel={setCancelTarget}
                onFinalize={setFinalizeTarget}
                onGeneratePdf={(id) => void handleGeneratePdf(id)}
                onLegalProcess={setLegalTarget}
                onViewHistory={setHistoryProcessId}
                permissions={permissions}
                process={process}
              />
            )}
          />
        </CardContent>
      </Card>

      {historyProcessId ? (
        <ProcessHistoryDialog
          onClose={() => setHistoryProcessId(null)}
          open={!!historyProcessId}
          processId={historyProcessId}
        />
      ) : null}

      {cancelTarget ? (
        <CancelProcessDialog
          onClose={() => setCancelTarget(null)}
          open={!!cancelTarget}
          processId={cancelTarget.id}
          processName={cancelTarget.fullName}
        />
      ) : null}

      {finalizeTarget ? (
        <FinalizeProcessDialog
          onClose={() => setFinalizeTarget(null)}
          open={!!finalizeTarget}
          processId={finalizeTarget.id}
          processName={finalizeTarget.fullName}
        />
      ) : null}

      {legalTarget ? (
        <LegalProcessDialog
          initialValues={
            legalTarget.status === 'EM_PROCESSO'
              ? {
                  legalProcessNumber: legalTarget.legalProcess.number ?? null,
                  causeValue: legalTarget.legalProcess.causeValue ?? null,
                  protocolDate: legalTarget.legalProcess.protocolDate ?? null,
                }
              : undefined
          }
          mode={legalTarget.status === 'DOCUMENTACAO_PRONTA' ? 'start' : 'edit'}
          onClose={() => setLegalTarget(null)}
          open={!!legalTarget}
          processId={legalTarget.id}
          processInfo={`${legalTarget.fullName} - CPF: ${formatCpf(legalTarget.cpf)}`}
        />
      ) : null}
    </div>
  )
}
