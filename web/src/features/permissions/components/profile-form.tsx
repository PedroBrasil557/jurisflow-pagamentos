import { useQuery } from '@tanstack/react-query'
import { Building2, ShieldCheck, Sparkles } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { Textarea } from '#/components/ui/textarea'
import { adminHousingComplexListOptions } from '@/features/admin/services/admin-housing-complexes.queries'
import { AppDialog } from '@/shared/components/app-dialog'
import {
  ATTORNEY_PERMISSIONS,
  DEFAULT_USER_PERMISSIONS,
} from '../lib/permissions.defaults'
import {
  useCreateProfile,
  useUpdateProfile,
} from '../services/permissions.mutations'
import type {
  ProcessScope,
  ProfilePermissions,
} from '../services/permissions.service'
import { ProfilePermissionsEditor } from './profile-permissions-editor'

type ProfileFormProps = {
  onClose: () => void
  editingProfile?: {
    id: string
    name: string
    description: string | null
    processScope: ProcessScope
    permissions: ProfilePermissions
    housingComplexes: { id: string; name: string }[]
  }
  readOnly?: boolean
}

const scopeOptions: {
  value: ProcessScope
  label: string
  description: string
}[] = [
  {
    value: 'own',
    label: 'Apenas proprios',
    description: 'Ve somente os processos que criou',
  },
  {
    value: 'housing_complex',
    label: 'Por conjunto',
    description: 'Ve processos dos conjuntos vinculados ao perfil',
  },
  {
    value: 'all',
    label: 'Todos',
    description: 'Ve todos os processos da plataforma',
  },
]

