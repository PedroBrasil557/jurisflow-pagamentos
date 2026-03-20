import { useNavigate, useSearch } from '@tanstack/react-router'
import { Controller } from 'react-hook-form'
import { Button } from '#/components/ui/button'
import { Card, CardContent } from '#/components/ui/card'
import {
  type SignInInput,
  type SignInPayload,
  signInSchema,
} from '@/features/auth/schemas/auth.schema'
import { authClient } from '@/features/auth/services/auth-client'
import { getSafeRedirectPath } from '@/features/auth/utils/auth-redirect'
import { formatCpf } from '@/features/auth/utils/cpf'
import { PasswordInput } from '@/shared/components/password-input'
import { FormInput, useZodForm } from '@/shared/components/ui/form'

export function LoginPage() {
  const navigate = useNavigate({ from: '/login' })
  const search = useSearch({ from: '/login' })
  const {
    clearErrors,
    control,
    formState: { errors, isSubmitting },
    handleSubmit,
    setError,
  } = useZodForm<SignInInput, SignInPayload>({
    defaultValues: {
      cpf: '',
      password: '',
    },
    schema: signInSchema,
  })

  const redirectTo = getSafeRedirectPath(search.redirect)

  async function handleLogin(values: SignInPayload) {
    const result = await authClient.signIn.username({
      username: values.cpf,
      password: values.password,
    })

    if (result.error) {
      setError('root', {
        message: result.error.message ?? 'Nao foi possivel fazer login.',
      })
      return
    }

    await navigate({ href: redirectTo })
  }

  return (
    <main className="page-wrap flex min-h-screen items-center px-4 py-12">
      <section className="mx-auto w-full max-w-md">
        <Card>
          <CardContent className="gap-5 p-6">
            <div>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary text-xs font-bold text-primary-foreground">
                  JF
                </div>
                <span className="text-lg font-semibold text-foreground">
                  JurisFlow
                </span>
              </div>
              <p className="mb-2 text-xs font-medium text-primary">Sessao</p>
              <h1 className="text-3xl font-bold text-foreground">Entrar</h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Acesse sua conta para entrar na area protegida.
              </p>
            </div>

            <form
              className="space-y-4"
              noValidate
              onSubmit={handleSubmit(handleLogin)}
            >
              <Controller
                control={control}
                name="cpf"
                render={({ field }) => (
                  <FormInput
                    error={errors.cpf?.message}
                    inputMode="numeric"
                    label="CPF"
                    maxLength={14}
                    placeholder="000.000.000-00"
                    required
                    type="text"
                    value={field.value}
                    onBlur={field.onBlur}
                    onChange={(event) => {
                      field.onChange(formatCpf(event.target.value))
                      clearErrors('root')
                    }}
                    ref={field.ref}
                  />
                )}
              />

              <div className="flex w-full flex-col gap-1.5">
                <label className="text-sm font-medium" htmlFor="password">
                  Senha *
                </label>
                <PasswordInput
                  id="password"
                  placeholder="Sua senha"
                  {...control.register('password', {
                    onChange: () => clearErrors('root'),
                  })}
                />
                {errors.password?.message ? (
                  <p className="text-sm text-destructive">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>

              {errors.root?.message ? (
                <p className="text-sm text-destructive">
                  {errors.root.message}
                </p>
              ) : null}

              <Button className="w-full" disabled={isSubmitting} type="submit">
                {isSubmitting ? 'Entrando...' : 'Entrar'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
