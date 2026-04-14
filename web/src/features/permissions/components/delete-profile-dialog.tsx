import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { useDeleteProfile } from '../services/permissions.mutations'
import type { ProfileListItem } from '../services/permissions.service'

type DeleteProfileDialogProps = {
  onClose: () => void
  profile: ProfileListItem
}

export function DeleteProfileDialog({
  onClose,
  profile,
}: DeleteProfileDialogProps) {
  const deleteMutation = useDeleteProfile()

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(profile.id)
      toast.success('Perfil excluido com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel excluir o perfil.',
      )
    }
  }

  return (
    <AppDialog
      icon={Trash2}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Excluir perfil"
      variant="destructive"
    >
      <div className="grid gap-4">
        <p className="text-sm text-muted-foreground">
          Tem certeza que deseja excluir o perfil{' '}
          <strong className="text-foreground">{profile.name}</strong>?
        </p>
        <p className="text-sm text-muted-foreground">
          Essa acao nao pode ser desfeita. Se houver usuarios vinculados, a
          exclusao sera bloqueada.
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            disabled={deleteMutation.isPending}
            onClick={onClose}
            type="button"
            variant="outline"
          >
            Cancelar
          </Button>
          <Button
            disabled={deleteMutation.isPending}
            onClick={handleDelete}
            type="button"
            variant="destructive"
          >
            {deleteMutation.isPending ? 'Excluindo...' : 'Excluir'}
          </Button>
        </div>
      </div>
    </AppDialog>
  )
}
