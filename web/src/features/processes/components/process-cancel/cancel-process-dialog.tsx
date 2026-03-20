import { XCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { AppDialog } from '@/shared/components/app-dialog'
import { useCancelProcess } from '../../services/processes.mutations'

type CancelProcessDialogProps = {
  onClose: () => void
  open: boolean
  processId: string
  processName: string
}

export function CancelProcessDialog({
  onClose,
  open,
  processId,
  processName,
}: CancelProcessDialogProps) {
  const [reason, setReason] = useState('')
  const cancelMutation = useCancelProcess(processId)

  async function handleConfirm() {
    try {
      await cancelMutation.mutateAsync(reason || undefined)
      toast.success('Processo cancelado com sucesso.')
      onClose()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel cancelar o processo.',
      )
    }
  }

  return (
    <AppDialog
      description="Esta acao nao pode ser desfeita. O processo sera marcado como cancelado permanentemente."
      icon={XCircle}
      maxWidth="lg"
      onClose={onClose}
      open={open}
      title="Cancelar processo"
      variant="destructive"
    >
      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <p className="text-sm text-muted-foreground">Processo</p>
        <p className="mt-1 text-sm font-medium text-foreground">
          {processName}
        </p>
      </div>

      <div className="grid gap-2">
        <label
          className="text-sm font-medium text-foreground"
          htmlFor="cancel-reason"
        >
          Motivo do cancelamento (opcional)
        </label>
        <Textarea
          id="cancel-reason"
          maxLength={500}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Descreva o motivo do cancelamento..."
          rows={3}
          value={reason}
        />
        <p className="text-right text-xs text-muted-foreground">
          {reason.length}/500
        </p>
      </div>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button
          disabled={cancelMutation.isPending}
          onClick={onClose}
          type="button"
          variant="outline"
        >
          Voltar
        </Button>
        <Button
          disabled={cancelMutation.isPending}
          onClick={handleConfirm}
          type="button"
          variant="destructive"
        >
          {cancelMutation.isPending
            ? 'Cancelando...'
            : 'Confirmar cancelamento'}
        </Button>
      </div>
    </AppDialog>
  )
}
