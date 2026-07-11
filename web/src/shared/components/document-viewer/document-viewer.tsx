import { cn } from '#/lib/utils'
import { PdfViewer } from '@/shared/components/pdf-viewer/pdf-viewer'

type DocumentViewerProps = {
  // URL pre-assinada do conteudo — o browser busca os bytes direto do storage.
  url: string
  mimeType: string
  fileName?: string
  className?: string
}

// Viewer generico que roteia por mimeType: PDF reusa o PdfViewer (react-pdf, zoom,
// paginacao); imagem renderiza inline; outros tipos caem numa mensagem (o download
// continua disponivel no dialog que embrulha este componente).
export function DocumentViewer({
  url,
  mimeType,
  fileName,
  className,
}: DocumentViewerProps) {
  if (mimeType === 'application/pdf') {
    return <PdfViewer className={className} url={url} />
  }

  if (mimeType.startsWith('image/')) {
    return (
      <div
        className={cn(
          'flex h-full w-full items-center justify-center overflow-auto bg-muted/40 p-4',
          className,
        )}
      >
        <img
          alt={fileName ?? 'Documento'}
          className="max-h-full max-w-full object-contain"
          src={url}
        />
      </div>
    )
  }

  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center bg-muted/40 p-6 text-center',
        className,
      )}
    >
      <p className="text-sm text-muted-foreground">
        Pre-visualizacao nao disponivel para este tipo de arquivo. Use "Baixar"
        para abrir.
      </p>
    </div>
  )
}
