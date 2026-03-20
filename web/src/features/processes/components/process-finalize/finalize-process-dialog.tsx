import { CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { useFinalizeProcess } from '../../services/processes.mutations'

type FinalizeProcessDialogProps = {
  onClose: () => void
  open: boolean
  processId: string
  processName: string
}

export function FinalizeProcessDialog({
  onClose,
  open,
  processId,
  processName,
}: FinalizeProcessDialogProps) {
  const finalizeMutation = useFinalizeProcess(processId)

  async function handleConfirm() {
    try {
      await finalizeMutation.mutateAsync()
      toast.success('Processo finalizado com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel finalizar o processo.',
      )
    }
  }

  return (
    <AppDialog
      description="Ao finalizar, o processo sera marcado como concluido e nao podera mais ser alterado."
      icon={CheckCircle}
      maxWidth="lg"
      onClose={onClose}
      open={open}
      title="Finalizar processo"
      variant="success"
    >
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
        <p className="text-sm text-muted-foreground">Processo</p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {processName}
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={finalizeMutation.isPending}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Cancelar
        </Button>
        <Button
          disabled={finalizeMutation.isPending}
          onClick={handleConfirm}
          type="button"
        >
          {finalizeMutation.isPending
            ? 'Finalizando...'
            : 'Confirmar finalizacao'}
        </Button>
      </div>
    </AppDialog>
  )
}
