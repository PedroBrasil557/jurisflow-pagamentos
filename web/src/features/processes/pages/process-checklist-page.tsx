import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Download,
  FileUp,
  Loader2,
  Package,
  Pencil,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { ConfirmDialog } from '@/shared/components/confirm-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { downloadFile } from '@/shared/lib/download'
import { BatchSection } from '../components/process-batch-section'
import { ChecklistItemCard } from '../components/process-checklist-item-card'
import { ChecklistItemDialog } from '../components/process-checklist-item-dialog'
import { formatCpf } from '../process-form.utils'
import {
  useDeleteBatchFile,
  useDeleteChecklistFile,
  useMarkDocumentationReady,
  useSubmitChecklistItem,
  useUploadBatchFiles,
} from '../services/processes.mutations'
import {
  processBatchFilesOptions,
  processChecklistOptions,
  processDetailOptions,
} from '../services/processes.queries'
import {
  downloadAllBatchFilesRequest,
  downloadAllChecklistFilesRequest,
  getBatchFileDownloadRequest,
  getProcessChecklistFileDownloadRequest,
  getProcessStatusLabel,
} from '../services/processes.service'

type ProcessChecklistPageProps = {
  processId: string
}

type DeleteConfirmation = {
  fileName: string
  onConfirm: () => void
}

