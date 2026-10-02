import { useMutation, useQueryClient } from '@tanstack/react-query'
import { linkRecipientUserRequest } from './finance-quick.service'
import { financeKeys } from './finance.queries'
import {
  approveReceiptRequest,
  calculateReceiptRequest,
  cancelReceiptRequest,
  confirmImportRequest,
  createAdjustmentRequest,
  createClosingRequest,
  createPayoutRequest,
  createReceiptRequest,
  createRecipientRequest,
  createReserveDebitRequest,
  createRuleRequest,
  createRuleVersionRequest,
  previewImportRequest,
  type RulePayload,
  reverseClosingRequest,
  reversePayoutRequest,
  reverseReserveMovementRequest,
  revokeRuleRequest,
  updateReceiptRequest,
  updateRecipientRequest,
  uploadAttachmentRequest,
} from './finance.service'

// Toda mutacao financeira invalida o modulo inteiro: saldos, extratos e estados
// dependem uns dos outros e o volume e pequeno.
function useFinanceMutation<TVariables, TResult>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: financeKeys.all })
    },
  })
}

export const useCreateRecipient = () =>
  useFinanceMutation(createRecipientRequest)
export const useUpdateRecipient = () =>
  useFinanceMutation(updateRecipientRequest)
export const useCreateRule = () => useFinanceMutation(createRuleRequest)
export const useCreateRuleVersion = () =>
  useFinanceMutation((v: { lineageId: string; payload: RulePayload }) =>
    createRuleVersionRequest(v.lineageId, v.payload),
  )
export const useRevokeRule = () =>
  useFinanceMutation((v: { id: string; reason: string }) =>
    revokeRuleRequest(v.id, v.reason),
  )
export const useLinkRecipientUser = () =>
  useFinanceMutation(linkRecipientUserRequest)
export const usePreviewImport = () =>
  useMutation({
    mutationFn: (v: { file: File; mapping?: Record<string, string> }) =>
      previewImportRequest(v.file, v.mapping),
  })
export const useConfirmImport = () =>
  useFinanceMutation((v: { file: File; mapping: Record<string, string> }) =>
    confirmImportRequest(v.file, v.mapping),
  )
export const useCreateReceipt = () => useFinanceMutation(createReceiptRequest)
export const useUpdateReceipt = () => useFinanceMutation(updateReceiptRequest)
export const useCalculateReceipt = () =>
  useFinanceMutation(calculateReceiptRequest)
export const useApproveReceipt = () => useFinanceMutation(approveReceiptRequest)
export const useCancelReceipt = () =>
  useFinanceMutation((v: { id: string; reason: string }) =>
    cancelReceiptRequest(v.id, v.reason),
  )
export const useCreateClosing = () => useFinanceMutation(createClosingRequest)
export const useReverseClosing = () =>
  useFinanceMutation((v: { id: string; reason: string }) =>
    reverseClosingRequest(v.id, v.reason),
  )
export const useCreatePayout = () => useFinanceMutation(createPayoutRequest)
export const useReversePayout = () =>
  useFinanceMutation((v: { id: string; reason: string }) =>
    reversePayoutRequest(v.id, v.reason),
  )
export const useCreateAdjustment = () =>
  useFinanceMutation(createAdjustmentRequest)
export const useCreateReserveDebit = () =>
  useFinanceMutation(createReserveDebitRequest)
export const useReverseReserveMovement = () =>
  useFinanceMutation((v: { id: string; reason: string }) =>
    reverseReserveMovementRequest(v.id, v.reason),
  )
export const useUploadAttachment = () =>
  useFinanceMutation(
    (v: {
      ownerKind: 'receipt' | 'payout' | 'reserve'
      ownerId: string
      file: File
    }) => uploadAttachmentRequest(v.ownerKind, v.ownerId, v.file),
  )
