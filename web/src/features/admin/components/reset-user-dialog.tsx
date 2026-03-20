import { KeyRound } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { useResetUserAccount } from '../services/admin-users.mutations'
import type { AdminUserListItem } from '../services/admin-users.service'

type ResetUserDialogProps = {
  onClose: () => void
  user: AdminUserListItem
}

export function ResetUserDialog({ onClose, user }: ResetUserDialogProps) {
  const [temporaryPassword, setTemporaryPassword] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const mutation = useResetUserAccount()

  async function handleReset() {
    try {
      setError(null)
      const result = await mutation.mutateAsync(user.id)
      setTemporaryPassword(result.temporaryPassword)
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Nao foi possivel resetar a conta do usuario.',
      )
    }
  }

  async function handleCopyPassword() {
    if (!temporaryPassword) {
      return
    }

    await navigator.clipboard.writeText(temporaryPassword)
    toast.success('Senha temporaria copiada.')
  }

  if (temporaryPassword) {
    return (
      <AppDialog
        icon={KeyRound}
        onClose={onClose}
        open={true}
        title="Conta resetada"
        variant="success"
      >
        <div className="grid gap-5">
          <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/15 px-4 py-3 text-emerald-600 dark:text-emerald-400">
            <p className="text-sm font-medium">Senha temporaria gerada</p>
            <p className="mt-1 text-sm leading-6">
              Copie esta senha agora. O usuario sera obrigado a troca-la no
              proximo login.
            </p>
          </div>

          <div className="rounded-lg border border-border bg-muted/50 p-4">
            <p className="text-xs font-medium text-muted-foreground">
              Senha temporaria
            </p>
            <p className="mt-2 break-all font-mono text-lg font-semibold text-foreground">
              {temporaryPassword}
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
              onClick={onClose}
              type="button"
              variant="outline"
            >
              Fechar
            </Button>
          </div>
        </div>
      </AppDialog>
    )
  }

  return (
    <AppDialog
      icon={KeyRound}
      onClose={onClose}
      open={true}
      title="Resetar conta"
      variant="warning"
    >
      <div className="grid gap-5">
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <p className="text-sm font-medium text-foreground">{user.name}</p>
        </div>

        <p className="text-sm leading-6 text-muted-foreground">
          Isso vai gerar uma nova senha temporaria e o usuario sera obrigado a
          troca-la no proximo login.
        </p>

        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="ghost">
            Cancelar
          </Button>
          <Button
            disabled={mutation.isPending}
            onClick={handleReset}
            type="button"
            variant="destructive"
          >
            {mutation.isPending ? 'Resetando...' : 'Resetar conta'}
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
