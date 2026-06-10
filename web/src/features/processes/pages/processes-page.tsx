import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { Loader2, Plus, SlidersHorizontal } from 'lucide-react'
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
import { ProcessFilterChips } from '../components/process-filters/process-filter-chips'
import {
  ProcessFiltersSheet,
  type ProcessFiltersValue,
} from '../components/process-filters/process-filters-sheet'
import { FinalizeProcessDialog } from '../components/process-finalize/finalize-process-dialog'
import { ProcessHistoryDialog } from '../components/process-history/process-history-dialog'
import { ProcessLastMovement } from '../components/process-last-movement'
import { LegalProcessDialog } from '../components/process-legal/legal-process-dialog'
import { ProcessMobileCard } from '../components/process-mobile-card'
import { ScanProcessAction } from '../components/process-scan/scan-process-action'
import { ProcessStatusBadge } from '../components/process-status-badge'
import {
  canCreateProcess,
  canCreateProcessViaScan,
} from '../lib/process-access'
import { formatCpf } from '../process-form.utils'
import type { ProcessesSearch } from '../schemas/processes-search.schema'
import { housingComplexOptionsByIdsQuery } from '../services/housing-complexes.queries'
import { processListOptions } from '../services/processes.queries'
import {
  defaultProcessPageLimit,
  generateProcessPdfRequest,
  getProcessPdfModelsRequest,
  type OwnerTypeValue,
  type ProcessListItem,
  type ProcessStatusValue,
} from '../services/processes.service'

