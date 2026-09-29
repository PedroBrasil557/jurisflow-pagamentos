import { useQuery } from '@tanstack/react-query'
import { Download, Paperclip } from 'lucide-react'
import { useRef } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { formatInstant } from '../lib/finance-money'
import { useUploadAttachment } from '../services/finance.mutations'
import { attachmentsQuery } from '../services/finance.queries'
import {
  attachmentDownloadUrl,
  downloadAuthenticated,
} from '../services/finance.service'

/** Comprovantes privados: download sempre pela API autenticada. */
export function AttachmentsPanel({
  ownerKind,
  ownerId,
  canUpload,
}: {
  ownerKind: 'receipt' | 'payout' | 'reserve'
  ownerId: string
  canUpload: boolean
}) {
  const query = useQuery(attachmentsQuery(ownerKind, ownerId))
  const upload = useUploadAttachment()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="grid gap-2">
      {query.data?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum comprovante anexado.
        </p>
      ) : null}
      {query.isError ? (
        <p className="text-sm text-destructive">
          {query.error instanceof Error
            ? query.error.message
            : 'Falha ao carregar comprovantes.'}
        </p>
      ) : null}
      <ul className="grid gap-1">
        {query.data?.map((file) => (
          <li
            className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            key={file.id}
          >
            <span className="min-w-0 truncate">
              {file.originalFileName}
              <span className="block text-xs text-muted-foreground">
                {(file.sizeInBytes / 1024).toFixed(0)} KB ·{' '}
                {formatInstant(file.uploadedAt)}
              </span>
            </span>
            <Button
              aria-label={`Baixar ${file.originalFileName}`}
              onClick={() =>
                downloadAuthenticated(
                  attachmentDownloadUrl(file.id),
                  file.originalFileName,
                ).catch((error: Error) => toast.error(error.message))
              }
              size="icon-sm"
              variant="ghost"
            >
              <Download className="size-4" />
            </Button>
          </li>
        ))}
      </ul>
      {canUpload ? (
        <>
          <input
            accept="application/pdf,image/png,image/jpeg"
            className="sr-only"
            id={`upload-${ownerKind}-${ownerId}`}
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              upload.mutate(
                { ownerKind, ownerId, file },
                { onSuccess: () => toast.success('Comprovante anexado.') },
              )
              event.target.value = ''
            }}
            ref={input}
            type="file"
          />
          <Button
            className="justify-self-start"
            disabled={upload.isPending}
            onClick={() => input.current?.click()}
            size="sm"
            variant="outline"
          >
            <Paperclip className="size-4" />
            {upload.isPending
              ? 'Enviando…'
              : 'Anexar comprovante (PDF, JPG, PNG)'}
          </Button>
        </>
      ) : null}
    </div>
  )
}
