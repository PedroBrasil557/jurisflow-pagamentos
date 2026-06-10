import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  ArrowLeft,
  Download,
  FileUp,
  Loader2,
  Package,
  Pencil,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '#/components/ui/tabs'
import { useSession } from '@/features/auth/hooks/use-session'
import { ConfirmDialog } from '@/shared/components/confirm-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { downloadFile } from '@/shared/lib/download'
import { CaixaOwnerCard } from '../components/caixa-owner-card'
import { CaixaQuitacaoCard } from '../components/caixa-quitacao-card'
import { BatchSection } from '../components/process-batch-section'
import { ChecklistItemCard } from '../components/process-checklist-item-card'
import { ChecklistItemDialog } from '../components/process-checklist-item-dialog'
import {
  buildProcessRelationship,
  canAccessBatch,
  canAccessChecklist,
  canDeleteBatchFiles,
  canDeleteChecklistFiles,
  canEditProcess,
  canManageChecklist,
  canUploadBatchFiles,
} from '../lib/process-access'
import { formatCpf } from '../process-form.utils'
import {
  useDeleteBatchFile,
  useDeleteChecklistFile,
  useMarkDocumentationReady,
  useSplitBatchFile,
  useSubmitChecklistItem,
  useUploadBatchFiles,
} from '../services/processes.mutations'
import {
  processBatchFilesOptions,
  processChecklistOptions,
  processDetailOptions,
  processKeys,
} from '../services/processes.queries'
import {
  downloadAllBatchZipRequest,
  downloadAllChecklistZipRequest,
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
  const { permissions, user } = useSession()
  const detailQ = useQuery(processDetailOptions(processId))
  const detailProcess = detailQ.data?.process
  const detailRelationship = detailProcess
    ? buildProcessRelationship({
        process: detailProcess,
        userId: user.id,
        permissions,
      })
    : null
  const canLoadChecklist =
    detailRelationship !== null &&
    canAccessChecklist(permissions, detailRelationship)
  const canLoadBatch =
    detailRelationship !== null &&
    canAccessBatch(permissions, detailRelationship)
  const checklistQ = useQuery({
    ...processChecklistOptions(processId),
    enabled: canLoadChecklist,
  })
  const batchQ = useQuery({
    ...processBatchFilesOptions(processId),
    enabled: canLoadBatch,
  })
  const submitMutation = useSubmitChecklistItem(processId)
  const markReadyMutation = useMarkDocumentationReady(processId)
  const uploadBatchMutation = useUploadBatchFiles(processId)
  const deleteBatchMutation = useDeleteBatchFile(processId)
  const deleteChecklistFileMutation = useDeleteChecklistFile(processId)
  const splitBatchMutation = useSplitBatchFile(processId)
  const queryClient = useQueryClient()

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)
  const [deleteConfirmation, setDeleteConfirmation] =
    useState<DeleteConfirmation | null>(null)
  const [splitConfirmation, setSplitConfirmation] =
    useState<DeleteConfirmation | null>(null)
  // Arquivo cujo desmembramento (assincrono) estamos acompanhando via polling.
  const [activeSplitId, setActiveSplitId] = useState<string | null>(null)
  // Garante que so reagimos a done/error apos termos visto o 'processing' atual,
  // ignorando um status antigo de um desmembramento anterior do mesmo arquivo.
  const splitSawProcessingRef = useRef(false)

  const process = detailQ.data?.process
  const checklist = checklistQ.data
  const batchFiles = batchQ.data?.files ?? []
  const relationship = detailRelationship
  const checklistData = checklist ?? null

  // Acompanha a conclusao do desmembramento assincrono (processing -> done/error):
  // mostra UM unico toast e atualiza o checklist quando termina.
  useEffect(() => {
    if (!activeSplitId) {
      return
    }

    const file = batchFiles.find((item) => item.id === activeSplitId)
    if (!file) {
      // Arquivo removido durante o split: nao ha o que acompanhar, libera o estado
      // para nao travar o dialogo nem bloquear futuros desmembramentos.
      splitSawProcessingRef.current = false
      setActiveSplitId(null)
      setSplitConfirmation(null)
      return
    }

    if (file.splitStatus === 'processing') {
      splitSawProcessingRef.current = true
      return
    }

    if (!splitSawProcessingRef.current) {
      return
    }

    if (file.splitStatus === 'done') {
      const message = file.splitMessage ?? 'Documentos anexados ao checklist.'
      // 'done' sem anexos nao e sucesso pleno: a IA nao separou nenhum documento
      // (cobre tanto o split manual quanto as mensagens do fluxo digitalizacao).
      if (message.includes('Nenhum documento') || message.startsWith('Nada')) {
        toast.warning(message)
      } else {
        toast.success(message)
      }
      queryClient.invalidateQueries({
        queryKey: processKeys.checklist(processId),
      })
      queryClient.invalidateQueries({ queryKey: processKeys.detail(processId) })
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    } else if (file.splitStatus === 'error') {
      toast.error(file.splitMessage ?? 'Nao foi possivel desmembrar o arquivo.')
    }

    splitSawProcessingRef.current = false
    setActiveSplitId(null)
    setSplitConfirmation(null)
  }, [activeSplitId, batchFiles, queryClient, processId])

  // Detecta um desmembramento ja em andamento (ex.: iniciado pelo fluxo digitalizacao antes
  // de chegar nesta tela) para acompanhar processing -> done/erro tambem nesses casos.
  useEffect(() => {
    if (activeSplitId) {
      return
    }

    const processingFile = batchFiles.find(
      (item) => item.splitStatus === 'processing',
    )
    if (processingFile) {
      setActiveSplitId(processingFile.id)
    }
  }, [activeSplitId, batchFiles])

  const isLoading =
    detailQ.isLoading ||
    (canLoadChecklist && checklistQ.isLoading) ||
    (canLoadBatch && batchQ.isLoading)
  const isDeleting =
    deleteBatchMutation.isPending || deleteChecklistFileMutation.isPending

  if (isLoading || !process || (canLoadChecklist && !checklist)) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!canLoadChecklist && !canLoadBatch) {
    return (
      <div className="rounded-3xl border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
        <p className="text-sm font-medium text-muted-foreground">
          Seu perfil nao possui acesso as abas deste processo.
        </p>
      </div>
    )
  }

  const selectedItem =
    checklist?.items.find((item) => item.id === selectedItemId) ?? null

  const hasChecklistFiles =
    checklist?.items.some((item) => item.currentFiles.length > 0) ?? false
  const canEditCurrentProcess =
    process && relationship ? canEditProcess(permissions, relationship) : false
  const canViewChecklistTab =
    process && relationship
      ? canAccessChecklist(permissions, relationship)
      : false
  const canViewBatchTab =
    process && relationship ? canAccessBatch(permissions, relationship) : false
  const canSubmitChecklist =
    process && relationship
      ? canManageChecklist(permissions, relationship)
      : false
  const canDeleteChecklistCurrentFiles =
    process && relationship
      ? canDeleteChecklistFiles(permissions, relationship)
      : false
  const canUploadBatchCurrentFiles =
    process && relationship
      ? canUploadBatchFiles(permissions, relationship)
      : false
  const canDeleteBatchCurrentFiles =
    process && relationship
      ? canDeleteBatchFiles(permissions, relationship)
      : false
  const defaultTab = canViewChecklistTab ? 'documentos' : 'lote'

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

  function handleBatchSplit(fileId: string) {
    const file = batchFiles.find((f) => f.id === fileId)

    setSplitConfirmation({
      fileName: file?.originalFileName ?? 'Arquivo',
      // Mantem o dialogo aberto (modal) durante o split: mostra "Desmembrando..."
      // e bloqueia acionar outro arquivo enquanto a operacao corre. O resultado
      // chega pelo polling do lote (ver effect acima), nao pela resposta (202).
      onConfirm: () => {
        splitSawProcessingRef.current = false
        splitBatchMutation.mutate(fileId, {
          onSuccess: () => {
            setActiveSplitId(fileId)
          },
          // Erro ao INICIAR (ex.: 404/415): o handler global ja mostra o toast;
          // aqui so fechamos o dialogo (evita toast duplicado).
          onError: () => {
            setSplitConfirmation(null)
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
      const { downloadUrl, fileName, fileCount } =
        await downloadAllBatchZipRequest(processId)
      if (fileCount === 0) {
        toast.info('Nenhum arquivo de lote para baixar.')
        return
      }
      await downloadFile(downloadUrl, fileName)
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
      const { downloadUrl, fileName, fileCount } =
        await downloadAllChecklistZipRequest(processId)
      if (fileCount === 0) {
        toast.info('Nenhum documento para baixar.')
        return
      }
      await downloadFile(downloadUrl, fileName)
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
          <Link className="no-underline" preload={false} to="/processos">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="size-4" />
              Voltar
            </Button>
          </Link>
          {canEditCurrentProcess ? (
            <Link
              className="no-underline"
              params={{ processId }}
              preload={false}
              to="/processos/$processId/editar"
            >
              <Button variant="outline" size="sm">
                <Pencil className="size-4" />
                Editar processo
              </Button>
            </Link>
          ) : null}
        </PageHeader>

        {process.caixaQuitacaoStatus !== 'idle' ? (
          <CaixaQuitacaoCard
            message={process.caixaQuitacaoMessage}
            processId={processId}
            status={process.caixaQuitacaoStatus}
          />
        ) : null}

        {process.caixaAnalysisStatus !== 'idle' ? (
          <CaixaOwnerCard
            ownerType={process.ownerType}
            ownerTypeSource={process.ownerTypeSource}
            processId={processId}
            status={process.caixaAnalysisStatus}
          />
        ) : null}

        <Tabs defaultValue={defaultTab}>
          <TabsList>
            {canViewChecklistTab ? (
              <TabsTrigger value="documentos">
                <FileUp className="size-4" />
                {`Documentos (${checklistData?.summary.requiredCompleted ?? 0}/${checklistData?.summary.requiredTotal ?? 0})`}
              </TabsTrigger>
            ) : null}
            {canViewBatchTab ? (
              <TabsTrigger value="lote">
                <Package className="size-4" />
                {`Em lote (${batchFiles.length})`}
              </TabsTrigger>
            ) : null}
          </TabsList>

          {canViewBatchTab ? (
            <TabsContent value="lote">
              <div className="grid gap-4 pt-4">
                <BatchSection
                  batchFiles={batchFiles}
                  canDelete={canDeleteBatchCurrentFiles}
                  canUpload={canUploadBatchCurrentFiles}
                  isUploading={uploadBatchMutation.isPending}
                  splittingFileId={
                    activeSplitId ??
                    (splitBatchMutation.isPending
                      ? (splitBatchMutation.variables ?? null)
                      : null)
                  }
                  onDelete={handleBatchDelete}
                  onDownloadAll={() => void handleDownloadAllBatch()}
                  onDownloadFile={(fileId) =>
                    void handleBatchFileDownload(fileId)
                  }
                  onSplit={canSubmitChecklist ? handleBatchSplit : undefined}
                  onUpload={handleBatchUpload}
                />
              </div>
            </TabsContent>
          ) : null}

          {canViewChecklistTab && checklistData ? (
            <TabsContent value="documentos">
              <div className="grid gap-4 pt-4">
                <div className="flex items-center justify-between">
                  <div
                    className={`rounded-lg border px-4 py-3 ${
                      checklistData.summary.requiredPending === 0
                        ? 'border-emerald-500/20 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                        : 'border-amber-500/20 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                    }`}
                  >
                    <span className="text-sm font-medium">
                      {checklistData.summary.requiredPending === 0
                        ? `Documentos obrigatorios completos (${checklistData.summary.requiredCompleted}/${checklistData.summary.requiredTotal} presentes)`
                        : `Faltam documentos obrigatorios (${checklistData.summary.requiredCompleted}/${checklistData.summary.requiredTotal} presentes)`}
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

                {(() => {
                  const requiredItems = checklistData.items.filter(
                    (item) => item.documentType.isRequired,
                  )
                  const optionalItems = checklistData.items.filter(
                    (item) => !item.documentType.isRequired,
                  )

                  return (
                    <div className="grid gap-6">
                      <div className="grid gap-3">
                        <ChecklistGroupHeader
                          count={requiredItems.length}
                          title="Documentos obrigatorios"
                        />
                        <section className="grid gap-4 xl:grid-cols-2">
                          {requiredItems.map((item) => (
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

                      {optionalItems.length > 0 ? (
                        <div className="grid gap-3">
                          <ChecklistGroupHeader
                            count={optionalItems.length}
                            title="Documentos opcionais"
                          />
                          <section className="grid gap-4 xl:grid-cols-2">
                            {optionalItems.map((item) => (
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
                      ) : null}
                    </div>
                  )
                })()}
              </div>
            </TabsContent>
          ) : null}
        </Tabs>
      </div>

      {selectedItem ? (
        <ChecklistItemDialog
          canDeleteFiles={canDeleteChecklistCurrentFiles}
          canSubmit={canSubmitChecklist}
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

      <ConfirmDialog
        confirmLabel="Desmembrar"
        description="O PDF sera processado por inteligencia artificial (Anthropic) para separar os documentos e anexa-los aos itens do checklist. Itens de arquivo unico que ja tiverem anexo serao substituidos."
        detail={splitConfirmation?.fileName}
        detailLabel="Arquivo"
        icon={Sparkles}
        isLoading={splitBatchMutation.isPending || activeSplitId !== null}
        loadingLabel="Desmembrando..."
        onClose={() => setSplitConfirmation(null)}
        onConfirm={splitConfirmation?.onConfirm ?? (() => {})}
        open={splitConfirmation !== null}
        title="Desmembrar documento"
      />
    </>
  )
}

function ChecklistGroupHeader({
  count,
  title,
}: {
  count: number
  title: string
}) {
  return (
    <div className="flex items-center justify-between border-b border-border pb-2">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <span className="text-xs text-muted-foreground">
        {count} {count === 1 ? 'item' : 'itens'}
      </span>
    </div>
  )
}