type ProcessesPageProps = {
  currentPage: number
  currentSearch: string
  currentStatuses: ProcessStatusValue[]
  currentOwnerTypes: OwnerTypeValue[]
  currentHousingComplexIds: string[]
  currentCreatedFrom?: string
  currentCreatedTo?: string
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
  currentStatuses,
  currentOwnerTypes,
  currentHousingComplexIds,
  currentCreatedFrom,
  currentCreatedTo,
}: ProcessesPageProps) {
  const { permissions } = useSession()
  const navigate = useNavigate()
  const [search, setSearch] = useState(currentSearch)
  const [filtersOpen, setFiltersOpen] = useState(false)
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
      statuses: currentStatuses,
      ownerTypes: currentOwnerTypes,
      housingComplexIds: currentHousingComplexIds,
      createdFrom: currentCreatedFrom,
      createdTo: currentCreatedTo,
    }),
  )

  // Resolve nomes dos conjuntos selecionados para exibir nos chips de filtro.
  const housingComplexChipsQuery = useQuery(
    housingComplexOptionsByIdsQuery(currentHousingComplexIds),
  )
  const housingComplexChips = (housingComplexChipsQuery.data?.items ?? []).map(
    (item) => ({ id: item.id, name: item.name }),
  )

  const data = query.data
  const total = data?.pagination.total ?? 0

  const activeFilterCount =
    currentStatuses.length +
    currentOwnerTypes.length +
    currentHousingComplexIds.length +
    (currentCreatedFrom || currentCreatedTo ? 1 : 0)

  // Monta o objeto de search da URL a partir do estado atual + overrides,
  // descartando valores vazios para manter a URL limpa.
  function buildSearch(overrides: Partial<ProcessesSearch>): ProcessesSearch {
    const merged: ProcessesSearch = {
      page: currentPage,
      ...(currentSearch ? { search: currentSearch } : {}),
      ...(currentStatuses.length ? { statuses: currentStatuses } : {}),
      ...(currentOwnerTypes.length ? { ownerTypes: currentOwnerTypes } : {}),
      ...(currentHousingComplexIds.length
        ? { housingComplexIds: currentHousingComplexIds }
        : {}),
      ...(currentCreatedFrom ? { createdFrom: currentCreatedFrom } : {}),
      ...(currentCreatedTo ? { createdTo: currentCreatedTo } : {}),
      ...overrides,
    }

    const next: ProcessesSearch = { page: merged.page ?? 1 }
    if (merged.search) next.search = merged.search
    if (merged.statuses?.length) next.statuses = merged.statuses
    if (merged.ownerTypes?.length) next.ownerTypes = merged.ownerTypes
    if (merged.housingComplexIds?.length)
      next.housingComplexIds = merged.housingComplexIds
    if (merged.createdFrom) next.createdFrom = merged.createdFrom
    if (merged.createdTo) next.createdTo = merged.createdTo

    return next
  }

  function handleApplyFilters(value: ProcessFiltersValue) {
    void navigate({
      to: '/processos',
      search: buildSearch({
        statuses: value.statuses,
        ownerTypes: value.ownerTypes,
        housingComplexIds: value.housingComplexIds,
        createdFrom: value.createdFrom,
        createdTo: value.createdTo,
        page: 1,
      }),
    })
  }

  function handleRemoveStatus(status: ProcessStatusValue) {
    void navigate({
      to: '/processos',
      search: buildSearch({
        statuses: currentStatuses.filter((item) => item !== status),
        page: 1,
      }),
    })
  }

  function handleRemoveOwnerType(ownerType: OwnerTypeValue) {
    void navigate({
      to: '/processos',
      search: buildSearch({
        ownerTypes: currentOwnerTypes.filter((item) => item !== ownerType),
        page: 1,
      }),
    })
  }

  function handleRemoveHousingComplex(id: string) {
    void navigate({
      to: '/processos',
      search: buildSearch({
        housingComplexIds: currentHousingComplexIds.filter(
          (item) => item !== id,
        ),
        page: 1,
      }),
    })
  }

  function handleRemovePeriod() {
    void navigate({
      to: '/processos',
      search: buildSearch({
        createdFrom: undefined,
        createdTo: undefined,
        page: 1,
      }),
    })
  }

  function handleClearAllFilters() {
    void navigate({
      to: '/processos',
      search: buildSearch({
        statuses: [],
        ownerTypes: [],
        housingComplexIds: [],
        createdFrom: undefined,
        createdTo: undefined,
        page: 1,
      }),
    })
  }

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
        search: buildSearch({ search: value || undefined, page: 1 }),
        to: '/processos',
      })
    }
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="Processos">
        {canCreateProcess(permissions) ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {canCreateProcessViaScan(permissions) ? (
              <ScanProcessAction />
            ) : null}
            <Link
              className="hidden no-underline sm:block sm:w-auto"
              preload={false}
              to="/processos/novo"
            >
              <Button className="w-full sm:w-auto">
                <Plus className="size-4" />
                Criar processo
              </Button>
            </Link>
          </div>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <SearchInput
          containerClassName="w-full sm:max-w-sm"
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Buscar por nome, CPF ou localizacao..."
          value={search}
        />

        <Button
          className="w-full sm:w-auto"
          onClick={() => setFiltersOpen(true)}
          type="button"
          variant="outline"
        >
          <SlidersHorizontal className="size-4" />
          Filtros
          {activeFilterCount > 0 ? (
            <Badge className="ml-1" variant="secondary">
              {activeFilterCount}
            </Badge>
          ) : null}
        </Button>
      </div>

      <ProcessFilterChips
        createdFrom={currentCreatedFrom}
        createdTo={currentCreatedTo}
        housingComplexes={housingComplexChips}
        onClearAll={handleClearAllFilters}
        onRemoveHousingComplex={handleRemoveHousingComplex}
        onRemoveOwnerType={handleRemoveOwnerType}
        onRemovePeriod={handleRemovePeriod}
        onRemoveStatus={handleRemoveStatus}
        ownerTypes={currentOwnerTypes}
        statuses={currentStatuses}
      />

      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {query.isFetching ? <Loader2 className="size-4 animate-spin" /> : null}
        <span>{total} registro(s) encontrado(s)</span>
      </div>

      <ProcessFiltersSheet
        onApply={handleApplyFilters}
        onOpenChange={setFiltersOpen}
        open={filtersOpen}
        value={{
          statuses: currentStatuses,
          ownerTypes: currentOwnerTypes,
          housingComplexIds: currentHousingComplexIds,
          createdFrom: currentCreatedFrom,
          createdTo: currentCreatedTo,
        }}
      />

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
                  search: buildSearch({ page: nextPage }),
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
