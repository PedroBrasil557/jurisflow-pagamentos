import { useQuery } from '@tanstack/react-query'
import {
  Download,
  Eye,
  FileUp,
  Loader2,
  ScanSearch,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useId, useMemo, useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Checkbox } from '#/components/ui/checkbox'
import { DocumentPreviewDialog } from '@/shared/components/document-viewer/document-preview-dialog'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { StatusBadge } from '@/shared/components/status-badge'
import { formatBytes } from '@/shared/lib/format'
import { documentExtractionListOptions } from '../services/document-extraction.queries'
import { processBatchFilePreviewUrlOptions } from '../services/processes.queries'
import type { ProcessBatchFile } from '../services/processes.service'
import { DocumentClassificationDialog } from './document-classification-dialog'

// Busca a URL pre-assinada do arquivo em lote e renderiza o viewer. Os bytes vem
// DIRETO do storage (S3/MinIO) — pela API o gateway corta respostas acima de 10MB.
function BatchFilePreviewDialog({
  file,
  onClose,
  processId,
}: {
  file: ProcessBatchFile
  onClose: () => void
  processId: string
}) {
  const previewUrlQuery = useQuery(
    processBatchFilePreviewUrlOptions({ processId, fileId: file.id }),
  )

  return (
    <DocumentPreviewDialog
      isError={previewUrlQuery.isError}
      isPending={previewUrlQuery.isPending}
      mimeType={file.mimeType}
      onClose={onClose}
      onRetry={() => void previewUrlQuery.refetch()}
      open
      title={file.originalFileName}
      url={previewUrlQuery.data}
    />
  )
}

function BatchFileRow({
  canDelete,
  file,
  isSelected,
  isSplitting = false,
  processId,
  classificationAnalysisId,
  onDelete,
  onDownload,
  onSplit,
  onToggleSelect,
}: {
  canDelete: boolean
  file: ProcessBatchFile
  isSelected: boolean
  isSplitting?: boolean
  processId: string
  classificationAnalysisId: string | null
  onDelete: (fileId: string) => void
  onDownload: (fileId: string) => void
  onSplit?: (fileId: string) => void
  onToggleSelect: (fileId: string) => void
}) {
  const isPdf = file.mimeType === 'application/pdf'
  const isImage = file.mimeType.startsWith('image/')
  const canPreview = isPdf || isImage
  const [showClassification, setShowClassification] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

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
          {file.splitStatus === 'done' && file.splitMessage ? (
            <p className="text-xs text-muted-foreground">{file.splitMessage}</p>
          ) : null}
        </div>
      </div>

      <div className="flex gap-2">
        {classificationAnalysisId ? (
          <Button
            onClick={() => setShowClassification(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <ScanSearch className="size-3.5" />
            Ver classificação
          </Button>
        ) : null}
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
        {canPreview ? (
          <Button
            onClick={() => setShowPreview(true)}
            size="sm"
            type="button"
            variant="outline"
          >
            <Eye className="size-3.5" />
            Ver
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

      {showClassification && classificationAnalysisId ? (
        <DocumentClassificationDialog
          analysisId={classificationAnalysisId}
          fileName={file.originalFileName}
          onClose={() => setShowClassification(false)}
          processId={processId}
        />
      ) : null}

      {showPreview ? (
        <BatchFilePreviewDialog
          file={file}
          onClose={() => setShowPreview(false)}
          processId={processId}
        />
      ) : null}
    </div>
  )
}

type BatchSectionProps = {
  batchFiles: ProcessBatchFile[]
  processId: string
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
  processId,
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

  // Liga cada arquivo de lote a sua ultima auditoria de classificacao (pelo
  // context.fileId). A lista vem ordenada por created_at desc, entao o primeiro
  // match por fileId e o mais recente.
  const classificationsQ = useQuery(documentExtractionListOptions(processId))
  const analysisIdByFileId = useMemo(() => {
    const map = new Map<string, string>()
    for (const item of classificationsQ.data?.items ?? []) {
      const fileId = item.context?.fileId
      if (fileId && !map.has(fileId)) {
        map.set(fileId, item.id)
      }
    }
    return map
  }, [classificationsQ.data])

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

            <div className="mt-3 flex justify-center">
              <ScanButton
                disabled={isUploading}
                onComplete={(file) => onUpload([file])}
              />
            </div>
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
                classificationAnalysisId={
                  analysisIdByFileId.get(file.id) ?? null
                }
                file={file}
                isSelected={selectedFileIds.has(file.id)}
                isSplitting={splittingFileId === file.id}
                key={file.id}
                processId={processId}
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
