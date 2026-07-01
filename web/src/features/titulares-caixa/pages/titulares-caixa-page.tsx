import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  Download,
  Eye,
  FileSpreadsheet,
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
import { AppDialog, DialogFooter } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { SearchableMultiSelect } from '@/shared/components/searchable-multi-select'
import { SearchInput } from '@/shared/components/search-input'
import { StatusBadge } from '@/shared/components/status-badge'
import {
  DataTable,
  type DataTableColumn,
} from '@/shared/components/ui/data-table'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import type { TitularesSearch } from '../schemas/titulares-caixa-search.schema'
import {
  useImportTitulares,
  useReconsultarTitulares,
} from '../services/titulares-caixa.mutations'
import {
  empreendimentoOptionsQuery,
  titularListOptions,
} from '../services/titulares-caixa.queries'
import {
  defaultTitularesPageLimit,
  type TitularListItem,
  type TitularQuitacaoStatus,
  titularDocumentDownloadUrl,
  titularDocumentPreviewUrl,
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
  currentQuitacaoStatuses: TitularQuitacaoStatus[]
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
  currentQuitacaoStatuses,
  currentAssinaturaFrom,
  currentAssinaturaTo,
}: TitularesCaixaPageProps) {
  const navigate = useNavigate()
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

  const importMutation = useImportTitulares()
  const reconsultarMutation = useReconsultarTitulares()

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
      quitacaoStatuses: currentQuitacaoStatuses.length
        ? currentQuitacaoStatuses
        : undefined,
      assinaturaFrom: currentAssinaturaFrom,
      assinaturaTo: currentAssinaturaTo,
    }),
  )

  const data = query.data
  const total = data?.pagination.total ?? 0

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
      ...(currentQuitacaoStatuses.length
        ? { quitacaoStatuses: currentQuitacaoStatuses }
        : {}),
      ...(currentAssinaturaFrom ? { assinaturaFrom: currentAssinaturaFrom } : {}),
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
    if (merged.quitacaoStatuses?.length)
      next.quitacaoStatuses = merged.quitacaoStatuses
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

  const activeFilterCount =
    currentUf.length +
    (currentMunicipio ? 1 : 0) +
    currentModalidade.length +
    currentEmpreendimento.length +
    currentQuitacaoStatuses.length +
    (currentAssinaturaFrom ? 1 : 0) +
    (currentAssinaturaTo ? 1 : 0)

  const columns: readonly DataTableColumn<TitularListItem>[] = [
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
      render: (t) => (
        <div className="grid gap-0.5">
          <p>{t.empreendimento}</p>
          <p className="text-sm text-muted-foreground">{t.modalidade}</p>
        </div>
      ),
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
            <Button
              disabled={reconsultarMutation.isPending}
              onClick={() => handleReconsultar(t.id)}
              size="sm"
              variant="ghost"
            >
              <RefreshCw className="size-4" />
              Reconsultar
            </Button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="grid gap-6">
      <PageHeader
        title="Titulares Caixa"
        description="Cadastro de titulares de contrato Caixa e consulta de quitacao"
      >
        <Button onClick={() => setImportOpen(true)}>
          <Upload className="size-4" />
          Importar planilha
        </Button>
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

      <Card className="overflow-hidden">
        <CardContent className="overflow-x-auto px-0 sm:px-0">
          <DataTable
            ariaLabel="Tabela de titulares de contrato Caixa"
            columns={columns}
            emptyState={
              <div className="px-6 py-16 text-center text-sm text-muted-foreground">
                {query.isLoading
                  ? 'Carregando...'
                  : 'Nenhum titular encontrado. Importe a planilha para comecar.'}
              </div>
            }
            getItemKey={(t) => t.id}
            items={data?.items ?? []}
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
                    <p className="font-semibold">{t.mutuarioNome}</p>
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
                            href={titularDocumentDownloadUrl(t.id, t.termoDocId)}
                            rel="noreferrer"
                          >
                            <Download className="size-4" />
                            Baixar
                          </a>
                        </Button>
                      </>
                    ) : null}
                    <Button
                      disabled={reconsultarMutation.isPending}
                      onClick={() => handleReconsultar(t.id)}
                      size="sm"
                      variant="ghost"
                    >
                      <RefreshCw className="size-4" />
                      Reconsultar
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
          quitacaoStatuses: currentQuitacaoStatuses,
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

      {previewDoc ? (
        <AppDialog
          footer={
            <DialogFooter>
              <Button asChild variant="outline">
                <a
                  href={titularDocumentDownloadUrl(previewDoc.id, previewDoc.docId)}
                  rel="noreferrer"
                >
                  <Download className="size-4" />
                  Baixar
                </a>
              </Button>
              <Button onClick={() => setPreviewDoc(null)}>Fechar</Button>
            </DialogFooter>
          }
          icon={FileSpreadsheet}
          maxWidth="3xl"
          onClose={() => setPreviewDoc(null)}
          open
          title={`Termo de quitacao — ${previewDoc.nome}`}
          variant="info"
        >
          <iframe
            className="h-[70vh] w-full rounded-md border border-border"
            src={titularDocumentPreviewUrl(previewDoc.id, previewDoc.docId)}
            title="Termo de quitacao"
          />
        </AppDialog>
      ) : null}
    </div>
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
          <Button disabled={!file || isPending} onClick={onConfirm} type="button">
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
          Colunas esperadas: UF, Municipio, Modalidade, Empreendimento, Mutuario,
          CPF, PIS, Data de Assinatura e endereco do imovel.
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
  quitacaoStatuses: TitularQuitacaoStatus[]
  assinaturaFrom?: string
  assinaturaTo?: string
}

type FiltersDialogProps = {
  initial: FiltersValue
  onApply: (value: FiltersValue) => void
  onClose: () => void
  open: boolean
}

function FiltersDialog({ initial, onApply, onClose, open }: FiltersDialogProps) {
  const [uf, setUf] = useState(initial.uf[0] ?? '')
  const [municipio, setMunicipio] = useState(initial.municipio)
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
  const [assinaturaFrom, setAssinaturaFrom] = useState(
    initial.assinaturaFrom ?? '',
  )
  const [assinaturaTo, setAssinaturaTo] = useState(initial.assinaturaTo ?? '')

  function toggleStatus(status: TitularQuitacaoStatus, checked: boolean) {
    setStatuses((prev) =>
      checked ? [...prev, status] : prev.filter((s) => s !== status),
    )
  }

  function submit() {
    onApply({
      uf: uf.trim() ? [uf.trim().toUpperCase()] : [],
      municipio: municipio.trim(),
      modalidade: modalidade.trim() ? [modalidade.trim()] : [],
      empreendimento,
      quitacaoStatuses: statuses,
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
        </div>

        <SearchableMultiSelect
          isLoading={optionsQuery.isLoading}
          label="Empreendimento"
          onChange={setEmpreendimento}
          options={empreendimentoOptions}
          placeholder="Todos os empreendimentos"
          searchPlaceholder="Buscar empreendimento..."
          value={empreendimento}
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
