import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  type ChangeInitialPasswordInput,
  type ChangeInitialPasswordPayload,
  changeInitialPasswordFormSchema,
} from '@/features/auth/schemas/auth.schema'
import { changeInitialPasswordRequest } from '@/features/auth/services/auth-account'
import { authClient } from '@/features/auth/services/auth-client'
import { PasswordInput } from '@/shared/components/password-input'
import { useZodForm } from '@/shared/components/ui/form'

type FirstAccessPageProps = {
  user: {
    email: string
    name: string
  }
}

export function FirstAccessPage({ user }: FirstAccessPageProps) {
  const navigate = useNavigate({ from: '/primeiro-acesso' })
  const {
    clearErrors,
    formState: { errors, isSubmitting },
    handleSubmit,
    register,
    setError,
  } = useZodForm<ChangeInitialPasswordInput, ChangeInitialPasswordPayload>({
    defaultValues: {
      confirmPassword: '',
      newPassword: '',
    },
    schema: changeInitialPasswordFormSchema,
  })

  async function handleChangePassword(values: ChangeInitialPasswordPayload) {
    try {
      const result = await changeInitialPasswordRequest(values.newPassword)

      toast.success(result.message)

      await navigate({ to: '/' })
    } catch (error) {
      setError('root', {
        message:
          error instanceof Error
            ? error.message
            : 'Nao foi possivel atualizar a senha inicial.',
      })
    }
  }

  async function handleSignOut() {
    await authClient.signOut()
    await navigate({ to: '/login' })
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl justify-center px-4 py-8">
      <Card className="w-full">
        <CardContent className="gap-6 p-6">
          <div className="space-y-2">
            <p className="text-xs font-medium text-primary">Primeiro acesso</p>
            <h1 className="text-3xl font-bold text-foreground">
              Defina uma nova senha para continuar
            </h1>
            <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
              Esta conta foi criada com uma senha temporaria. Antes de acessar o
              restante do sistema, e preciso cadastrar uma nova senha para{' '}
              <span className="font-semibold text-foreground">{user.name}</span>
              .
            </p>
            {user.email.endsWith('@internal.local') ? null : (
              <p className="text-sm text-muted-foreground">{user.email}</p>
            )}
          </div>

          <form
            className="grid gap-4"
            noValidate
            onSubmit={handleSubmit(handleChangePassword)}
          >
            <div className="flex w-full flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="newPassword">
                Nova senha *
              </label>
              <PasswordInput
                id="newPassword"
                placeholder="Digite a nova senha"
                {...register('newPassword', {
                  onChange: () => clearErrors('root'),
                })}
              />
              {errors.newPassword?.message ? (
                <p className="text-sm text-destructive">
                  {errors.newPassword.message}
                </p>
              ) : null}
            </div>

            <div className="flex w-full flex-col gap-1.5">
              <label className="text-sm font-medium" htmlFor="confirmPassword">
                Confirmar nova senha *
              </label>
              <PasswordInput
                id="confirmPassword"
                placeholder="Confirme a nova senha"
                {...register('confirmPassword', {
                  onChange: () => clearErrors('root'),
                })}
              />
              {errors.confirmPassword?.message ? (
                <p className="text-sm text-destructive">
                  {errors.confirmPassword.message}
                </p>
              ) : null}
            </div>

            {errors.root?.message ? (
              <p className="text-sm text-destructive">{errors.root.message}</p>
            ) : null}

            <div className="mt-2 flex flex-col gap-3 sm:flex-row">
              <Button
                className="sm:flex-1"
                disabled={isSubmitting}
                type="submit"
              >
                {isSubmitting ? 'Salvando...' : 'Salvar nova senha'}
              </Button>

              <Button
                disabled={isSubmitting}
                onClick={handleSignOut}
                type="button"
                variant="ghost"
              >
                Sair
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </main>
  )
}
