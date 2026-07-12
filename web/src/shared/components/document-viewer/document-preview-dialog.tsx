import { Eye, Loader2 } from 'lucide-react'
import { AppDialog } from '@/shared/components/app-dialog'
import { DocumentViewer } from '@/shared/components/document-viewer/document-viewer'
import { QueryError } from '@/shared/components/query-error'

type DocumentPreviewDialogProps = {
  open: boolean
  title: string
  mimeType: string
  url: string | undefined
  isPending: boolean
  isError: boolean
  onRetry: () => void
  onClose: () => void
}

// Dialogo em tela cheia que renderiza o viewer de documento (react-pdf / <img>).
// A URL pre-assinada e obtida pelo chamador (cada feature tem sua propria query,
// pois a origem do arquivo difere) — aqui so orquestramos os estados de
// carregamento/erro/pronto dentro do AppDialog. Os bytes vem DIRETO do S3/MinIO.
export function DocumentPreviewDialog({
  open,
  title,
  mimeType,
  url,
  isPending,
  isError,
  onRetry,
  onClose,
}: DocumentPreviewDialogProps) {
  return (
    <AppDialog
      icon={Eye}
      maxWidth="screen"
      onClose={onClose}
      open={open}
      title={title}
      variant="info"
    >
      <div className="h-[80vh] overflow-hidden rounded-md border border-border">
        {isPending ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <QueryError
            message="Nao foi possivel carregar o documento."
            onRetry={onRetry}
          />
        ) : url ? (
          <DocumentViewer fileName={title} mimeType={mimeType} url={url} />
        ) : null}
      </div>
    </AppDialog>
  )
}
