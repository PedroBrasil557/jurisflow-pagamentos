import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useSession } from '@/features/auth/hooks/use-session'
import { AppDialog } from '@/shared/components/app-dialog'
import { useUpdateAdminUser } from '../services/admin-users.mutations'
import type { AdminUserListItem } from '../services/admin-users.service'

type EditUserDialogProps = {
  onClose: () => void
  open: boolean
  user: AdminUserListItem
}

function isInternalEmail(email: string) {
  return email.endsWith('@internal.local')
}

export function EditUserDialog({ onClose, open, user }: EditUserDialogProps) {
  const { user: currentUser } = useSession()
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(
    isInternalEmail(user.email) ? '' : user.email,
  )
  const [isAdmin, setIsAdmin] = useState(user.role === 'admin')
  const updateMutation = useUpdateAdminUser()

  const isEditingSelf = currentUser.id === user.id
  const isSelfAdmin = isEditingSelf && user.role === 'admin'

  useEffect(() => {
    setName(user.name)
    setEmail(isInternalEmail(user.email) ? '' : user.email)
    setIsAdmin(user.role === 'admin')
  }, [user])

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Informe o nome.')
      return
    }

    try {
      await updateMutation.mutateAsync({
        userId: user.id,
        payload: {
          name: name.trim(),
          email: email.trim() || undefined,
          isAdmin,
        },
      })
      toast.success('Usuario atualizado com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel atualizar o usuario.',
      )
    }
  }

  const wasAdmin = user.role === 'admin'
  const isPromotingFromUserToAdmin = !wasAdmin && isAdmin
  const isDemotingFromAdminToUser = wasAdmin && !isAdmin

  return (
    <AppDialog
      description={`CPF: ${user.cpf ?? ''}`}
      icon={Pencil}
      maxWidth="lg"
      onClose={onClose}
      open={open}
      title="Editar usuario"
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <Label htmlFor="edit-name">Nome</Label>
          <Input
            id="edit-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
            value={name}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="edit-email">E-mail (opcional)</Label>
          <Input
            id="edit-email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            type="email"
            value={email}
          />
        </div>

        <div className="grid gap-2">
          <span className="text-sm font-medium text-foreground">
            Tipo de acesso
          </span>
          <label
            className={
              'flex items-start gap-3 rounded-lg border border-border bg-background p-3 ' +
              (isSelfAdmin
                ? 'cursor-not-allowed opacity-60'
                : 'cursor-pointer hover:bg-muted/40')
            }
            htmlFor="edit-is-admin"
          >
            <Checkbox
              checked={isAdmin}
              className="mt-0.5"
              disabled={isSelfAdmin}
              id="edit-is-admin"
              onCheckedChange={(checked) => {
                if (checked === 'indeterminate') return
                setIsAdmin(checked)
              }}
            />
            <div className="grid gap-0.5">
              <span className="text-sm font-medium text-foreground">
                Administrador
              </span>
              <span className="text-xs text-muted-foreground">
                Acesso total a plataforma. Quando desmarcado, o usuario passa a
                usar perfil de permissoes.
              </span>
            </div>
          </label>
          {isSelfAdmin ? (
            <p className="text-xs text-muted-foreground">
              Voce nao pode remover seu proprio acesso de administrador.
            </p>
          ) : null}
          {!isSelfAdmin && isPromotingFromUserToAdmin ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              O perfil atual sera removido ao promover para administrador.
            </p>
          ) : null}
          {!isSelfAdmin && isDemotingFromAdminToUser ? (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              O usuario sera vinculado ao perfil "Usuario Padrao". Voce pode
              ajustar depois em Permissoes.
            </p>
          ) : null}
        </div>
      </div>

      <div className="mt-4 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={updateMutation.isPending}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancelar
        </Button>
        <Button
          disabled={updateMutation.isPending}
          onClick={handleSubmit}
          type="button"
        >
          {updateMutation.isPending ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </AppDialog>
  )
}
