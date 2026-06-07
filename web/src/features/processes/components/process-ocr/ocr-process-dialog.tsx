import { useNavigate } from '@tanstack/react-router'
import { Loader2, ScanLine } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Checkbox } from '#/components/ui/checkbox'
import { AppDialog } from '@/shared/components/app-dialog'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { useCreateProcessViaOcr } from '../../services/processes.mutations'

type OcrProcessDialogProps = {
  open: boolean
  onClose: () => void
}

export function OcrProcessDialog({ open, onClose }: OcrProcessDialogProps) {
  const navigate = useNavigate()
  const consentId = useId()
  const [consent, setConsent] = useState(false)
  const ocrMutation = useCreateProcessViaOcr()
  const isProcessing = ocrMutation.isPending

  function handleClose() {
    if (isProcessing) {
      return
    }
    setConsent(false)
    ocrMutation.reset()
    onClose()
  }

  async function handleScanComplete(file: File) {
    try {
      const result = await ocrMutation.mutateAsync(file)
      toast.success(
        'Documento enviado. O cadastro esta sendo processado por IA.',
      )
      setConsent(false)
      ocrMutation.reset()
      onClose()
      void navigate({
        to: '/processos/$processId/checklist',
        params: { processId: result.processId },
      })
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel iniciar o cadastro por OCR.',
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
      title="Novo processo OCR"
      variant="info"
    >
      <div className="grid gap-5">
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <Checkbox
            checked={consent}
            disabled={isProcessing}
            id={consentId}
            onCheckedChange={(checked) => setConsent(checked === true)}
          />
          <label className="text-sm text-muted-foreground" htmlFor={consentId}>
            Estou ciente de que as imagens dos documentos serao processadas por
            um servico de inteligencia artificial (Anthropic) para extracao dos
            dados.
          </label>
        </div>

        {isProcessing ? (
          <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card px-4 py-6 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Enviando documento...
          </div>
        ) : (
          <div className="grid gap-2">
            <ScanButton disabled={!consent} onComplete={handleScanComplete} />
            {!consent ? (
              <p className="text-center text-xs text-muted-foreground">
                Confirme o consentimento para habilitar a captura.
              </p>
            ) : null}
          </div>
        )}
      </div>
    </AppDialog>
  )
}
