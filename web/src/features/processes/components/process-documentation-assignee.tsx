import { useInfiniteQuery } from '@tanstack/react-query'
import { UserCog, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { SearchableSelect } from '@/shared/components/searchable-select'
import { useDebouncedValue } from '@/shared/hooks/use-debounced-value'
import {
  useRemoveDocumentationAssignee,
  useSetDocumentationAssignee,
} from '../services/processes.mutations'
import { userOptionsInfiniteQuery } from '../services/processes.queries'

type ProcessDocumentationAssigneeProps = {
  processId: string
  currentAssigneeId: string | null
  currentAssigneeName: string | null
  disabled?: boolean
}

export function ProcessDocumentationAssignee({
  processId,
  currentAssigneeId,
  currentAssigneeName,
  disabled,
}: ProcessDocumentationAssigneeProps) {
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebouncedValue(search, { delay: 300 })
  const [pendingValue, setPendingValue] = useState('')

  const setMutation = useSetDocumentationAssignee(processId)
  const removeMutation = useRemoveDocumentationAssignee(processId)
  const isPending = setMutation.isPending || removeMutation.isPending

  const usersQuery = useInfiniteQuery(userOptionsInfiniteQuery(debouncedSearch))

  const options = useMemo(() => {
    const items =
      usersQuery.data?.pages.flatMap((page) => page.witnessUsers) ?? []
    return items.map((user) => ({
      value: user.id,
      label: user.label,
      description: user.cpf || undefined,
    }))
  }, [usersQuery.data])

  async function handleAssign() {
    if (!pendingValue) return
    try {
      await setMutation.mutateAsync(pendingValue)
      toast.success('Responsavel pela documentacao designado.')
      setPendingValue('')
      setSearch('')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel designar o responsavel.',
      )
    }
  }

  async function handleRemove() {
    try {
      await removeMutation.mutateAsync()
      toast.success('Responsavel pela documentacao removido.')
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel remover o responsavel.',
      )
    }
  }

  return (
    <div className="grid gap-4 rounded-2xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <UserCog className="size-4" />
        </div>
        <div className="grid gap-0.5">
          <p className="text-sm font-medium text-foreground">
            Responsavel pela documentacao
          </p>
          <p className="text-xs text-muted-foreground">
            O usuario designado passa a enxergar o processo e a aba de
            documentacao, independente do perfil.
          </p>
        </div>
      </div>

      {currentAssigneeId ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="grid gap-0.5">
            <p className="text-xs text-muted-foreground">Atual</p>
            <p className="text-sm font-medium text-foreground">
              {currentAssigneeName ?? 'Usuario vinculado'}
            </p>
          </div>
          <Button
            aria-label="Remover responsavel pela documentacao"
            disabled={disabled || isPending}
            onClick={handleRemove}
            size="sm"
            type="button"
            variant="outline"
          >
            <X className="size-3.5" />
            Remover
          </Button>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted-foreground">
          Nenhum responsavel designado.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto] sm:items-end">
        <SearchableSelect
          emptyMessage="Nenhum usuario encontrado."
          hasNextPage={usersQuery.hasNextPage}
          isLoading={usersQuery.isLoading}
          label={
            currentAssigneeId
              ? 'Designar outro usuario'
              : 'Selecionar responsavel'
          }
          onChange={setPendingValue}
          onLoadMore={() => {
            if (usersQuery.hasNextPage && !usersQuery.isFetchingNextPage) {
              void usersQuery.fetchNextPage()
            }
          }}
          onSearchChange={setSearch}
          options={options}
          placeholder="Selecione um usuario"
          searchPlaceholder="Buscar por nome ou CPF..."
          value={pendingValue}
        />
        <Button
          disabled={disabled || isPending || !pendingValue}
          onClick={handleAssign}
          type="button"
        >
          {setMutation.isPending ? 'Salvando...' : 'Designar'}
        </Button>
      </div>
    </div>
  )
}
