import { useQuery } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Label } from '#/components/ui/label'
import { Separator } from '#/components/ui/separator'
import { adminHousingComplexListOptions } from '@/features/admin/services/admin-housing-complexes.queries'
import type { AdminUserListItem } from '@/features/admin/services/admin-users.service'
import { AppDialog } from '@/shared/components/app-dialog'
import { SearchableMultiSelect } from '@/shared/components/searchable-multi-select'
import { SearchableSelect } from '@/shared/components/searchable-select'
import {
  useAssignProfile,
  useUpdateUserHousingComplexes,
  useUpdateUserTitularMunicipios,
  useUpdateUserTitularUfs,
} from '../services/permissions.mutations'
import {
  profileListOptions,
  titularLocalidadesOptions,
  userHousingComplexesOptions,
  userTitularMunicipiosOptions,
  userTitularUfsOptions,
} from '../services/permissions.queries'

const scopeLabels = {
  all: 'Todos os processos',
  housing_complex: 'Processos dos conjuntos vinculados',
  own: 'Apenas processos proprios',
} as const

type UserPermissionsDialogProps = {
  onClose: () => void
  user: AdminUserListItem
}

export function UserPermissionsDialog({
  onClose,
  user,
}: UserPermissionsDialogProps) {
  const [selectedProfileId, setSelectedProfileId] = useState(
    user.profileId ?? '',
  )
  const [selectedHousingComplexIds, setSelectedHousingComplexIds] = useState<
    string[]
  >([])
  // UFs por valor (ex.: 'BA'); municípios encodados como `uf|municipio`.
  const [selectedUfs, setSelectedUfs] = useState<string[]>([])
  const [selectedMunicipios, setSelectedMunicipios] = useState<string[]>([])
  const [error, setError] = useState('')

  const profilesQuery = useQuery(profileListOptions({ limit: 100, page: 1 }))
  const housingComplexesQuery = useQuery(
    adminHousingComplexListOptions({ limit: 100, page: 1 }),
  )
  const userHousingComplexesQuery = useQuery(
    userHousingComplexesOptions(user.id),
  )
  const localidadesQuery = useQuery(titularLocalidadesOptions())
  const userUfsQuery = useQuery(userTitularUfsOptions(user.id))
  const userMunicipiosQuery = useQuery(userTitularMunicipiosOptions(user.id))

  const assignProfileMutation = useAssignProfile()
  const updateHousingComplexesMutation = useUpdateUserHousingComplexes()
  const updateUfsMutation = useUpdateUserTitularUfs()
  const updateMunicipiosMutation = useUpdateUserTitularMunicipios()
  const isSubmitting =
    assignProfileMutation.isPending ||
    updateHousingComplexesMutation.isPending ||
    updateUfsMutation.isPending ||
    updateMunicipiosMutation.isPending

  useEffect(() => {
    setSelectedProfileId(user.profileId ?? '')
  }, [user.profileId])

  useEffect(() => {
    if (!userHousingComplexesQuery.data) {
      return
    }

    setSelectedHousingComplexIds(
      userHousingComplexesQuery.data.map((item) => item.id),
    )
  }, [userHousingComplexesQuery.data])

  useEffect(() => {
    if (!userUfsQuery.data) return
    setSelectedUfs(userUfsQuery.data)
  }, [userUfsQuery.data])

  useEffect(() => {
    if (!userMunicipiosQuery.data) return
    setSelectedMunicipios(
      userMunicipiosQuery.data.map((m) => `${m.uf}|${m.municipio}`),
    )
  }, [userMunicipiosQuery.data])

  const profiles = profilesQuery.data?.items ?? []
  const housingComplexes = housingComplexesQuery.data?.items ?? []
  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  )

  const ufOptions = useMemo(
    () =>
      (localidadesQuery.data?.ufs ?? []).map((uf) => ({
        value: uf,
        label: uf,
      })),
    [localidadesQuery.data],
  )
  const municipioOptions = useMemo(
    () =>
      (localidadesQuery.data?.municipios ?? []).map((m) => ({
        value: `${m.uf}|${m.municipio}`,
        label: `${m.municipio}/${m.uf}`,
      })),
    [localidadesQuery.data],
  )

  function toggleHousingComplex(housingComplexId: string) {
    setSelectedHousingComplexIds((current) =>
      current.includes(housingComplexId)
        ? current.filter((id) => id !== housingComplexId)
        : [...current, housingComplexId],
    )
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError('')

    if (!selectedProfileId) {
      setError('Selecione um perfil para este usuario.')
      return
    }

    try {
      await assignProfileMutation.mutateAsync({
        userId: user.id,
        profileId: selectedProfileId,
      })

      await updateHousingComplexesMutation.mutateAsync({
        userId: user.id,
        housingComplexIds: selectedHousingComplexIds,
      })

      await updateUfsMutation.mutateAsync({
        userId: user.id,
        ufs: selectedUfs,
      })

      await updateMunicipiosMutation.mutateAsync({
        userId: user.id,
        municipios: selectedMunicipios.map((value) => {
          const [uf, municipio] = value.split('|')
          return { uf, municipio }
        }),
      })

      toast.success('Permissoes do usuario atualizadas com sucesso.')
      onClose()
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : 'Nao foi possivel salvar as permissoes do usuario.',
      )
    }
  }

  const hasLoadingError =
    profilesQuery.isError ||
    housingComplexesQuery.isError ||
    userHousingComplexesQuery.isError ||
    localidadesQuery.isError ||
    userUfsQuery.isError ||
    userMunicipiosQuery.isError
  const isLoadingInitialData =
    profilesQuery.isLoading ||
    housingComplexesQuery.isLoading ||
    userHousingComplexesQuery.isLoading ||
    localidadesQuery.isLoading ||
    userUfsQuery.isLoading ||
    userMunicipiosQuery.isLoading

  return (
    <AppDialog
      icon={ShieldCheck}
      maxWidth="2xl"
      onClose={onClose}
      open={true}
      title="Permissoes do usuario"
      description={`Ajuste o perfil e os conjuntos extras de ${user.name}.`}
    >
      <form className="grid gap-5" onSubmit={handleSubmit}>
        <div className="rounded-2xl border border-border bg-muted/20 p-4">
          <p className="text-sm font-medium text-foreground">{user.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Perfil atual: {user.profileName ?? 'Sem perfil vinculado'}
          </p>
        </div>

        {hasLoadingError ? (
          <p className="text-sm text-destructive">
            Nao foi possivel carregar os dados necessarios para editar as
            permissoes deste usuario.
          </p>
        ) : (
          <>
            <SearchableSelect
              label="Perfil de permissoes"
              required
              value={selectedProfileId}
              onChange={(value) => {
                setSelectedProfileId(value)
                setError('')
              }}
              options={profiles.map((profile) => ({
                value: profile.id,
                label: profile.name,
                description: profile.isSystem ? 'Sistema' : 'Customizado',
              }))}
              isLoading={profilesQuery.isLoading}
              placeholder="Selecione um perfil"
              searchPlaceholder="Buscar perfil..."
              emptyMessage="Nenhum perfil encontrado."
            />

            {selectedProfile ? (
              <div className="grid gap-2 rounded-2xl border border-border bg-background p-4">
                <p className="text-sm font-medium text-foreground">
                  Escopo: {scopeLabels[selectedProfile.processScope]}
                </p>
                {selectedProfile.processScope === 'housing_complex' ? (
                  <p className="text-xs text-muted-foreground">
                    Conjuntos no perfil:{' '}
                    {selectedProfile.housingComplexes.length > 0
                      ? selectedProfile.housingComplexes
                          .map((housingComplex) => housingComplex.name)
                          .join(', ')
                      : 'nenhum conjunto vinculado.'}
                  </p>
                ) : null}
              </div>
            ) : null}

            <Separator />

            <div className="grid gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-foreground">
                  Conjuntos extras do usuario
                </p>
                <p className="text-xs text-muted-foreground">
                  Esses conjuntos se somam ao alcance definido no perfil.
                </p>
              </div>

              {housingComplexesQuery.isLoading ||
              userHousingComplexesQuery.isLoading ? (
                <p className="text-sm text-muted-foreground">
                  Carregando conjuntos...
                </p>
              ) : housingComplexes.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum conjunto cadastrado.
                </p>
              ) : (
                <div className="grid max-h-72 gap-2 overflow-y-auto rounded-2xl border border-border p-4">
                  {housingComplexes.map((housingComplex) => {
                    const checked = selectedHousingComplexIds.includes(
                      housingComplex.id,
                    )

                    return (
                      <div
                        className="flex items-center gap-3"
                        key={housingComplex.id}
                      >
                        <Checkbox
                          checked={checked}
                          id={`user-hc-${housingComplex.id}`}
                          onCheckedChange={(nextChecked) => {
                            if (nextChecked === 'indeterminate') {
                              return
                            }

                            toggleHousingComplex(housingComplex.id)
                          }}
                        />
                        <Label
                          className="cursor-pointer font-normal"
                          htmlFor={`user-hc-${housingComplex.id}`}
                        >
                          {housingComplex.name}
                        </Label>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <Separator />

            <div className="grid gap-3">
              <div className="grid gap-1">
                <p className="text-sm font-medium text-foreground">
                  Acesso por localidade (Titular Caixa)
                </p>
                <p className="text-xs text-muted-foreground">
                  Libera titulares por estado (UF) e/ou cidade — soma-se aos
                  conjuntos.
                </p>
              </div>

              <SearchableMultiSelect
                isLoading={localidadesQuery.isLoading}
                label="Estados (UF)"
                onChange={setSelectedUfs}
                options={ufOptions}
                placeholder="Nenhum estado liberado"
                searchPlaceholder="Buscar estado..."
                value={selectedUfs}
              />

              <SearchableMultiSelect
                isLoading={localidadesQuery.isLoading}
                label="Cidades (municipios)"
                onChange={setSelectedMunicipios}
                options={municipioOptions}
                placeholder="Nenhuma cidade liberada"
                searchPlaceholder="Buscar cidade..."
                value={selectedMunicipios}
              />
            </div>
          </>
        )}

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={hasLoadingError || isLoadingInitialData || isSubmitting}
            type="submit"
          >
            {isSubmitting ? 'Salvando...' : 'Salvar permissoes'}
          </Button>
        </div>
      </form>
    </AppDialog>
  )
}
