import { Download, FileUp, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatBytes } from '@/shared/lib/format'
import type { ProcessBatchFile } from '../services/processes.service'

function BatchFileRow({
  canDelete,
  file,
  isSelected,
  isSplitting = false,
  onDelete,
  onDownload,
  onSplit,
  onToggleSelect,
}: {
  canDelete: boolean
  file: ProcessBatchFile
  isSelected: boolean
  isSplitting?: boolean
  onDelete: (fileId: string) => void
  onDownload: (fileId: string) => void
  onSplit?: (fileId: string) => void
  onToggleSelect: (fileId: string) => void
}) {
  const isPdf = file.mimeType === 'application/pdf'

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-3">
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onToggleSelect(file.id)}
        />
        <div className="grid gap-1">
          <p className="font-semibold text-foreground">
            {file.originalFileName}
          </p>
          <p className="text-xs text-muted-foreground">
            {`${formatBytes(file.sizeInBytes)} • ${file.uploadedBy.name}`}
          </p>
        </div>
      </div>

      <div className="flex gap-2">
        {isPdf && onSplit ? (
          <Button
            onClick={() => onSplit(file.id)}
            size="sm"
            type="button"
            variant="outline"
            disabled={isSplitting}
          >
            {isSplitting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Sparkles className="size-3.5" />
            )}
            Desmembrar
          </Button>
        ) : null}
        <Button
          onClick={() => onDownload(file.id)}
          size="sm"
          type="button"
          variant="outline"
        >
          <Download className="size-3.5" />
          Baixar
        </Button>
        <Button
          onClick={() => onDelete(file.id)}
          size="sm"
          type="button"
          variant="outline"
          className="text-destructive hover:text-destructive"
          disabled={!canDelete}
        >
          <Trash2 className="size-3.5" />
          Remover
        </Button>
      </div>
    </div>
  )
}

type BatchSectionProps = {
  batchFiles: ProcessBatchFile[]
  canDelete?: boolean
  canUpload?: boolean
  isUploading: boolean
  splittingFileId?: string | null
  onDelete: (fileId: string) => void
  onDownloadAll: () => void
  onDownloadFile: (fileId: string) => void
  onSplit?: (fileId: string) => void
  onUpload: (files: File[]) => void
}

export function BatchSection({
  batchFiles,
  canDelete = true,
  canUpload = true,
  isUploading,
  splittingFileId = null,
  onDelete,
  onDownloadAll,
  onDownloadFile,
  onSplit,
  onUpload,
}: BatchSectionProps) {
  const fileInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())

  function handleToggleSelect(fileId: string) {
    setSelectedFileIds((prev) => {
      const next = new Set(prev)

      if (next.has(fileId)) {
        next.delete(fileId)
      } else {
        next.add(fileId)
      }

      return next
    })
  }

  function handleToggleAll() {
    if (selectedFileIds.size === batchFiles.length) {
      setSelectedFileIds(new Set())
    } else {
      setSelectedFileIds(new Set(batchFiles.map((f) => f.id)))
    }
  }

  async function handleDownloadSelected() {
    for (const fileId of selectedFileIds) {
      onDownloadFile(fileId)
    }
  }

  function handleFilesSelected(event: React.ChangeEvent<HTMLInputElement>) {
    const fileList = event.target.files

    if (!fileList || fileList.length === 0) {
      return
    }

    onUpload(Array.from(fileList))

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <section className="grid gap-4">
      {batchFiles.length > 0 ? (
        <div className="flex items-center justify-between">
          <StatusBadge tone="info">{`${batchFiles.length} arquivo(s) enviado(s)`}</StatusBadge>

          <Button onClick={onDownloadAll} size="sm" variant="outline">
            <Download className="size-3.5" />
            Baixar todos em lote
          </Button>
        </div>
      ) : null}

      <div className="rounded-[1.75rem] border border-dashed border-border bg-muted/35 p-5">
        {canUpload ? (
          <>
            <label
              className="flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-card px-5 py-8 text-center transition hover:border-primary/35 hover:bg-primary/5"
              htmlFor={fileInputId}
            >
              <FileUp className="mb-2 size-8 text-muted-foreground" />
              <span className="text-base font-semibold text-foreground">
                {isUploading
                  ? 'Enviando...'
                  : 'Clique aqui para enviar arquivos em lote'}
              </span>
              <span className="mt-1 text-sm text-muted-foreground">
                Selecione um ou mais arquivos (max 25 MB cada)
              </span>
            </label>

            <input
              className="hidden"
              id={fileInputId}
              multiple
              onChange={handleFilesSelected}
              ref={fileInputRef}
              type="file"
            />
          </>
        ) : (
          <div className="rounded-[1.5rem] border border-dashed border-border bg-card px-5 py-8 text-center">
            <p className="text-base font-semibold text-foreground">
              Upload em lote indisponivel
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Seu perfil permite apenas visualizar os arquivos deste processo.
            </p>
          </div>
        )}

        {batchFiles.length > 0 ? (
          <div className="mt-4 grid gap-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Checkbox
                  checked={
                    selectedFileIds.size === batchFiles.length &&
                    batchFiles.length > 0
                  }
                  onCheckedChange={handleToggleAll}
                />
                <span className="text-sm text-muted-foreground">
                  Selecionar todos
                </span>
              </div>

              {selectedFileIds.size > 0 ? (
                <Button
                  onClick={() => void handleDownloadSelected()}
                  size="sm"
                  variant="outline"
                >
                  <Download className="size-3.5" />
                  {`Baixar selecionados (${selectedFileIds.size})`}
                </Button>
              ) : null}
            </div>

            {batchFiles.map((file) => (
              <BatchFileRow
                canDelete={canDelete}
                file={file}
                isSelected={selectedFileIds.has(file.id)}
                isSplitting={splittingFileId === file.id}
                key={file.id}
                onDelete={(fileId) => {
                  if (!canDelete) {
                    return
                  }

                  onDelete(fileId)
                }}
                onDownload={onDownloadFile}
                onSplit={onSplit}
                onToggleSelect={handleToggleSelect}
              />
            ))}
          </div>
        ) : null}
      </div>
    </section>
  )
}
