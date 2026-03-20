import { Pencil } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { NativeSelect } from '#/components/ui/native-select'
import { AppDialog } from '@/shared/components/app-dialog'
import { useUpdateAdminUser } from '../services/admin-users.mutations'
import type { AdminUserListItem } from '../services/admin-users.service'

type EditUserDialogProps = {
  onClose: () => void
  open: boolean
  user: AdminUserListItem
}

const roleOptions = [
  { value: 'user', label: 'Usuario' },
  { value: 'attorney', label: 'Advogado' },
  { value: 'admin', label: 'Administrador' },
]

function isInternalEmail(email: string) {
  return email.endsWith('@internal.local')
}

export function EditUserDialog({ onClose, open, user }: EditUserDialogProps) {
  const [name, setName] = useState(user.name)
  const [email, setEmail] = useState(
    isInternalEmail(user.email) ? '' : user.email,
  )
  const [role, setRole] = useState<'user' | 'admin' | 'attorney'>(user.role)
  const updateMutation = useUpdateAdminUser()

  useEffect(() => {
    setName(user.name)
    setEmail(isInternalEmail(user.email) ? '' : user.email)
    setRole(user.role)
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
          role,
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
          <label className="text-sm font-medium" htmlFor="edit-name">
            Nome
          </label>
          <Input
            id="edit-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome completo"
            value={name}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="edit-email">
            E-mail (opcional)
          </label>
          <Input
            id="edit-email"
            onChange={(e) => setEmail(e.target.value)}
            placeholder="email@empresa.com"
            type="email"
            value={email}
          />
        </div>

        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="edit-role">
            Perfil
          </label>
          <NativeSelect
            className="w-full"
            id="edit-role"
            onChange={(e) =>
              setRole(e.target.value as 'user' | 'admin' | 'attorney')
            }
            value={role}
          >
            {roleOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
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
