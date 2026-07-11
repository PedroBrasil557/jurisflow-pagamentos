import { useInfiniteQuery } from '@tanstack/react-query'
import { Building2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useCreateHousingComplex } from '@/features/admin/services/admin-housing-complexes.mutations'
import { housingComplexOptionsInfiniteQuery } from '@/features/processes/services/housing-complexes.queries'
import { AppDialog, DialogFooter } from '@/shared/components/app-dialog'
import { SearchableSelect } from '@/shared/components/searchable-select'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'

// Dialogo agnostico de alvo: escolhe/cria um conjunto e devolve o housingComplexId
// (ou null p/ desvincular) via onLink. O PAI decide o que fazer (a selecao atual ou
// o filtro inteiro) e fecha no sucesso. `isPending` reflete a mutacao do pai; a
// criacao do conjunto e gerida aqui.
type LinkConjuntoDialogProps = {
  description: string
  prefillName?: string
  allowUnlink?: boolean
  isPending?: boolean
  onLink: (housingComplexId: string | null) => void
  onClose: () => void
}

type Mode = 'pick' | 'create'

export function LinkConjuntoDialog({
  description,
  prefillName = '',
  allowUnlink = false,
  isPending = false,
  onLink,
  onClose,
}: LinkConjuntoDialogProps) {
  const [mode, setMode] = useState<Mode>('pick')

  // Escolher existente.
  const [selectedId, setSelectedId] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search)
  const optionsQuery = useInfiniteQuery(
    housingComplexOptionsInfiniteQuery(debouncedSearch),
  )
  const options = useMemo(
    () =>
      (optionsQuery.data?.pages ?? [])
        .flatMap((page) => page.items)
        .map((item) => ({
          value: item.id,
          label: item.name,
          description:
            [item.city, item.state].filter(Boolean).join(' - ') || undefined,
        })),
    [optionsQuery.data],
  )

  // Criar novo (prefill quando aplicavel).
  const [name, setName] = useState(prefillName)
  const [uf, setUf] = useState('')
  const [municipio, setMunicipio] = useState('')

  const createMutation = useCreateHousingComplex()
  const busy = isPending || createMutation.isPending

  async function handleCreate() {
    const trimmedName = name.trim()
    if (!trimmedName) {
      toast.error('Informe o nome do conjunto.')
      return
    }
    try {
      const created = await createMutation.mutateAsync({
        name: trimmedName,
        district: '',
        city: municipio.trim(),
        state: uf.trim().toUpperCase(),
        zipcode: '',
        vara: '',
        causeValue: '',
      })
      onLink(created.housingComplex.id)
    } catch {
      // MutationCache.onError ja exibe o toast do erro de criacao.
    }
  }

  function handleSubmit() {
    if (mode === 'create') {
      void handleCreate()
      return
    }
    if (!selectedId) {
      toast.error('Selecione um conjunto.')
      return
    }
    onLink(selectedId)
  }

  return (
    <AppDialog
      description={description}
      footer={
        <DialogFooter>
          {allowUnlink ? (
            <Button
              className="mr-auto text-muted-foreground"
              disabled={busy}
              onClick={() => onLink(null)}
              type="button"
              variant="ghost"
            >
              Desvincular
            </Button>
          ) : null}
          <Button
            disabled={busy}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button disabled={busy} onClick={handleSubmit} type="button">
            {mode === 'create' ? 'Criar e vincular' : 'Vincular'}
          </Button>
        </DialogFooter>
      }
      icon={Building2}
      maxWidth="md"
      onClose={onClose}
      open
      title="Vincular conjunto"
      variant="info"
    >
      <div className="grid gap-4">
        <div className="flex gap-2">
          <Button
            className="flex-1"
            onClick={() => setMode('pick')}
            size="sm"
            type="button"
            variant={mode === 'pick' ? 'default' : 'outline'}
          >
            Escolher existente
          </Button>
          <Button
            className="flex-1"
            onClick={() => setMode('create')}
            size="sm"
            type="button"
            variant={mode === 'create' ? 'default' : 'outline'}
          >
            Criar novo
          </Button>
        </div>

        {mode === 'pick' ? (
          <SearchableSelect
            hasNextPage={optionsQuery.hasNextPage}
            isLoading={
              optionsQuery.isLoading || optionsQuery.isFetchingNextPage
            }
            label="Conjunto"
            onChange={setSelectedId}
            onLoadMore={() => optionsQuery.fetchNextPage()}
            onSearchChange={setSearch}
            options={options}
            placeholder="Selecione um conjunto"
            searchPlaceholder="Buscar conjunto..."
            value={selectedId}
          />
        ) : (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="conj-name">Nome do conjunto</Label>
              <Input
                id="conj-name"
                onChange={(e) => setName(e.target.value)}
                placeholder="Nome do conjunto habitacional"
                value={name}
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-[6rem_1fr]">
              <div className="grid gap-1.5">
                <Label htmlFor="conj-uf">UF</Label>
                <Input
                  id="conj-uf"
                  maxLength={2}
                  onChange={(e) => setUf(e.target.value)}
                  placeholder="BA"
                  value={uf}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="conj-municipio">Municipio</Label>
                <Input
                  id="conj-municipio"
                  onChange={(e) => setMunicipio(e.target.value)}
                  placeholder="Municipio"
                  value={municipio}
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              Vara e valor da causa podem ser preenchidos depois em Cadastros ›
              Conjuntos.
            </p>
          </div>
        )}
      </div>
    </AppDialog>
  )
}
