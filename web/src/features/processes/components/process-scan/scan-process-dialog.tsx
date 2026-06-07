import { useNavigate } from '@tanstack/react-router'
import { Loader2, ScanLine } from 'lucide-react'
import { toast } from 'sonner'
import { AppDialog } from '@/shared/components/app-dialog'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { useCreateProcessViaScan } from '../../services/processes.mutations'

type ScanProcessDialogProps = {
  open: boolean
  onClose: () => void
}

export function ScanProcessDialog({ open, onClose }: ScanProcessDialogProps) {
  const navigate = useNavigate()
  const scanMutation = useCreateProcessViaScan()
  const isProcessing = scanMutation.isPending

  function handleClose() {
    if (isProcessing) {
      return
    }
    scanMutation.reset()
    onClose()
  }

  async function handleScanComplete(file: File) {
    try {
      const result = await scanMutation.mutateAsync(file)
      toast.success(
        'Documento enviado. O cadastro esta sendo processado por IA.',
      )
      scanMutation.reset()
      onClose()
      void navigate({
        to: '/processos/$processId/checklist',
        params: { processId: result.processId },
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel iniciar a digitalizacao.',
      )
    }
  }

  return (
    <AppDialog
      description="Bata as fotos dos documentos. A IA classifica, extrai os dados, cria o processo e separa os documentos no checklist automaticamente."
      icon={ScanLine}
      maxWidth="lg"
      onClose={handleClose}
      open={open}
      title="Escanear documentos"
      variant="info"
    >
      <div className="grid gap-5">
        {isProcessing ? (
          <output className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            <Loader2 aria-hidden className="size-4 animate-spin" />
            Enviando documento...
          </output>
        ) : (
          <ScanButton onComplete={handleScanComplete} />
        )}
      </div>
    </AppDialog>
  )
}
