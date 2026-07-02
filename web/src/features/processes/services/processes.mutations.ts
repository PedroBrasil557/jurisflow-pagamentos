import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { ProcessFormValues } from '../process-form.types'
import {
  createProcessViaScanRequest,
  importDocumentRequest,
  reprocessImportRequest,
} from './extraction.service'
import { processKeys } from './processes.queries'
import {
  cancelProcessRequest,
  createProcessRequest,
  deleteBatchFileRequest,
  deleteChecklistFileRequest,
  finalizeProcessRequest,
  type GenerateProcessPdfModelKey,
  generateProcessPdfRequest,
  type LegalProcessInput,
  markProcessDocumentationReadyRequest,
  removeDocumentationAssigneeRequest,
  setDocumentationAssigneeRequest,
  splitBatchFileRequest,
  startProcessRequest,
  submitProcessChecklistItemRequest,
  updateLegalProcessRequest,
  updateProcessRequest,
  uploadBatchFilesRequest,
} from './processes.service'

export function useCreateProcess() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: ProcessFormValues) => createProcessRequest(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useCreateProcessViaScan() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      pdf: Blob
      onProgress?: (fraction: number) => void
    }) => createProcessViaScanRequest(input.pdf, input.onProgress),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useImportDocument() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (files: File[]) => importDocumentRequest(files),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useReprocessImport(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => reprocessImportRequest(processId),
    // Re-dispara a ingestao (202). Reinicia a consulta do lote para o polling
    // acompanhar processing -> done/error.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.batch(processId) })
    },
  })
}

export function useUpdateProcess(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (values: ProcessFormValues) =>
      updateProcessRequest(processId, values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
      queryClient.invalidateQueries({
        queryKey: processKeys.checklist(processId),
      })
    },
  })
}

export function useUploadBatchFiles(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (files: File[]) =>
      uploadBatchFilesRequest({ processId, files }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.batch(processId) })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useDeleteBatchFile(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) =>
      deleteBatchFileRequest({ processId, fileId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.batch(processId) })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useSplitBatchFile(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (fileId: string) =>
      splitBatchFileRequest({ processId, fileId }),
    // O desmembramento roda em segundo plano (resposta 202). Apenas reinicia a
    // consulta do lote para o polling acompanhar processing -> done/error.
    // O checklist e demais queries sao invalidados quando o polling ve 'done'.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.batch(processId) })
    },
  })
}

export function useDeleteChecklistFile(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: { processDocumentId: string; fileId: string }) =>
      deleteChecklistFileRequest({ processId, ...input }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: processKeys.checklist(processId),
      })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
    },
  })
}

export function useSubmitChecklistItem(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: {
      file?: File | null
      markOkWithoutFile?: boolean
      observation?: string
      processDocumentId: string
    }) =>
      submitProcessChecklistItemRequest({
        ...input,
        processId,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: processKeys.checklist(processId),
      })
    },
  })
}

export function useMarkDocumentationReady(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => markProcessDocumentationReadyRequest(processId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
      queryClient.invalidateQueries({
        queryKey: processKeys.checklist(processId),
      })
    },
  })
}

export function useStartProcess(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: LegalProcessInput) =>
      startProcessRequest(processId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}

export function useUpdateLegalProcess(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (payload: LegalProcessInput) =>
      updateLegalProcessRequest(processId, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}

export function useFinalizeProcess(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => finalizeProcessRequest(processId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}

export function useCancelProcess(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (reason?: string) => cancelProcessRequest(processId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}

export function useGenerateProcessPdf(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (modelKey: GenerateProcessPdfModelKey) =>
      generateProcessPdfRequest({ processId, modelKey }),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: processKeys.pdfModels(processId),
      })
    },
  })
}

export function useSetDocumentationAssignee(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (assigneeUserId: string) =>
      setDocumentationAssigneeRequest({ processId, assigneeUserId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}

export function useRemoveDocumentationAssignee(processId: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => removeDocumentationAssigneeRequest(processId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: processKeys.lists() })
      queryClient.invalidateQueries({
        queryKey: processKeys.detail(processId),
      })
    },
  })
}
