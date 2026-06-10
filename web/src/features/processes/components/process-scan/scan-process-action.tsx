import { useNavigate } from '@tanstack/react-router'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { useCreateProcessViaScan } from '../../services/processes.mutations'

// Acao de "Escanear documentos": o botao abre a camera direto (sem dialogo
// intermediario). Ao concluir a captura, envia o documento e, enquanto a IA
// processa, mostra um overlay de tela cheia; ao terminar, navega para o
// checklist do processo criado.
export function ScanProcessAction() {
  const navigate = useNavigate()
  const scanMutation = useCreateProcessViaScan()

  async function handleScanComplete(file: File) {
    try {
      const result = await scanMutation.mutateAsync(file)
      toast.success(
        'Documento enviado. O cadastro esta sendo processado por IA.',
      )
      scanMutation.reset()
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
    <>
      <ScanButton
        className="h-12 w-full sm:h-9 sm:w-auto"
        disabled={scanMutation.isPending}
        label="Escanear documentos"
        onComplete={handleScanComplete}
      />

      {scanMutation.isPending ? (
        <output className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm">
          <Loader2 aria-hidden className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Enviando documento...</p>
        </output>
      ) : null}
    </>
  )
}
