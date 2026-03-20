import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, FileUp, Loader2, Pencil } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { PageHeader } from '@/shared/components/page-header'
import { StatusBadge } from '@/shared/components/status-badge'
import { FormTextArea, useZodForm } from '@/shared/components/ui/form'
import { formatCpf } from '../process-form.utils'
import {
  type ProcessChecklistItemFormValues,
  processChecklistItemFormSchema,
} from '../schemas/process-checklist-item-form.schema'
import {
  useMarkDocumentationReady,
  useSubmitChecklistItem,
} from '../services/processes.mutations'
import {
  processChecklistOptions,
  processDetailOptions,
} from '../services/processes.queries'
import {
  getProcessChecklistFileDownloadRequest,
  getProcessStatusLabel,
  type ProcessChecklistItem,
} from '../services/processes.service'

type ProcessChecklistPageProps = {
  processId: string
}

type ChecklistItemDialogProps = {
  isSubmitting: boolean
  item: ProcessChecklistItem | null
  onClose: () => void
  onDownloadFile: (input: {
    fileId: string
    processDocumentId: string
  }) => Promise<void>
  onSubmit: (input: {
    file?: File | null
    markOkWithoutFile: boolean
    observation: string
    processDocumentId: string
  }) => Promise<void>
}

function getChecklistStatusTone(status: string) {
  switch (status) {
    case 'ANEXADO':
      return 'success' as const
    case 'OK_SEM_ARQUIVO':
      return 'info' as const
    case 'APROVADO':
      return 'success' as const
    case 'REJEITADO':
      return 'error' as const
    default:
      return 'ghost' as const
  }
}

function getChecklistStatusLabel(status: string) {
  switch (status) {
    case 'OK_SEM_ARQUIVO':
      return 'Ok sem arquivo'
    default:
      return status
        .replaceAll('_', ' ')
        .toLowerCase()
        .replace(/^\w/, (c) => c.toUpperCase())
  }
}

function getChecklistItemSecondaryLabel(item: ProcessChecklistItem) {
  if (item.currentFiles.length > 0) {
    return item.currentFiles.length === 1
      ? '1 arquivo atual'
      : `${item.currentFiles.length} arquivos atuais`
  }

  if (item.status === 'OK_SEM_ARQUIVO') {
    return 'Ok sem arquivo'
  }

  return item.documentType.isRequired ? 'Pendente' : 'Documento opcional'
}

