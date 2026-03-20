import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { useDeleteHousingComplex } from '../services/admin-housing-complexes.mutations'
import type { HousingComplexListItem } from '../services/admin-housing-complexes.service'

type DeleteHousingComplexDialogProps = {
  housingComplex: HousingComplexListItem
  onClose: () => void
}

export function DeleteHousingComplexDialog({
  housingComplex,
  onClose,
}: DeleteHousingComplexDialogProps) {
  const deleteMutation = useDeleteHousingComplex()

  async function handleDelete() {
    try {
      await deleteMutation.mutateAsync(housingComplex.id)
      toast.success('Conjunto excluido com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel excluir o conjunto.',
      )
    }
  }

  return (
    <AppDialog
      icon={Trash2}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Excluir conjunto"
      variant="destructive"
    >
      <p className="text-sm text-muted-foreground">
        Tem certeza que deseja excluir o conjunto{' '}
        <strong className="text-foreground">{housingComplex.name}</strong>?
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
    </AppDialog>
  )
}