export function ProcessChecklistPage({ processId }: ProcessChecklistPageProps) {
  const detailQ = useQuery(processDetailOptions(processId))
  const checklistQ = useQuery(processChecklistOptions(processId))
  const batchQ = useQuery(processBatchFilesOptions(processId))
  const submitMutation = useSubmitChecklistItem(processId)
  const markReadyMutation = useMarkDocumentationReady(processId)
  const uploadBatchMutation = useUploadBatchFiles(processId)
  const deleteBatchMutation = useDeleteBatchFile(processId)
  const deleteChecklistFileMutation = useDeleteChecklistFile(processId)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null)

  const process = detailQ.data?.process
  const checklist = checklistQ.data
  const batchFiles = batchQ.data?.files ?? []

  const isLoading =
    detailQ.isLoading || checklistQ.isLoading || batchQ.isLoading
  const isDeleting =
    deleteBatchMutation.isPending || deleteChecklistFileMutation.isPending

  if (isLoading || !process || !checklist) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const selectedItem =
    checklist.items.find((item) => item.id === selectedItemId) ?? null

  const hasChecklistFiles = checklist.items.some(
    (item) => item.currentFiles.length > 0,
  )

  async function handleChecklistItemSubmit(input: {
    file?: File | null
    markOkWithoutFile: boolean
    observation: string
    processDocumentId: string
  }) {
    const result = await submitMutation.mutateAsync(input)

    toast.success(result.message)
    setSelectedItemId(null)

    if (
      result.checklist.summary.requiredPending === 0 &&
      process?.status === 'EM_DOCUMENTACAO'
    ) {
      try {
        await markReadyMutation.mutateAsync()
        toast.success('Documentacao marcada como pronta automaticamente.')
      } catch {
        // silently fail - user can retry manually if needed
      }
    }
  }

  async function handleDownloadFile(input: {
    fileId: string
    processDocumentId: string
  }) {
    const result = await getProcessChecklistFileDownloadRequest({
      processId,
      processDocumentId: input.processDocumentId,
      fileId: input.fileId,
    })

    await downloadFile(
      result.downloadUrl,
      result.file.downloadFileName ?? result.file.originalFileName,
    )
  }

  function handleDeleteChecklistFile(input: {
    fileId: string
    fileName: string
    processDocumentId: string
  }) {
    setDeleteConfirmation({
      fileName: input.fileName,
      onConfirm: () => {
        deleteChecklistFileMutation.mutate(
          {
            processDocumentId: input.processDocumentId,
            fileId: input.fileId,
          },
          {
            onSuccess: (result) => {
              toast.success(result.message)
              setDeleteConfirmation(null)
              setSelectedItemId(null)
            },
          },
        )
      },
    })
  }

  function handleBatchUpload(files: File[]) {
    uploadBatchMutation.mutate(files, {
      onSuccess: (result) => {
        toast.success(result.message)
      },
    })
  }

  function handleBatchDelete(fileId: string) {
    const file = batchFiles.find((f) => f.id === fileId)

    setDeleteConfirmation({
      fileName: file?.originalFileName ?? 'Arquivo',
      onConfirm: () => {
        deleteBatchMutation.mutate(fileId, {
          onSuccess: (result) => {
            toast.success(result.message)
            setDeleteConfirmation(null)
          },
        })
      },
    })
  }

  async function handleBatchFileDownload(fileId: string) {
    try {
      const result = await getBatchFileDownloadRequest({
        processId,
        fileId,
      })

      await downloadFile(
        result.downloadUrl,
        result.file.downloadFileName ?? result.file.originalFileName,
      )
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel baixar o arquivo.',
      )
    }
  }

  async function handleDownloadAllBatch() {
    try {
      const result = await downloadAllBatchFilesRequest(processId)

      for (const file of result.files) {
        await downloadFile(file.downloadUrl, file.originalFileName)
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel baixar os arquivos em lote.',
      )
    }
  }

  async function handleDownloadAllChecklist() {
    try {
      const result = await downloadAllChecklistFilesRequest(processId)

      if (result.files.length === 0) {
        toast.info('Nenhum documento individual para baixar.')
        return
      }

      for (const file of result.files) {
        await downloadFile(file.downloadUrl, file.originalFileName)
      }
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel baixar os documentos.',
      )
    }
  }

  return (
    <>
      <div className="grid gap-6">
        <PageHeader
          title="Checklist de documentos"
          description={`${process.fullName} • ${formatCpf(process.cpf)} • ${process.city} - ${process.state} • ${getProcessStatusLabel(process.status)}`}
        >
          <Link className="no-underline" to="/processos">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
          </Link>
          <Link
            className="no-underline"
            params={{ processId }}
            to="/processos/$processId/editar"
          >
            <Button variant="outline" size="sm">
              <Pencil className="size-4" />
              Editar processo
            </Button>
          </Link>
        </PageHeader>

        <Tabs defaultValue="documentos">
          <TabsList>
            <TabsTrigger value="documentos">
              <FileUp className="size-4" />
              {`Documentos (${checklist.summary.requiredCompleted}/${checklist.summary.requiredTotal})`}
            </TabsTrigger>
            <TabsTrigger value="lote">
              <Package className="size-4" />
              {`Em lote (${batchFiles.length})`}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="lote">
            <div className="grid gap-4 pt-4">
              <BatchSection
                batchFiles={batchFiles}
                isUploading={uploadBatchMutation.isPending}
                onDelete={handleBatchDelete}
                onDownloadAll={() => void handleDownloadAllBatch()}
                onDownloadFile={(fileId) =>
                  void handleBatchFileDownload(fileId)
                }
                onUpload={handleBatchUpload}
              />
            </div>
          </TabsContent>

          <TabsContent value="documentos">
            <div className="grid gap-4 pt-4">
              <div className="flex items-center justify-between">
                <div
                  className={`rounded-lg border px-4 py-3 ${
                    checklist.summary.requiredPending === 0
                      ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                      : 'border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  }`}
                >
                  <span className="text-sm font-medium">
                    {checklist.summary.requiredPending === 0
                      ? `Documentos obrigatorios completos (${checklist.summary.requiredCompleted}/${checklist.summary.requiredTotal} presentes)`
                      : `Faltam documentos obrigatorios (${checklist.summary.requiredCompleted}/${checklist.summary.requiredTotal} presentes)`}
                  </span>
                </div>

                {hasChecklistFiles ? (
                  <Button
                    onClick={() => void handleDownloadAllChecklist()}
                    size="sm"
                    variant="outline"
                  >
                    <Download className="size-3.5" />
                    Baixar todos documentos
                  </Button>
                ) : null}
              </div>

              <section className="grid gap-4 xl:grid-cols-2">
                {checklist.items.map((item) => (
                  <ChecklistItemCard
                    item={item}
                    key={item.id}
                    onOpen={(nextItem) => {
                      setSelectedItemId(nextItem.id)
                    }}
                  />
                ))}
              </section>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {selectedItem ? (
        <ChecklistItemDialog
          isSubmitting={submitMutation.isPending}
          item={selectedItem}
          onClose={() => setSelectedItemId(null)}
          onDeleteFile={handleDeleteChecklistFile}
          onDownloadFile={handleDownloadFile}
          onSubmit={handleChecklistItemSubmit}
        />
      ) : null}

      <ConfirmDialog
        confirmLabel="Confirmar remocao"
        description="Esta acao nao pode ser desfeita. O arquivo sera removido permanentemente."
        detail={deleteConfirmation?.fileName}
        detailLabel="Arquivo"
        icon={Trash2}
        isLoading={isDeleting}
        loadingLabel="Removendo..."
        onClose={() => setDeleteConfirmation(null)}
        onConfirm={deleteConfirmation?.onConfirm ?? (() => {})}
        open={deleteConfirmation !== null}
        title="Remover arquivo"
        variant="destructive"
      />
    </>
  )
}