export function ProfileForm({
  editingProfile,
  onClose,
  readOnly = false,
}: ProfileFormProps) {
  const isEditing = !!editingProfile && !readOnly

  const [name, setName] = useState(editingProfile?.name ?? '')
  const [description, setDescription] = useState(
    editingProfile?.description ?? '',
  )
  const [processScope, setProcessScope] = useState<ProcessScope>(
    editingProfile?.processScope ?? 'own',
  )
  const [selectedHcIds, setSelectedHcIds] = useState<string[]>(
    editingProfile?.housingComplexes.map((hc) => hc.id) ?? [],
  )
  const [permissions, setPermissions] = useState<ProfilePermissions>(
    editingProfile?.permissions ?? DEFAULT_USER_PERMISSIONS,
  )
  const [error, setError] = useState('')

  const createMutation = useCreateProfile()
  const updateMutation = useUpdateProfile()
  const isSubmitting = createMutation.isPending || updateMutation.isPending

  const hcOptionsQuery = useQuery(
    adminHousingComplexListOptions({ limit: 100, page: 1 }),
  )
  const hcOptions = hcOptionsQuery.data?.items ?? []

  function toggleHc(id: string) {
    setSelectedHcIds((prev) =>
      prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id],
    )
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')

    if (!name.trim()) {
      setError('Informe o nome do perfil.')
      return
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      processScope,
      permissions,
      housingComplexIds:
        processScope === 'housing_complex' ? selectedHcIds : [],
    }

    try {
      if (isEditing) {
        await updateMutation.mutateAsync({
          profileId: editingProfile.id,
          payload,
        })
        toast.success('Perfil atualizado com sucesso.')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success('Perfil criado com sucesso.')
      }
      onClose()
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nao foi possivel salvar o perfil.',
      )
    }
  }

  const dialogTitle = readOnly
    ? 'Ver perfil'
    : isEditing
      ? 'Editar perfil'
      : 'Novo perfil'
  const dialogDescription = readOnly
    ? 'Visualize as configuracoes deste perfil em modo somente leitura.'
    : 'Configure escopo, permissoes e secoes visiveis deste perfil.'

  return (
    <AppDialog
      description={dialogDescription}
      icon={ShieldCheck}
      maxWidth="3xl"
      onClose={onClose}
      open={true}
      title={dialogTitle}
    >
      <form className="grid gap-4" noValidate onSubmit={handleSubmit}>
        <div className="-mx-4 max-h-[65vh] overflow-y-auto border-y border-border px-4 py-4">
          <div className="grid gap-5">
            <Section title="Identificacao">
              <div className="grid gap-3 sm:grid-cols-[1fr_1.2fr]">
                <div className="grid gap-1.5">
                  <Label htmlFor="profile-name">
                    Nome <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    className="h-9"
                    disabled={readOnly}
                    id="profile-name"
                    onChange={(e) => {
                      setName(e.target.value)
                      setError('')
                    }}
                    placeholder="Ex: Agente de documentacao"
                    value={name}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="profile-description">Descricao</Label>
                  <Textarea
                    className="min-h-9 resize-none"
                    disabled={readOnly}
                    id="profile-description"
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="Descreva brevemente o proposito deste perfil"
                    rows={1}
                    value={description}
                  />
                </div>
              </div>
            </Section>

            <Section title="Escopo de visibilidade de processos">
              <RadioGroup
                className="grid gap-2"
                disabled={readOnly}
                onValueChange={(v) => setProcessScope(v as ProcessScope)}
                value={processScope}
              >
                {scopeOptions.map((scope) => {
                  const isActive = processScope === scope.value
                  return (
                    <label
                      className={
                        'flex items-start gap-3 rounded-lg border p-3 transition-colors ' +
                        (readOnly ? 'cursor-default ' : 'cursor-pointer ') +
                        (isActive
                          ? 'border-primary/60 bg-primary/5'
                          : 'border-border bg-background' +
                            (readOnly ? '' : ' hover:bg-muted/40'))
                      }
                      htmlFor={`scope-${scope.value}`}
                      key={scope.value}
                    >
                      <RadioGroupItem
                        className="mt-0.5"
                        disabled={readOnly}
                        id={`scope-${scope.value}`}
                        value={scope.value}
                      />
                      <div className="grid gap-0.5">
                        <span className="text-sm font-medium text-foreground">
                          {scope.label}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {scope.description}
                        </span>
                      </div>
                    </label>
                  )
                })}
              </RadioGroup>
            </Section>

            {processScope === 'housing_complex' ? (
              <Section
                icon={Building2}
                subtitle="Usuarios com este perfil poderao ver processos dos conjuntos selecionados."
                title="Conjuntos habilitados"
              >
                {hcOptionsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">
                    Carregando conjuntos...
                  </p>
                ) : hcOptionsQuery.isError ? (
                  <p className="rounded-lg border border-dashed border-destructive/40 p-4 text-center text-sm text-destructive">
                    Nao foi possivel carregar a lista de conjuntos.
                  </p>
                ) : hcOptions.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
                    Nenhum conjunto cadastrado.
                  </p>
                ) : (
                  <>
                    <div className="grid max-h-60 gap-0.5 overflow-y-auto rounded-lg border border-border bg-background p-2">
                      {hcOptions.map((hc) => {
                        const checked = selectedHcIds.includes(hc.id)
                        const inputId = `profile-hc-${hc.id}`
                        if (readOnly && !checked) {
                          return null
                        }
                        return (
                          <div
                            className={
                              'flex items-center gap-2 rounded-md px-2 py-1.5 ' +
                              (readOnly ? '' : 'hover:bg-muted/50')
                            }
                            key={hc.id}
                          >
                            <Checkbox
                              checked={checked}
                              disabled={readOnly}
                              id={inputId}
                              onCheckedChange={(next) => {
                                if (next === 'indeterminate') return
                                toggleHc(hc.id)
                              }}
                            />
                            <Label
                              className={
                                'flex-1 font-normal ' +
                                (readOnly ? '' : 'cursor-pointer')
                              }
                              htmlFor={inputId}
                            >
                              {hc.name}
                            </Label>
                          </div>
                        )
                      })}
                      {readOnly && selectedHcIds.length === 0 ? (
                        <p className="px-2 py-1.5 text-sm text-muted-foreground">
                          Nenhum conjunto vinculado a este perfil.
                        </p>
                      ) : null}
                    </div>
                    {!readOnly && selectedHcIds.length > 0 ? (
                      <p className="text-xs text-muted-foreground">
                        {selectedHcIds.length} conjunto(s) selecionado(s)
                      </p>
                    ) : null}
                  </>
                )}
              </Section>
            ) : null}

            <Section
              action={
                readOnly ? null : (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      className="h-8"
                      onClick={() => setPermissions(DEFAULT_USER_PERMISSIONS)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Sparkles className="size-3.5" />
                      Padrao usuario
                    </Button>
                    <Button
                      className="h-8"
                      onClick={() => setPermissions(ATTORNEY_PERMISSIONS)}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      <Sparkles className="size-3.5" />
                      Padrao advogado
                    </Button>
                  </div>
                )
              }
              title="Permissoes"
            >
              <div className="rounded-lg border border-border bg-background p-4">
                <ProfilePermissionsEditor
                  disabled={readOnly}
                  onChange={setPermissions}
                  value={permissions}
                />
              </div>
            </Section>
          </div>
        </div>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={isSubmitting}
            onClick={onClose}
            type="button"
            variant={readOnly ? 'outline' : 'ghost'}
          >
            {readOnly ? 'Fechar' : 'Cancelar'}
          </Button>
          {readOnly ? null : (
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting
                ? 'Salvando...'
                : isEditing
                  ? 'Salvar alteracoes'
                  : 'Criar perfil'}
            </Button>
          )}
        </div>
      </form>
    </AppDialog>
  )
}

function Section({
  action,
  children,
  icon: Icon,
  subtitle,
  title,
}: {
  action?: React.ReactNode
  children: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  subtitle?: string
  title: string
}) {
  return (
    <section className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          {Icon ? <Icon className="size-4 text-muted-foreground" /> : null}
          <p className="text-sm font-medium text-foreground">{title}</p>
        </div>
        {action ?? null}
      </div>
      {subtitle ? (
        <p className="-mt-1 text-xs text-muted-foreground">{subtitle}</p>
      ) : null}
      {children}
    </section>
  )
}
