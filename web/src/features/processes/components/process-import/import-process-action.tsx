import { useNavigate } from '@tanstack/react-router'
import { FileUp, Loader2 } from 'lucide-react'
import { type ChangeEvent, useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { useImportDocument } from '../../services/processes.mutations'

// Acao "Importar documentos": abre um seletor de arquivo (PDF), cria o processo
// via ingestao durável/assincrona (mesma do scan) e navega para o editor, onde o
// usuario acompanha o processamento (banner da Fase 1) e revisa/salva.
export function ImportProcessAction() {
  const navigate = useNavigate()
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

    try {
      const result = await importMutation.mutateAsync(files)
      toast.success(
        files.length === 1
          ? 'Documento enviado. O cadastro esta sendo processado por IA.'
          : `${files.length} documentos enviados. O cadastro esta sendo processado por IA.`,
      )
      importMutation.reset()
      void navigate({
        to: '/processos/$processId/editar',
        params: { processId: result.processId },
      })
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
