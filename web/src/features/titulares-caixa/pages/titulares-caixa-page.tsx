import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Building2,
  Contact,
  Download,
  Eye,
  FileDown,
  FileSpreadsheet,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Badge } from '#/components/ui/badge'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '#/components/ui/select'
import { canManageConjuntos } from '@/features/admin/lib/cadastros-access'
import { useSession } from '@/features/auth/hooks/use-session'
import { AppDialog, DialogFooter } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { PdfViewer } from '@/shared/components/pdf-viewer/pdf-viewer'
import { QueryError } from '@/shared/components/query-error'
import { SearchInput } from '@/shared/components/search-input'
import { SearchableMultiSelect } from '@/shared/components/searchable-multi-select'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  DataTable,
  type DataTableColumn,
} from '@/shared/components/ui/data-table'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import { LinkConjuntoDialog } from '../components/link-conjunto-dialog'
import { TerceiroDialog } from '../components/terceiro-dialog'
import {
  canExportTitulares,
  canImportTitulares,
  canReconsultarTitulares,
} from '../lib/titulares-access'
import type { TitularesSearch } from '../schemas/titulares-caixa-search.schema'
import {
  useBulkLinkConjunto,
  useImportTitulares,
  useReconsultarTitulares,
} from '../services/titulares-caixa.mutations'
import {
  conjuntoOptionsQuery,
  empreendimentoOptionsQuery,
  logradouroOptionsQuery,
  titularDocumentPreviewUrlQuery,
  titularListOptions,
} from '../services/titulares-caixa.queries'
import {
  defaultTitularesPageLimit,
  type TitularAverbacao,
  type TitularesFilter,
  type TitularListItem,
  type TitularQuitacaoStatus,
  titularAverbacaoLabels,
  titularAverbacaoValues,
  titularDocumentDownloadUrl,
  titularesExportUrl,
  titularQuitacaoStatuses,
  titularQuitacaoStatusLabels,
} from '../services/titulares-caixa.service'

type StatusTone = 'error' | 'ghost' | 'info' | 'success' | 'warning'

const quitacaoTone: Record<TitularQuitacaoStatus, StatusTone> = {
  idle: 'ghost',
  pending: 'info',
  quitado: 'success',
  nao_encontrado: 'warning',
  erro: 'error',
}

const averbacaoTone: Record<TitularAverbacao, StatusTone> = {
  sim: 'success',
  nao: 'ghost',
  indeterminado: 'warning',
}

function formatCpf(cpf: string) {
  const d = cpf.replace(/\D/g, '')
  return d.length === 11
    ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
    : cpf
}

function formatDate(value: string | null) {
  if (!value) return '—'
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : value
}

type TitularesCaixaPageProps = {
  currentPage: number
  currentSearch: string
  currentUf: string[]
  currentMunicipio: string
  currentModalidade: string[]
  currentEmpreendimento: string[]
  currentConjuntoIds: string[]
  currentLogradouros: string[]
  currentQuitacaoStatuses: TitularQuitacaoStatus[]
  currentAverbacoes: TitularAverbacao[]
  currentTerceiro?: 'com' | 'sem'
  currentAssinaturaFrom?: string
  currentAssinaturaTo?: string
}

