import { useQuery } from '@tanstack/react-query'
import { UserPlus } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { RadioGroup, RadioGroupItem } from '#/components/ui/radio-group'
import { profileListOptions } from '@/features/permissions/services/permissions.queries'
import { AppDialog } from '@/shared/components/app-dialog'
import { FormInput, FormSelect, useZodForm } from '@/shared/components/ui/form'
import {
  type AdminUserFormInput,
  type AdminUserFormPayload,
  adminUserFormSchema,
} from '../schemas/admin-user-form.schema'
import { useCreateAdminUser } from '../services/admin-users.mutations'

export type CreateUserModalProps = {
  onClose: () => void
  onCreated: (payload: { temporaryPassword?: string | null }) => void
}

export function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  )
  const mutation = useCreateAdminUser()
  const profilesQuery = useQuery(profileListOptions({ limit: 100, page: 1 }))
  const profiles = useMemo(
    () => profilesQuery.data?.items ?? [],
    [profilesQuery.data],
  )

  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setError,
    setValue,
    watch,
  } = useZodForm<AdminUserFormInput, AdminUserFormPayload>({
    defaultValues: {
      cpf: '',
      email: '',
      isAdmin: false,
      name: '',
      profileId: '',
    },
    schema: adminUserFormSchema,
  })

  const isAdmin = watch('isAdmin')

  useEffect(() => {
    const currentProfileId = watch('profileId')
    if (!isAdmin && !currentProfileId && profiles.length > 0) {
      const defaultProfile =
        profiles.find((profile) => profile.name === 'Usuario Padrao') ??
        profiles[0]
      if (defaultProfile) {
        setValue('profileId', defaultProfile.id, { shouldValidate: false })
      }
    }
  }, [isAdmin, profiles, setValue, watch])

  async function handleCreateUser(values: AdminUserFormPayload) {
    try {
      const result = await mutation.mutateAsync(values)

      if (result.temporaryPassword) {
        setGeneratedPassword(result.temporaryPassword)
      } else {
        toast.success(result.message)
        onCreated({
          temporaryPassword: null,
        })
        onClose()
      }
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel criar o usuario.',
      })
    }
  }

  async function handleCopyPassword() {
    if (!generatedPassword) {
      return
    }

    await navigator.clipboard.writeText(generatedPassword)
    toast.success('Senha temporaria copiada.')
  }

  function handleFinishTemporaryPasswordFlow() {
    onCreated({
      temporaryPassword: generatedPassword,
    })
    reset()
    setGeneratedPassword(null)
    onClose()
  }

  function handleCreateAnother() {
    reset()
    setGeneratedPassword(null)
  }

  const profileOptions = useMemo(
    () => [
      { label: 'Selecione...', value: '' },
      ...profiles.map((profile) => ({
        label: profile.isSystem ? `${profile.name} (sistema)` : profile.name,
        value: profile.id,
      })),
    ],
    [profiles],
  )

  return (
    <AppDialog
      description="Cadastre um novo usuario na plataforma."
      icon={UserPlus}
      maxWidth="2xl"
      onClose={onClose}
      open={true}
      title="Novo usuario"
    >
      {generatedPassword ? (
        <div className="grid gap-5">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-4 py-3 text-emerald-600 dark:text-emerald-400">
            <p className="text-sm font-medium">Senha temporaria gerada</p>
            <p className="mt-1 text-sm leading-6">
              Copie esta senha agora. O usuario sera obrigado a troca-la no
              primeiro login.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              Senha temporaria
            </p>
            <p className="mt-2 break-all font-mono text-lg font-semibold text-foreground">
              {generatedPassword}
            </p>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <Button
              className="sm:flex-1"
              onClick={handleCopyPassword}
              type="button"
            >
              Copiar senha
            </Button>
            <Button
              className="sm:flex-1"
              onClick={handleCreateAnother}
              type="button"
              variant="outline"
            >
              Criar outro usuario
            </Button>
          </div>

          <Button
            onClick={handleFinishTemporaryPasswordFlow}
            type="button"
            variant="ghost"
          >
            Fechar
          </Button>
        </div>
      ) : (
        <form
          className="grid gap-4"
          noValidate
          onSubmit={handleSubmit(handleCreateUser)}
        >
          <FormInput
            error={errors.name?.message}
            label="Nome"
            placeholder="Digite o nome completo"
            required
            {...register('name', {
              onChange: () => clearErrors('root'),
            })}
          />

          <div className="grid gap-4 md:grid-cols-2">
            <FormInput
              error={errors.cpf?.message}
              label="CPF"
              placeholder="000.000.000-00"
              required
              {...register('cpf', {
                onChange: () => clearErrors('root'),
              })}
            />

            <FormInput
              error={errors.email?.message}
              label="E-mail"
              placeholder="usuario@empresa.com (opcional)"
              type="email"
              {...register('email', {
                onChange: () => clearErrors('root'),
              })}
            />
          </div>

          <div className="grid gap-2">
            <span className="text-sm font-medium text-foreground">
              Tipo de acesso <span className="text-destructive">*</span>
            </span>
            <Controller
              control={control}
              name="isAdmin"
              render={({ field }) => (
                <RadioGroup
                  className="grid gap-2 sm:grid-cols-2"
                  onValueChange={(value) => {
                    field.onChange(value === 'admin')
                    clearErrors('root')
                  }}
                  value={field.value ? 'admin' : 'user'}
                >
                  <AccessTypeOption
                    description="Usa um perfil de permissoes"
                    isSelected={!field.value}
                    label="Usuario"
                    value="user"
                  />
                  <AccessTypeOption
                    description="Acesso total a plataforma"
                    isSelected={field.value}
                    label="Administrador"
                    value="admin"
                  />
                </RadioGroup>
              )}
            />
          </div>

          {!isAdmin ? (
            <FormSelect
              disabled={profilesQuery.isLoading}
              error={errors.profileId?.message}
              label="Perfil"
              options={profileOptions}
              required
              {...register('profileId', {
                onChange: () => clearErrors('root'),
              })}
            />
          ) : null}

          <div className="rounded-3xl border border-border bg-muted/50 px-4 py-3">
            <span className="text-sm leading-6">
              O sistema vai gerar uma senha temporaria e exigir a troca no
              primeiro login.
            </span>
          </div>

          {errors.root?.message ? (
            <p className="text-sm text-destructive">{errors.root.message}</p>
          ) : null}

          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:justify-end">
            <Button onClick={onClose} type="button" variant="ghost">
              Cancelar
            </Button>
            <Button disabled={isSubmitting} type="submit">
              {isSubmitting ? 'Criando...' : 'Criar usuario'}
            </Button>
          </div>
        </form>
      )}
    </AppDialog>
  )
}

type AccessTypeOptionProps = {
  description: string
  isSelected: boolean
  label: string
  value: string
}

function AccessTypeOption({
  description,
  isSelected,
  label,
  value,
}: AccessTypeOptionProps) {
  return (
    <label
      className={
        'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors ' +
        (isSelected
          ? 'border-primary/60 bg-primary/5'
          : 'border-border bg-background hover:bg-muted/40')
      }
      htmlFor={`access-type-${value}`}
    >
      <RadioGroupItem
        className="mt-0.5"
        id={`access-type-${value}`}
        value={value}
      />
      <div className="grid gap-0.5">
        <span className="text-sm font-medium text-foreground">{label}</span>
        <span className="text-xs text-muted-foreground">{description}</span>
      </div>
    </label>
  )
}
