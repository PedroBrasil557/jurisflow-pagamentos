import { Pencil } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Input } from '#/components/ui/input'
import { AppDialog } from '@/shared/components/app-dialog'
import { useUpdateHousingComplex } from '../services/admin-housing-complexes.mutations'
import type { HousingComplexListItem } from '../services/admin-housing-complexes.service'

type EditHousingComplexDialogProps = {
  housingComplex: HousingComplexListItem
  onClose: () => void
}

export function EditHousingComplexDialog({
  housingComplex,
  onClose,
}: EditHousingComplexDialogProps) {
  const [name, setName] = useState(housingComplex.name)
  const updateMutation = useUpdateHousingComplex()

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Informe o nome do conjunto.')
      return
    }

    try {
      await updateMutation.mutateAsync({
        housingComplexId: housingComplex.id,
        payload: { name: name.trim() },
      })
      toast.success('Conjunto atualizado com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel atualizar o conjunto.',
      )
    }
  }

  return (
    <AppDialog
      icon={Pencil}
      maxWidth="lg"
      onClose={onClose}
      open={true}
      title="Editar conjunto"
    >
      <div className="grid gap-4">
        <div className="grid gap-2">
          <label className="text-sm font-medium" htmlFor="edit-hc-name">
            Nome
          </label>
          <Input
            id="edit-hc-name"
            onChange={(e) => setName(e.target.value)}
            placeholder="Nome do conjunto"
            value={name}
          />
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
