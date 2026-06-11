import { FileUp, Loader2 } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { useImportDocument } from '../../services/processes.mutations'

// Limite por arquivo (alinhado ao backend). Como o upload e pre-assinado (direto
// no S3), nao ha o teto de 10MB do API Gateway.
const MAX_IMPORT_FILE_BYTES = 25 * 1024 * 1024

// Acao "Importar documentos": abre um seletor de arquivo (PDF) e cria o processo
// via ingestao durável/assincrona (mesma do scan). NAO navega: o usuario
// permanece na lista para importar/escanear varios em sequencia (a IA preenche os
// campos em background; o novo processo aparece no topo da lista, ja atualizada).
export function ImportProcessAction() {
  const importMutation = useImportDocument()
  const inputRef = useRef<HTMLInputElement>(null)

  async function handleFileSelected(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    // Limpa para permitir re-selecionar os mesmos arquivos depois.
    event.target.value = ''
    if (files.length === 0) {
      return
    }
    if (files.some((file) => file.type.toLowerCase() !== 'application/pdf')) {
      toast.error('Envie apenas arquivos PDF.')
      return
    }
    const tooBig = files.find((file) => file.size > MAX_IMPORT_FILE_BYTES)
    if (tooBig) {
      toast.error(
        `"${tooBig.name}" excede 25 MB. Reduza a qualidade do scan ou divida o documento.`,
      )
      return
    }

    try {
      await importMutation.mutateAsync(files)
      toast.success(
        files.length === 1
          ? 'Documento enviado. O cadastro esta sendo processado por IA.'
          : `${files.length} documentos enviados. O cadastro esta sendo processado por IA.`,
      )
      importMutation.reset()
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel importar os documentos.',
      )
    }
  }

  return (
    <>
      <input
        accept="application/pdf"
        className="hidden"
        multiple
        onChange={handleFileSelected}
        ref={inputRef}
        type="file"
      />
      <Button
        className="h-12 w-full sm:h-9 sm:w-auto"
        disabled={importMutation.isPending}
        onClick={() => inputRef.current?.click()}
        type="button"
        variant="outline"
      >
        {importMutation.isPending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FileUp className="size-4" />
        )}
        Importar documentos
      </Button>

      {importMutation.isPending ? (
        <output className="fixed inset-0 z-[60] flex flex-col items-center justify-center gap-3 bg-background/90 backdrop-blur-sm">
          <Loader2 aria-hidden className="size-8 animate-spin text-primary" />
          <p className="text-sm text-muted-foreground">Enviando documento...</p>
        </output>
      ) : null}
    </>
  )
}
