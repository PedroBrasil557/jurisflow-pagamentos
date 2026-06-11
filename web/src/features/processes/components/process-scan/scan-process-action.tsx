import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { useCreateProcessViaScan } from '../../services/processes.mutations'

// Acao de "Escanear documentos": o botao abre a camera direto (sem dialogo
// intermediario). Ao concluir a captura, envia o documento e, enquanto a IA
// processa, mostra um overlay de tela cheia. NAO navega: o usuario permanece na
// lista para escanear/importar varios em sequencia (a IA preenche os campos em
// background; o novo processo aparece no topo da lista, ja atualizada).
export function ScanProcessAction() {
  const scanMutation = useCreateProcessViaScan()

  async function handleScanComplete(file: File) {
    try {
      await scanMutation.mutateAsync(file)
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
