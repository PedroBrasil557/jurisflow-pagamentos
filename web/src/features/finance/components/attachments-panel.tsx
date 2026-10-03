import { useQuery } from '@tanstack/react-query'
import { Download, Paperclip, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Label } from '#/components/ui/label'
import { Textarea } from '#/components/ui/textarea'
import { AppDialog } from '@/shared/components/app-dialog'
import { formatInstant } from '../lib/finance-money'
import {
  useRemoveAttachment,
  useUploadAttachment,
} from '../services/finance.mutations'
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
  const remove = useRemoveAttachment()
  const input = useRef<HTMLInputElement>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removeName, setRemoveName] = useState('')
  const [removeReason, setRemoveReason] = useState('')
  const [removeError, setRemoveError] = useState<string | null>(null)

  function closeRemove() {
    setRemoveId(null)
    setRemoveName('')
    setRemoveReason('')
    setRemoveError(null)
  }

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
            <div className="flex items-center gap-1">
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
              {canUpload ? (
                <Button
                  aria-label={`Remover ${file.originalFileName}`}
                  onClick={() => {
                    setRemoveId(file.id)
                    setRemoveName(file.originalFileName)
                    setRemoveReason('')
                    setRemoveError(null)
                  }}
                  size="icon-sm"
                  variant="ghost"
                >
                  <Trash2 className="size-4" />
                </Button>
              ) : null}
            </div>
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
                {
                  onSuccess: () => toast.success('Comprovante anexado.'),
                  onError: (error) => toast.error((error as Error).message),
                },
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

      {removeId ? (
        <AppDialog
          description="O comprovante deixará de aparecer e de poder ser baixado pelo sistema. O registro de auditoria será preservado."
          footer={
            <Button
              disabled={removeReason.trim().length < 3 || remove.isPending}
              onClick={() => {
                setRemoveError(null)
                remove.mutate(
                  { id: removeId, reason: removeReason },
                  {
                    onSuccess: () => {
                      toast.success('Comprovante removido.')
                      closeRemove()
                    },
                    onError: (error) =>
                      setRemoveError((error as Error).message),
                  },
                )
              }}
              variant="destructive"
            >
              {remove.isPending ? 'Removendo…' : 'Remover comprovante'}
            </Button>
          }
          icon={Trash2}
          maxWidth="md"
          onClose={closeRemove}
          open
          title={`Remover ${removeName}`}
          variant="destructive"
        >
          <div className="grid gap-2">
            <Label htmlFor={`attachment-remove-${removeId}`}>
              Motivo da remoção
            </Label>
            <Textarea
              id={`attachment-remove-${removeId}`}
              onChange={(event) => setRemoveReason(event.target.value)}
              placeholder="Ex.: arquivo anexado incorretamente"
              rows={3}
              value={removeReason}
            />
            {removeError ? (
              <p className="text-sm text-destructive">{removeError}</p>
            ) : null}
          </div>
        </AppDialog>
      ) : null}
    </div>
  )
}
