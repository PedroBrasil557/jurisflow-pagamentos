import { Download, Eye, FileUp, Trash2 } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Controller } from 'react-hook-form'
import { Button } from '#/components/ui/button'
import { AppDialog } from '@/shared/components/app-dialog'
import { ScanButton } from '@/shared/components/document-scanner/scan-button'
import { DocumentViewer } from '@/shared/components/document-viewer/document-viewer'
import { FormTextArea, useZodForm } from '@/shared/components/ui/form'
import { formatBytes } from '@/shared/lib/format'
import {
  type ProcessChecklistItemFormValues,
  processChecklistItemFormSchema,
} from '../schemas/process-checklist-item-form.schema'
import {
  type ProcessChecklistItem,
  processChecklistFileContentUrl,
} from '../services/processes.service'

type PreviewFile = {
  id: string
  mimeType: string
  source: 'process' | 'housing_complex'
  name: string
}

type ChecklistItemDialogProps = {
  canDeleteFiles?: boolean
  canSubmit?: boolean
  isSubmitting: boolean
  item: ProcessChecklistItem | null
  onClose: () => void
  onDeleteFile: (input: {
    fileId: string
    fileName: string
    processDocumentId: string
  }) => void
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
  processId: string
}

export function ChecklistItemDialog({
  canDeleteFiles = true,
  canSubmit = true,
  isSubmitting,
  item,
  onClose,
  onDeleteFile,
  onDownloadFile,
  onSubmit,
  processId,
}: ChecklistItemDialogProps) {
  const fileInputId = useId()
  const observationInputId = useId()
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [previewFile, setPreviewFile] = useState<PreviewFile | null>(null)
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
  const numberPrefix = currentItem.documentType.number
    ? `${currentItem.documentType.number}. `
    : ''

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
    <>
      <AppDialog
        description="Gerencie o arquivo e a observacao deste item."
        icon={FileUp}
        maxWidth="3xl"
        onClose={onClose}
        open={true}
        title={`${numberPrefix}${item.documentType.label}`}
        variant="info"
      >
        <div className="grid gap-4 rounded-[1.75rem] border border-dashed border-border bg-muted/35 p-5">
          {item.readOnly ? (
            <div className="rounded-2xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-sm text-blue-700 dark:text-blue-400">
              {item.housingComplexLinked
                ? 'Este documento e anexado no cadastro do conjunto (somente admin). Aqui ele e apenas exibido.'
                : 'Vincule um conjunto ao processo para que este documento seja anexado no cadastro do conjunto.'}
            </div>
          ) : null}

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
                        {`${formatBytes(file.sizeInBytes)}${
                          file.source === 'housing_complex'
                            ? ' • No conjunto'
                            : ` • REVISAO ${file.revision}`
                        }`}
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Button
                        onClick={() =>
                          setPreviewFile({
                            id: file.id,
                            mimeType: file.mimeType,
                            source: file.source,
                            name: file.originalFileName,
                          })
                        }
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        <Eye className="size-3.5" />
                        Ver
                      </Button>
                      {file.source === 'housing_complex' && file.downloadUrl ? (
                        <Button
                          asChild
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <a
                            href={file.downloadUrl}
                            rel="noreferrer"
                            target="_blank"
                          >
                            <Download className="size-3.5" />
                            Baixar
                          </a>
                        </Button>
                      ) : (
                        <Button
                          onClick={() => void handleDownload(file.id)}
                          size="sm"
                          type="button"
                          variant="outline"
                        >
                          <Download className="size-3.5" />
                          Baixar
                        </Button>
                      )}
                      {file.source === 'housing_complex' ? null : (
                        <Button
                          onClick={() =>
                            canDeleteFiles
                              ? onDeleteFile({
                                  fileId: file.id,
                                  fileName: file.originalFileName,
                                  processDocumentId: currentItem.id,
                                })
                              : undefined
                          }
                          size="sm"
                          type="button"
                          variant="outline"
                          className="text-destructive hover:text-destructive"
                          disabled={!canDeleteFiles}
                        >
                          <Trash2 className="size-3.5" />
                          Remover
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {canSubmit && !item.readOnly ? (
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
                    : 'Tamanho maximo: 25 MB'}
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

              <ScanButton
                onComplete={(file) => {
                  setValue('file', file, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                  setValue('markOkWithoutFile', false, {
                    shouldDirty: true,
                    shouldTouch: true,
                    shouldValidate: true,
                  })
                }}
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
          ) : item.readOnly ? null : (
            <div className="rounded-2xl border border-border bg-card px-4 py-4 text-sm text-muted-foreground">
              Seu perfil permite visualizar este item, mas nao editar a
              documentacao.
            </div>
          )}
        </div>

        {item.readOnly ? null : (
          <div className="grid gap-3">
            <Controller
              control={control}
              name="observation"
              render={({ field }) => (
                <FormTextArea
                  error={errors.observation?.message}
                  id={observationInputId}
                  label="Observações (max 300 caracteres)"
                  maxLength={300}
                  onBlur={field.onBlur}
                  onChange={(event) => {
                    field.onChange(event.target.value)
                  }}
                  placeholder="Adicione uma observação sobre este documento..."
                  ref={field.ref}
                  textareaClassName="min-h-36"
                  value={field.value}
                />
              )}
            />
            <p className="text-right text-xs text-muted-foreground">
              {`${observation.length}/300`}
            </p>
          </div>
        )}

        {errorMessage ? (
          <div className="rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            <span>{errorMessage}</span>
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button onClick={onClose} type="button" variant="ghost">
            Fechar
          </Button>
          {canSubmit && !item.readOnly ? (
            <Button
              disabled={isSubmitting}
              onClick={() => void handleSubmit(handleFormSubmit)()}
              type="button"
            >
              {isSubmitting ? 'Salvando...' : 'Salvar'}
            </Button>
          ) : null}
        </div>
      </AppDialog>

      {previewFile ? (
        <AppDialog
          icon={Eye}
          maxWidth="screen"
          onClose={() => setPreviewFile(null)}
          open
          title={previewFile.name}
          variant="info"
        >
          <div className="h-[80vh] overflow-hidden rounded-md border border-border">
            <DocumentViewer
              fileName={previewFile.name}
              mimeType={previewFile.mimeType}
              url={processChecklistFileContentUrl({
                processId,
                fileId: previewFile.id,
                source: previewFile.source,
              })}
            />
          </div>
        </AppDialog>
      ) : null}
    </>
  )
}
