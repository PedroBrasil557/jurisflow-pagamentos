import { UserPlus } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { FormInput, FormSelect, useZodForm } from '@/shared/components/ui/form'
import {
  type AdminUserFormInput,
  type AdminUserFormPayload,
  adminUserFormSchema,
} from '../schemas/admin-user-form.schema'
import { useCreateAdminUser } from '../services/admin-users.mutations'

const userRoleOptions = [
  { label: 'Selecione...', value: '' },
  { label: 'Usuario', value: 'user' },
  { label: 'Advogado', value: 'attorney' },
  { label: 'Administrador', value: 'admin' },
] as const

export type CreateUserModalProps = {
  onClose: () => void
  onCreated: (payload: { temporaryPassword?: string | null }) => void
}

export function CreateUserModal({ onClose, onCreated }: CreateUserModalProps) {
  const [generatedPassword, setGeneratedPassword] = useState<string | null>(
    null,
  )
  const mutation = useCreateAdminUser()
  const {
    clearErrors,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    reset,
    setError,
  } = useZodForm<AdminUserFormInput, AdminUserFormPayload>({
    defaultValues: {
      cpf: '',
      email: '',
      name: '',
      role: 'user',
    },
    schema: adminUserFormSchema,
  })

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

  return (
    <AppDialog
      icon={UserPlus}
      maxWidth="2xl"
      onClose={onClose}
      open={true}
      title="Novo usuario"
      description="Cadastre um novo usuario na plataforma."
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

            <FormSelect
              error={errors.role?.message}
              label="Perfil"
              options={userRoleOptions}
              required
              {...register('role', {
                onChange: () => clearErrors('root'),
              })}
            />
          </div>

          <FormInput
            error={errors.email?.message}
            label="E-mail"
            placeholder="usuario@empresa.com (opcional)"
            type="email"
            {...register('email', {
              onChange: () => clearErrors('root'),
            })}
          />

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
