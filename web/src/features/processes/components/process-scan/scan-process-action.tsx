import { Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { clearScanSession } from '@/shared/components/document-scanner/scan-session-store'
import { useCreateProcessViaScan } from '../../services/processes.mutations'

// Acao de "Escanear documentos": o botao abre a camera direto (sem dialogo
// intermediario). Ao concluir a captura, envia o documento (PDF) DIRETO ao S3
// (pre-assinado) e, enquanto a IA processa, mostra um overlay de tela cheia com
// o progresso do upload. NAO navega: o usuario permanece na lista para
// escanear/importar varios em sequencia (a IA preenche os campos em background;
// o novo processo aparece no topo da lista, ja atualizada).
export function ScanProcessAction() {
  const scanMutation = useCreateProcessViaScan()
  const [uploadProgress, setUploadProgress] = useState<number | null>(null)

  async function handleScanComplete(file: File, scanSessionId: string | null) {
    setUploadProgress(0)
    try {
      await scanMutation.mutateAsync({
        pdf: file,
        onProgress: (fraction) => setUploadProgress(fraction),
      })
      // Upload confirmado: agora e seguro liberar a sessao duravel do IndexedDB.
      // (Se o upload falhar, a sessao permanece e pode ser recuperada.)
      if (scanSessionId) {
        void clearScanSession(scanSessionId)
      }
      toast.success(
        'Documento enviado. O cadastro esta sendo processado por IA.',
      )
      scanMutation.reset()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel iniciar a digitalizacao.',
      )
    } finally {
      setUploadProgress(null)
    }
  }

  const percent =
    uploadProgress === null ? null : Math.round(uploadProgress * 100)

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
          <p className="text-sm text-muted-foreground">
            {percent !== null && percent < 100
              ? `Enviando documento... ${percent}%`
              : 'Processando documento...'}
          </p>
        </output>
      ) : null}
    </>
  )
}