export function TitularesCaixaPage({
  currentPage,
  currentSearch,
  currentUf,
  currentMunicipio,
  currentModalidade,
  currentEmpreendimento,
  currentConjuntoIds,
  currentLogradouros,
  currentQuitacaoStatuses,
  currentAverbacoes,
  currentTerceiro,
  currentAssinaturaFrom,
  currentAssinaturaTo,
}: TitularesCaixaPageProps) {
  const navigate = useNavigate()
  const { permissions } = useSession()
  const allowExport = canExportTitulares(permissions)
  const allowImport = canImportTitulares(permissions)
  const allowReconsultar = canReconsultarTitulares(permissions)
  const allowLinkConjunto = canManageConjuntos(permissions)
  const [search, setSearch] = useState(currentSearch)
  const debouncedSearch = useDebouncedValue(search)

  const [importOpen, setImportOpen] = useState(false)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [previewDoc, setPreviewDoc] = useState<{
    id: string
    docId: string
    nome: string
  } | null>(null)
  // Vinculo de conjunto e SEMPRE em lote (selecao por ids ou "todos do filtro");
  // o alvo resolve ids-vs-filtro na hora do envio.
  const [bulkLinkOpen, setBulkLinkOpen] = useState(false)
  const [terceiroTarget, setTerceiroTarget] = useState<TitularListItem | null>(
    null,
  )
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [allFiltered, setAllFiltered] = useState(false)

  const importMutation = useImportTitulares()
  const reconsultarMutation = useReconsultarTitulares()
  const bulkLinkMutation = useBulkLinkConjunto()

  const query = useQuery(
    titularListOptions({
      limit: defaultTitularesPageLimit,
      page: currentPage,
      search: debouncedSearch || undefined,
      uf: currentUf.length ? currentUf : undefined,
      municipio: currentMunicipio || undefined,
      modalidade: currentModalidade.length ? currentModalidade : undefined,
      empreendimento: currentEmpreendimento.length
        ? currentEmpreendimento
        : undefined,
      conjuntoIds: currentConjuntoIds.length ? currentConjuntoIds : undefined,
      logradouros: currentLogradouros.length ? currentLogradouros : undefined,
      quitacaoStatuses: currentQuitacaoStatuses.length
        ? currentQuitacaoStatuses
        : undefined,
      averbacoes: currentAverbacoes.length ? currentAverbacoes : undefined,
      terceiro: currentTerceiro,
      assinaturaFrom: currentAssinaturaFrom,
      assinaturaTo: currentAssinaturaTo,
    }),
  )

  const data = query.data
  const total = data?.pagination.total ?? 0
  const items = data?.items ?? []

  // Filtro atual (sem page/limit) — reusado no export e no vinculo "todos do filtro".
  const currentFilter: TitularesFilter = {
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(currentUf.length ? { uf: currentUf } : {}),
    ...(currentMunicipio ? { municipio: currentMunicipio } : {}),
    ...(currentModalidade.length ? { modalidade: currentModalidade } : {}),
    ...(currentEmpreendimento.length
      ? { empreendimento: currentEmpreendimento }
      : {}),
    ...(currentConjuntoIds.length ? { conjuntoIds: currentConjuntoIds } : {}),
    ...(currentLogradouros.length ? { logradouros: currentLogradouros } : {}),
    ...(currentQuitacaoStatuses.length
      ? { quitacaoStatuses: currentQuitacaoStatuses }
      : {}),
    ...(currentAverbacoes.length ? { averbacoes: currentAverbacoes } : {}),
    ...(currentTerceiro ? { terceiro: currentTerceiro } : {}),
    ...(currentAssinaturaFrom ? { assinaturaFrom: currentAssinaturaFrom } : {}),
    ...(currentAssinaturaTo ? { assinaturaTo: currentAssinaturaTo } : {}),
  }

  // Selecao (checkbox por linha + "todos do filtro"). Reseta quando o FILTRO muda —
  // padrao React de ajustar estado durante o render (guardando o valor anterior),
  // preferivel a um useEffect.
  const filterKey = JSON.stringify(currentFilter)
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey)
  if (filterKey !== prevFilterKey) {
    setPrevFilterKey(filterKey)
    setSelectedIds(new Set())
    setAllFiltered(false)
  }

  const pageIds = items.map((t) => t.id)
  const allPageSelected =
    pageIds.length > 0 &&
    pageIds.every((id) => allFiltered || selectedIds.has(id))
  const selectionCount = allFiltered ? total : selectedIds.size
  const hasSelection = allFiltered || selectedIds.size > 0

  function clearSelection() {
    setSelectedIds(new Set())
    setAllFiltered(false)
  }

  function isRowSelected(id: string) {
    return allFiltered || selectedIds.has(id)
  }

  function toggleRow(id: string) {
    if (allFiltered) {
      // Sair do "todos": vira selecao explicita da pagina menos este id.
      setAllFiltered(false)
      setSelectedIds(new Set(pageIds.filter((x) => x !== id)))
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  function toggleAllPage() {
    if (allFiltered) {
      clearSelection()
      return
    }
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allPageSelected) {
        for (const id of pageIds) next.delete(id)
      } else {
        for (const id of pageIds) next.add(id)
      }
      return next
    })
  }

  function handleLink(housingComplexId: string | null) {
    const payload = allFiltered
      ? { housingComplexId, filter: currentFilter }
      : { housingComplexId, ids: [...selectedIds] }
    bulkLinkMutation.mutate(payload, {
      onSuccess: (result) => {
        toast.success(
          result.conjuntoNome
            ? `${result.linked} titular(es) vinculado(s) a ${result.conjuntoNome}.`
            : `${result.linked} titular(es) desvinculado(s).`,
        )
        clearSelection()
        setBulkLinkOpen(false)
      },
    })
  }

  function buildSearch(overrides: Partial<TitularesSearch>): TitularesSearch {
    const merged: TitularesSearch = {
      page: currentPage,
      ...(currentSearch ? { search: currentSearch } : {}),
      ...(currentUf.length ? { uf: currentUf } : {}),
      ...(currentMunicipio ? { municipio: currentMunicipio } : {}),
      ...(currentModalidade.length ? { modalidade: currentModalidade } : {}),
      ...(currentEmpreendimento.length
        ? { empreendimento: currentEmpreendimento }
        : {}),
      ...(currentConjuntoIds.length ? { conjuntoIds: currentConjuntoIds } : {}),
      ...(currentLogradouros.length ? { logradouros: currentLogradouros } : {}),
      ...(currentQuitacaoStatuses.length
        ? { quitacaoStatuses: currentQuitacaoStatuses }
        : {}),
      ...(currentAverbacoes.length ? { averbacoes: currentAverbacoes } : {}),
      ...(currentTerceiro ? { terceiro: currentTerceiro } : {}),
      ...(currentAssinaturaFrom
        ? { assinaturaFrom: currentAssinaturaFrom }
        : {}),
      ...(currentAssinaturaTo ? { assinaturaTo: currentAssinaturaTo } : {}),
      ...overrides,
    }
    const next: TitularesSearch = { page: merged.page ?? 1 }
    if (merged.search) next.search = merged.search
    if (merged.uf?.length) next.uf = merged.uf
    if (merged.municipio) next.municipio = merged.municipio
    if (merged.modalidade?.length) next.modalidade = merged.modalidade
    if (merged.empreendimento?.length)
      next.empreendimento = merged.empreendimento
    if (merged.conjuntoIds?.length) next.conjuntoIds = merged.conjuntoIds
    if (merged.logradouros?.length) next.logradouros = merged.logradouros
    if (merged.quitacaoStatuses?.length)
      next.quitacaoStatuses = merged.quitacaoStatuses
    if (merged.averbacoes?.length) next.averbacoes = merged.averbacoes
    if (merged.terceiro) next.terceiro = merged.terceiro
    if (merged.assinaturaFrom) next.assinaturaFrom = merged.assinaturaFrom
    if (merged.assinaturaTo) next.assinaturaTo = merged.assinaturaTo
    return next
  }

  function apply(overrides: Partial<TitularesSearch>) {
    void navigate({ to: '/titulares-caixa', search: buildSearch(overrides) })
  }

  function handleSearchChange(value: string) {
    setSearch(value)
    if (value !== currentSearch) {
      void navigate({
        to: '/titulares-caixa',
        replace: true,
        search: buildSearch({ search: value || undefined, page: 1 }),
      })
    }
  }

  function handleImport() {
    if (!selectedFile) return
    importMutation.mutate(selectedFile, {
      onSuccess: (result) => {
        toast.success(
          `${result.inserted} inseridos · ${result.updated} atualizados · ${result.skipped} ignorados`,
        )
        setImportOpen(false)
        setSelectedFile(null)
      },
    })
  }

  function handleReconsultar(id: string) {
    reconsultarMutation.mutate([id], {
      onSuccess: () => toast.success('Reconsulta enfileirada.'),
    })
  }

  function handleExport() {
    const url = titularesExportUrl(currentFilter)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.rel = 'noreferrer'
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
  }

  const activeFilterCount =
    currentUf.length +
    (currentMunicipio ? 1 : 0) +
    currentModalidade.length +
    currentEmpreendimento.length +
    currentConjuntoIds.length +
    currentLogradouros.length +
    currentQuitacaoStatuses.length +
    currentAverbacoes.length +
    (currentTerceiro ? 1 : 0) +
    (currentAssinaturaFrom ? 1 : 0) +
    (currentAssinaturaTo ? 1 : 0)

  const selectColumn: DataTableColumn<TitularListItem> = {
    id: 'select',
    cellClassName: 'w-10',
    header: (
      <Checkbox
        aria-label="Selecionar todos da pagina"
        checked={allPageSelected}
        onCheckedChange={toggleAllPage}
      />
    ),
    render: (t) => (
      <Checkbox
        aria-label="Selecionar titular"
        checked={isRowSelected(t.id)}
        // Em "todos do filtro" a selecao é cross-pagina; desmarcar 1 linha aqui
        // colapsaria para a pagina atual. Trava o toggle por linha — use "Limpar".
        disabled={allFiltered}
        onCheckedChange={() => toggleRow(t.id)}
      />
    ),
  }

  const baseColumns: readonly DataTableColumn<TitularListItem>[] = [
    {
      id: 'identity',
      header: 'Nome / CPF',
      cellClassName: 'min-w-[16rem]',
      render: (t) => (
        <div className="grid gap-1">
          <p className="font-semibold">{t.mutuarioNome}</p>
          <Badge variant="outline" className="w-fit font-normal">
            {formatCpf(t.cpf)}
          </Badge>
        </div>
      ),
    },
    {
      id: 'empreendimento',
      header: 'Empreendimento',
      cellClassName: 'min-w-[12rem]',
      render: (t) => {
        const endereco = [t.logradouro, t.complemento]
          .filter((v) => v?.trim())
          .join(' - ')
        return (
          <div className="grid gap-1">
            <p>{t.empreendimento}</p>
            {endereco ? (
              <p className="text-sm text-muted-foreground">{endereco}</p>
            ) : null}
            {t.conjuntoNome ? (
              <Badge variant="outline" className="w-fit font-normal">
                {t.conjuntoNome}
              </Badge>
            ) : (
              <span className="text-xs text-muted-foreground">
                Sem conjunto
              </span>
            )}
          </div>
        )
      },
    },
    {
      id: 'local',
      header: 'Local',
      render: (t) => (
        <div className="grid gap-0.5">
          <p>
            {t.municipio} - {t.uf}
          </p>
          {t.bairro ? (
            <p className="text-sm text-muted-foreground">{t.bairro}</p>
          ) : null}
        </div>
      ),
    },
    {
      id: 'assinatura',
      header: 'Assinatura',
      render: (t) => (
        <span className="text-sm">{formatDate(t.dataAssinatura)}</span>
      ),
    },
    {
      id: 'quitacao',
      header: 'Quitacao',
      render: (t) => (
        <StatusBadge tone={quitacaoTone[t.quitacaoStatus]}>
          {titularQuitacaoStatusLabels[t.quitacaoStatus]}
        </StatusBadge>
      ),
    },
    {
      id: 'averbacao',
      header: 'Averbacao',
      render: (t) =>
        t.averbacao ? (
          <StatusBadge tone={averbacaoTone[t.averbacao]}>
            {titularAverbacaoLabels[t.averbacao]}
          </StatusBadge>
        ) : (
          <span className="text-muted-foreground">—</span>
        ),
    },
    {
      id: 'actions',
      header: 'Acoes',
      headerClassName: 'text-right',
      cellClassName: 'text-right',
      render: (t) => {
        const termoDocId = t.termoDocId
        return (
          <div className="flex items-center justify-end gap-2">
            {termoDocId ? (
              <>
                <Button
                  onClick={() =>
                    setPreviewDoc({
                      id: t.id,
                      docId: termoDocId,
                      nome: t.mutuarioNome,
                    })
                  }
                  size="sm"
                  variant="outline"
                >
                  <Eye className="size-4" />
                  Ver termo
                </Button>
                <Button asChild size="sm" variant="ghost">
                  <a
                    href={titularDocumentDownloadUrl(t.id, termoDocId)}
                    rel="noreferrer"
                  >
                    <Download className="size-4" />
                    Baixar
                  </a>
                </Button>
              </>
            ) : null}
            {allowReconsultar ? (
              <Button
                disabled={reconsultarMutation.isPending}
                onClick={() => handleReconsultar(t.id)}
                size="sm"
                variant="ghost"
              >
                <RefreshCw className="size-4" />
                Reconsultar
              </Button>
            ) : null}
            <Button
              onClick={() => setTerceiroTarget(t)}
              size="sm"
              variant={t.terceiroId ? 'outline' : 'ghost'}
            >
              <Contact className="size-4" />
              Terceiro
            </Button>
          </div>
        )
      },
    },
  ]

  // Coluna de selecao so quando o usuario pode vincular conjuntos.
  const columns = allowLinkConjunto
    ? [selectColumn, ...baseColumns]
    : baseColumns

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Titulares Caixa"
        description="Cadastro de titulares de contrato Caixa e consulta de quitacao"
      >
        {allowExport ? (
          <Button onClick={handleExport} variant="outline">
            <FileDown className="size-4" />
            Exportar
          </Button>
        ) : null}
        {allowImport ? (
          <Button onClick={() => setImportOpen(true)}>
            <Upload className="size-4" />
            Importar planilha
          </Button>
        ) : null}
      </PageHeader>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          containerClassName="w-full sm:max-w-sm"
          onChange={(event) => handleSearchChange(event.target.value)}
          placeholder="Buscar por nome ou CPF..."
          value={search}
        />
        <Button
          className="w-fit"
          onClick={() => setFiltersOpen(true)}
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
        {activeFilterCount > 0 ? (
          <Button
            className="w-fit text-muted-foreground"
            onClick={() =>
              void navigate({
                to: '/titulares-caixa',
                search: { page: 1 },
              })
            }
            size="sm"
            variant="ghost"
          >
            <X className="size-4" />
            Limpar filtros
          </Button>
        ) : null}
      </div>

      {allowLinkConjunto && hasSelection ? (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-primary/5 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm">
            {allFiltered
              ? `Todos os ${total} titulares do filtro selecionados.`
              : `${selectionCount} titular(es) selecionado(s).`}
            {!allFiltered && allPageSelected && total > selectedIds.size ? (
              <Button
                className="h-auto p-0 pl-1 align-baseline"
                onClick={() => {
                  setSelectedIds(new Set())
                  setAllFiltered(true)
                }}
                size="sm"
                variant="link"
              >
                Selecionar todos os {total}
              </Button>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setBulkLinkOpen(true)} size="sm">
              <Building2 className="size-4" />
              Vincular conjunto
            </Button>
            <Button onClick={clearSelection} size="sm" variant="ghost">
              Limpar
            </Button>
          </div>
        </div>
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <DataTable
            ariaLabel="Tabela de titulares de contrato Caixa"
            columns={columns}
            emptyState={
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                {query.isLoading
                  ? 'Carregando...'
                  : allowImport
                    ? 'Nenhum titular encontrado. Importe a planilha para comecar.'
                    : 'Nenhum titular encontrado.'}
              </div>
            }
            getItemKey={(t) => t.id}
            items={items}
            pagination={{
              itemLabel: 'titulares',
              onPageChange: (page) => apply({ page }),
              page: currentPage,
              pageSize: defaultTitularesPageLimit,
              total,
            }}
            renderMobileCard={(t) => (
              <Card>
                <CardContent className="grid gap-2 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-start gap-2">
                      {allowLinkConjunto ? (
                        <Checkbox
                          aria-label="Selecionar titular"
                          checked={isRowSelected(t.id)}
                          className="mt-1"
                          disabled={allFiltered}
                          onCheckedChange={() => toggleRow(t.id)}
                        />
                      ) : null}
                      <p className="font-semibold">{t.mutuarioNome}</p>
                    </div>
                    <StatusBadge tone={quitacaoTone[t.quitacaoStatus]}>
                      {titularQuitacaoStatusLabels[t.quitacaoStatus]}
                    </StatusBadge>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {formatCpf(t.cpf)}
                  </p>
                  <p className="text-sm">
                    {t.empreendimento} · {t.municipio}-{t.uf}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t.conjuntoNome
                      ? `Conjunto: ${t.conjuntoNome}`
                      : 'Sem conjunto'}
                  </p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    {t.termoDocId ? (
                      <>
                        <Button
                          onClick={() =>
                            setPreviewDoc({
                              id: t.id,
                              docId: t.termoDocId as string,
                              nome: t.mutuarioNome,
                            })
                          }
                          size="sm"
                          variant="outline"
                        >
                          <Eye className="size-4" />
                          Ver termo
                        </Button>
                        <Button asChild size="sm" variant="ghost">
                          <a
                            href={titularDocumentDownloadUrl(
                              t.id,
                              t.termoDocId,
                            )}
                            rel="noreferrer"
                          >
                            <Download className="size-4" />
                            Baixar
                          </a>
                        </Button>
                      </>
                    ) : null}
                    {allowReconsultar ? (
                      <Button
                        disabled={reconsultarMutation.isPending}
                        onClick={() => handleReconsultar(t.id)}
                        size="sm"
                        variant="ghost"
                      >
                        <RefreshCw className="size-4" />
                        Reconsultar
                      </Button>
                    ) : null}
                    <Button
                      onClick={() => setTerceiroTarget(t)}
                      size="sm"
                      variant={t.terceiroId ? 'outline' : 'ghost'}
                    >
                      <Contact className="size-4" />
                      Terceiro
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          />
        </CardContent>
      </Card>

      <ImportDialog
        file={selectedFile}
        isPending={importMutation.isPending}
        onClose={() => {
          setImportOpen(false)
          setSelectedFile(null)
        }}
        onConfirm={handleImport}
        onFileChange={setSelectedFile}
        open={importOpen}
      />

      <FiltersDialog
        initial={{
          uf: currentUf,
          municipio: currentMunicipio,
          modalidade: currentModalidade,
          empreendimento: currentEmpreendimento,
          conjuntoIds: currentConjuntoIds,
          logradouros: currentLogradouros,
          quitacaoStatuses: currentQuitacaoStatuses,
          averbacoes: currentAverbacoes,
          terceiro: currentTerceiro,
          assinaturaFrom: currentAssinaturaFrom,
          assinaturaTo: currentAssinaturaTo,
        }}
        onApply={(value) => {
          setFiltersOpen(false)
          apply({ ...value, page: 1 })
        }}
        onClose={() => setFiltersOpen(false)}
        open={filtersOpen}
      />

      {bulkLinkOpen ? (
        <LinkConjuntoDialog
          allowUnlink
          description={
            allFiltered
              ? `${total} titulares do filtro atual`
              : `${selectedIds.size} titular(es) selecionado(s)`
          }
          isPending={bulkLinkMutation.isPending}
          onClose={() => setBulkLinkOpen(false)}
          onLink={handleLink}
          prefillName={
            allFiltered && currentEmpreendimento.length === 1
              ? currentEmpreendimento[0]
              : ''
          }
        />
      ) : null}

      {terceiroTarget ? (
        <TerceiroDialog
          onClose={() => setTerceiroTarget(null)}
          titular={terceiroTarget}
        />
      ) : null}

      {previewDoc ? (
        <TermoPreviewDialog
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      ) : null}
    </div>
  )
}

type TermoPreviewDialogProps = {
  doc: { id: string; docId: string; nome: string }
  onClose: () => void
}

// Busca a URL pre-assinada do termo e renderiza o viewer. O PDF vem DIRETO do
// storage (S3/MinIO) — pela API o gateway corta respostas acima de 10MB.
function TermoPreviewDialog({ doc, onClose }: TermoPreviewDialogProps) {
  const previewUrlQuery = useQuery(
    titularDocumentPreviewUrlQuery(doc.id, doc.docId),
  )

  return (
    <AppDialog
      footer={
        <DialogFooter>
          <Button asChild variant="outline">
            <a
              href={titularDocumentDownloadUrl(doc.id, doc.docId)}
              rel="noreferrer"
            >
              <Download className="size-4" />
              Baixar
            </a>
          </Button>
          <Button onClick={onClose}>Fechar</Button>
        </DialogFooter>
      }
      icon={FileSpreadsheet}
      maxWidth="screen"
      onClose={onClose}
      open
      title={`Termo de quitacao — ${doc.nome}`}
      variant="info"
    >
      <div className="h-[80vh] overflow-hidden rounded-md border border-border">
        {previewUrlQuery.isPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : previewUrlQuery.isError ? (
          <QueryError
            message="Nao foi possivel carregar o documento."
            onRetry={() => void previewUrlQuery.refetch()}
          />
        ) : (
          <PdfViewer url={previewUrlQuery.data} />
        )}
      </div>
    </AppDialog>
  )
}

type ImportDialogProps = {
  file: File | null
  isPending: boolean
  onClose: () => void
  onConfirm: () => void
  onFileChange: (file: File | null) => void
  open: boolean
}

function ImportDialog({
  file,
  isPending,
  onClose,
  onConfirm,
  onFileChange,
  open,
}: ImportDialogProps) {
  return (
    <AppDialog
      icon={FileSpreadsheet}
      maxWidth="md"
      onClose={onClose}
      open={open}
      title="Importar planilha de titulares"
      description="Envie o arquivo .xlsx da lista de titulares de contrato Caixa."
      variant="info"
      footer={
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancelar
          </Button>
          <Button
            disabled={!file || isPending}
            onClick={onConfirm}
            type="button"
          >
            {isPending ? 'Importando...' : 'Importar'}
          </Button>
        </DialogFooter>
      }
    >
      <div className="grid gap-3">
        <Input
          accept=".xlsx"
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
          type="file"
        />
        <p className="text-xs text-muted-foreground">
          Colunas esperadas: UF, Municipio, Modalidade, Empreendimento,
          Mutuario, CPF, PIS, Data de Assinatura e endereco do imovel.
        </p>
      </div>
    </AppDialog>
  )
}

type FiltersValue = {
  uf: string[]
  municipio: string
  modalidade: string[]
  empreendimento: string[]
  conjuntoIds: string[]
  logradouros: string[]
  quitacaoStatuses: TitularQuitacaoStatus[]
  averbacoes: TitularAverbacao[]
  terceiro?: 'com' | 'sem'
  assinaturaFrom?: string
  assinaturaTo?: string
}

type FiltersDialogProps = {
  initial: FiltersValue
  onApply: (value: FiltersValue) => void
  onClose: () => void
  open: boolean
}

function FiltersDialog({
  initial,
  onApply,
  onClose,
  open,
}: FiltersDialogProps) {
  const [uf, setUf] = useState(initial.uf[0] ?? '')
  const [municipio, setMunicipio] = useState(initial.municipio)
  const [terceiro, setTerceiro] = useState<'todos' | 'com' | 'sem'>(
    initial.terceiro ?? 'todos',
  )
  const [modalidade, setModalidade] = useState(initial.modalidade[0] ?? '')
  const [empreendimento, setEmpreendimento] = useState<string[]>(
    initial.empreendimento,
  )
  const [statuses, setStatuses] = useState<TitularQuitacaoStatus[]>(
    initial.quitacaoStatuses,
  )

  const optionsQuery = useQuery(empreendimentoOptionsQuery())
  const empreendimentoOptions = useMemo(
    () => (optionsQuery.data ?? []).map((e) => ({ value: e, label: e })),
    [optionsQuery.data],
  )
  const [conjuntoIds, setConjuntoIds] = useState<string[]>(initial.conjuntoIds)
  const conjuntoQuery = useQuery(conjuntoOptionsQuery())
  const conjuntoOptions = useMemo(
    () =>
      (conjuntoQuery.data ?? []).map((c) => ({ value: c.id, label: c.nome })),
    [conjuntoQuery.data],
  )
  const [logradouros, setLogradouros] = useState<string[]>(initial.logradouros)
  const logradouroQuery = useQuery(logradouroOptionsQuery())
  const logradouroOptions = useMemo(
    () => (logradouroQuery.data ?? []).map((e) => ({ value: e, label: e })),
    [logradouroQuery.data],
  )
  const [averbacoes, setAverbacoes] = useState<TitularAverbacao[]>(
    initial.averbacoes,
  )
  const [assinaturaFrom, setAssinaturaFrom] = useState(
    initial.assinaturaFrom ?? '',
  )
  const [assinaturaTo, setAssinaturaTo] = useState(initial.assinaturaTo ?? '')

  function toggleStatus(status: TitularQuitacaoStatus, checked: boolean) {
    setStatuses((prev) =>
      checked ? [...prev, status] : prev.filter((s) => s !== status),
    )
  }

  function toggleAverbacao(value: TitularAverbacao, checked: boolean) {
    setAverbacoes((prev) =>
      checked ? [...prev, value] : prev.filter((s) => s !== value),
    )
  }

  function submit() {
    onApply({
      uf: uf.trim() ? [uf.trim().toUpperCase()] : [],
      municipio: municipio.trim(),
      modalidade: modalidade.trim() ? [modalidade.trim()] : [],
      empreendimento,
      conjuntoIds,
      logradouros,
      quitacaoStatuses: statuses,
      averbacoes,
      terceiro: terceiro === 'todos' ? undefined : terceiro,
      assinaturaFrom: assinaturaFrom || undefined,
      assinaturaTo: assinaturaTo || undefined,
    })
  }

  return (
    <AppDialog
      icon={SlidersHorizontal}
      maxWidth="md"
      onClose={onClose}
      open={open}
      title="Filtros"
      footer={
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">
            Cancelar
          </Button>
          <Button onClick={submit} type="button">
            Aplicar
          </Button>
        </DialogFooter>
      }
    >
      <div className="grid gap-4">
        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-uf">UF</Label>
            <Input
              id="filter-uf"
              maxLength={2}
              onChange={(e) => setUf(e.target.value)}
              placeholder="Ex.: BA"
              value={uf}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-municipio">Municipio</Label>
            <Input
              id="filter-municipio"
              onChange={(e) => setMunicipio(e.target.value)}
              placeholder="Ex.: Salvador"
              value={municipio}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-modalidade">Modalidade</Label>
            <Input
              id="filter-modalidade"
              onChange={(e) => setModalidade(e.target.value)}
              placeholder="Ex.: FAR Empresas"
              value={modalidade}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-terceiro">Terceiro</Label>
            <Select
              onValueChange={(value) =>
                setTerceiro(value as 'todos' | 'com' | 'sem')
              }
              value={terceiro}
            >
              <SelectTrigger id="filter-terceiro">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todos</SelectItem>
                <SelectItem value="com">Com terceiro</SelectItem>
                <SelectItem value="sem">Sem terceiro</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <SearchableMultiSelect
          isLoading={conjuntoQuery.isLoading}
          label="Conjunto"
          onChange={setConjuntoIds}
          options={conjuntoOptions}
          placeholder="Todos os conjuntos"
          searchPlaceholder="Buscar conjunto..."
          value={conjuntoIds}
        />

        <SearchableMultiSelect
          isLoading={optionsQuery.isLoading}
          label="Empreendimento"
          onChange={setEmpreendimento}
          options={empreendimentoOptions}
          placeholder="Todos os empreendimentos"
          searchPlaceholder="Buscar empreendimento..."
          value={empreendimento}
        />

        <SearchableMultiSelect
          isLoading={logradouroQuery.isLoading}
          label="Logradouro"
          onChange={setLogradouros}
          options={logradouroOptions}
          placeholder="Todos os logradouros"
          searchPlaceholder="Buscar logradouro..."
          value={logradouros}
        />

        <div className="grid gap-2">
          <Label>Status da quitacao</Label>
          <div className="grid grid-cols-2 gap-2">
            {titularQuitacaoStatuses.map((status) => (
              <Label
                className="flex items-center gap-2 text-sm font-normal"
                htmlFor={`status-${status}`}
                key={status}
              >
                <Checkbox
                  checked={statuses.includes(status)}
                  id={`status-${status}`}
                  onCheckedChange={(checked) =>
                    toggleStatus(status, checked === true)
                  }
                />
                {titularQuitacaoStatusLabels[status]}
              </Label>
            ))}
          </div>
        </div>

        <div className="grid gap-2">
          <Label>Averbacao</Label>
          <div className="grid grid-cols-2 gap-2">
            {titularAverbacaoValues.map((value) => (
              <Label
                className="flex items-center gap-2 text-sm font-normal"
                htmlFor={`averbacao-${value}`}
                key={value}
              >
                <Checkbox
                  checked={averbacoes.includes(value)}
                  id={`averbacao-${value}`}
                  onCheckedChange={(checked) =>
                    toggleAverbacao(value, checked === true)
                  }
                />
                {titularAverbacaoLabels[value]}
              </Label>
            ))}
          </div>
        </div>

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="filter-from">Assinatura de</Label>
            <Input
              id="filter-from"
              onChange={(e) => setAssinaturaFrom(e.target.value)}
              type="date"
              value={assinaturaFrom}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="filter-to">Assinatura ate</Label>
            <Input
              id="filter-to"
              onChange={(e) => setAssinaturaTo(e.target.value)}
              type="date"
              value={assinaturaTo}
            />
          </div>
        </div>
      </div>
    </AppDialog>
  )
}