function formatBytes(sizeInBytes: number) {
  if (sizeInBytes < 1024) {
    return `${sizeInBytes} B`
  }

  if (sizeInBytes < 1024 * 1024) {
    return `${(sizeInBytes / 1024).toFixed(1)} KB`
  }

  return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`
}

function ChecklistStatusBadge({ status }: { status: string }) {
  return (
    <StatusBadge tone={getChecklistStatusTone(status)}>
      {getChecklistStatusLabel(status)}
    </StatusBadge>
  )
}

function ChecklistItemCard({
  item,
  onOpen,
}: {
  item: ProcessChecklistItem
  onOpen: (item: ProcessChecklistItem) => void
}) {
  const sortOrderLabel = String(item.documentType.sortOrder).padStart(2, '0')

  return (
    <button
      className="cursor-pointer rounded-[1.75rem] border border-border bg-card p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-lg hover:shadow-primary/6"
      onClick={() => onOpen(item)}
      type="button"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="grid gap-2">
          <p className="text-lg font-semibold text-foreground">
            {`${sortOrderLabel}. ${item.documentType.label}`}
          </p>
          <p className="text-sm text-muted-foreground">
            {getChecklistItemSecondaryLabel(item)}
          </p>
        </div>

        <ChecklistStatusBadge status={item.status} />
      </div>

      {item.observation ? (
        <div className="mt-4 rounded-2xl border border-border bg-muted/50 px-4 py-3">
          <p className="text-xs font-semibold text-muted-foreground">
            Observacao
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            {item.observation}
          </p>
        </div>
      ) : null}
    </button>
  )
}

function ChecklistItemDialog({
  isSubmitting,
  item,
  onClose,
  onDownloadFile,
  onSubmit,
}: ChecklistItemDialogProps) {
  const fileInputId = useId()
  const observationInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const {
    control,
    formState: { errors },
    handleSubmit,
    reset,
    setValue,
    watch,
  } = useZodForm<ProcessChecklistItemFormValues>({
    defaultValues: {
      file: null,
      markOkWithoutFile: false,
      observation: '',
    },
    schema: processChecklistItemFormSchema,
  })
  const selectedFile = watch('file')
  const observation = watch('observation')
  const markOkWithoutFile = watch('markOkWithoutFile')

  useEffect(() => {
    if (!item) {
      return
    }

    reset({
      file: null,
      markOkWithoutFile: item.status === 'OK_SEM_ARQUIVO',
      observation: item.observation,
    })
    setErrorMessage('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }, [item, reset])

  if (!item) {
    return null
  }

  const currentItem = item
  const sortOrderLabel = String(currentItem.documentType.sortOrder).padStart(
    2,
    '0',
  )

  async function handleDownload(fileId: string) {
    try {
      setErrorMessage('')

      await onDownloadFile({
        processDocumentId: currentItem.id,
        fileId,
      })
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel baixar este arquivo.',
      )
    }
  }

  async function handleFormSubmit(values: ProcessChecklistItemFormValues) {
    try {
      setErrorMessage('')

      await onSubmit({
        processDocumentId: currentItem.id,
        file: values.file,
        markOkWithoutFile: values.markOkWithoutFile,
        observation: values.observation,
      })
    } catch (error) {
      setErrorMessage(
        error instanceof Error
          ? error.message
          : 'Nao foi possivel salvar este item.',
      )
    }
  }

  return (
    <AppDialog
      description="Gerencie o arquivo e a observacao deste item."
      icon={FileUp}
      maxWidth="3xl"
      onClose={onClose}
      open={true}
      title={`${sortOrderLabel}. ${item.documentType.label}`}
      variant="info"
    >
      <div className="grid gap-4 rounded-[1.75rem] border border-dashed border-border bg-muted/35 p-5">
        <div className="grid gap-2">
          <p className="text-sm font-semibold text-muted-foreground">
            Arquivo atual
          </p>

          {item.currentFiles.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum arquivo encontrado
            </p>
          ) : (
            <div className="grid gap-3">
              {item.currentFiles.map((file) => (
                <div
                  className="flex flex-col gap-3 rounded-2xl border border-border bg-card px-4 py-4 sm:flex-row sm:items-center sm:justify-between"
                  key={file.id}
                >
                  <div className="grid gap-1">
                    <p className="font-semibold text-foreground">
                      {file.originalFileName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {`${formatBytes(file.sizeInBytes)} • REVISAO ${file.revision}`}
                    </p>
                  </div>

                  <Button
                    onClick={() => void handleDownload(file.id)}
                    size="sm"
                    type="button"
                    variant="outline"
                  >
                    Baixar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="grid gap-3">
          <label
            className="flex cursor-pointer flex-col items-center justify-center rounded-[1.5rem] border border-dashed border-border bg-card px-5 py-10 text-center transition hover:border-primary/35 hover:bg-primary/5"
            htmlFor={fileInputId}
          >
            <span className="text-base font-semibold text-foreground">
              {selectedFile
                ? selectedFile.name
                : item.currentFiles.length > 0 &&
                    !item.documentType.allowsMultipleFiles
                  ? 'Selecione um novo arquivo para substituir'
                  : 'Clique aqui para selecionar e enviar o documento'}
            </span>
            <span className="mt-2 text-sm text-muted-foreground">
              {selectedFile
                ? formatBytes(selectedFile.size)
                : 'Arquivo opcional nesta etapa de teste'}
            </span>
          </label>

          <Controller
            control={control}
            name="file"
            render={({ field }) => (
              <input
                className="hidden"
                id={fileInputId}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null

                  field.onChange(nextFile)

                  if (nextFile) {
                    setValue('markOkWithoutFile', false, {
                      shouldDirty: true,
                      shouldTouch: true,
                      shouldValidate: true,
                    })
                  }
                }}
                ref={(element) => {
                  fileInputRef.current = element
                  field.ref(element)
                }}
                type="file"
              />
            )}
          />

          <Button
            onClick={() => {
              const nextValue = !markOkWithoutFile

              setValue('markOkWithoutFile', nextValue, {
                shouldDirty: true,
                shouldTouch: true,
                shouldValidate: true,
              })

              if (nextValue) {
                setValue('file', null, {
                  shouldDirty: true,
                  shouldTouch: true,
                  shouldValidate: true,
                })
                if (fileInputRef.current) {
                  fileInputRef.current.value = ''
                }
              }
            }}
            type="button"
            variant={markOkWithoutFile ? 'default' : 'outline'}
          >
            Marcar ok sem arquivo
          </Button>

          {errors.file?.message || errors.markOkWithoutFile?.message ? (
            <p className="text-sm text-destructive">
              {errors.file?.message ?? errors.markOkWithoutFile?.message}
            </p>
          ) : null}
        </div>
      </div>

      <div className="grid gap-3">
        <Controller
          control={control}
          name="observation"
          render={({ field }) => (
            <FormTextArea
              error={errors.observation?.message}
              id={observationInputId}
              label="Observacoes (max 300 caracteres)"
              maxLength={300}
              onBlur={field.onBlur}
              onChange={(event) => {
                field.onChange(event.target.value)
              }}
              placeholder="Adicione uma observacao sobre este documento..."
              ref={field.ref}
              textareaClassName="min-h-36 uppercase"
              value={field.value}
            />
          )}
        />
        <p className="text-right text-xs text-muted-foreground">
          {`${observation.length}/300`}
        </p>
      </div>

      {errorMessage ? (
        <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span>{errorMessage}</span>
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <Button onClick={onClose} type="button" variant="ghost">
          Fechar
        </Button>
        <Button
          disabled={isSubmitting}
          onClick={() => void handleSubmit(handleFormSubmit)()}
          type="button"
        >
          {isSubmitting ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
    </AppDialog>
  )
}

export function ProcessChecklistPage({ processId }: ProcessChecklistPageProps) {
  const detailQ = useQuery(processDetailOptions(processId))
  const checklistQ = useQuery(processChecklistOptions(processId))
  const submitMutation = useSubmitChecklistItem(processId)
  const markReadyMutation = useMarkDocumentationReady(processId)

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null)

  const process = detailQ.data?.process
  const checklist = checklistQ.data

  const isLoading = detailQ.isLoading || checklistQ.isLoading

  if (isLoading || !process || !checklist) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  const selectedItem =
    checklist.items.find((item) => item.id === selectedItemId) ?? null

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

    window.open(result.downloadUrl, '_blank', 'noopener,noreferrer')
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

      {selectedItem ? (
        <ChecklistItemDialog
          isSubmitting={submitMutation.isPending}
          item={selectedItem}
          onClose={() => setSelectedItemId(null)}
          onDownloadFile={handleDownloadFile}
          onSubmit={handleChecklistItemSubmit}
        />
      ) : null}
    </>
  )
}
