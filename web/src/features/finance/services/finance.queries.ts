import { queryOptions } from '@tanstack/react-query'
import {
  fetchAttachments,
  fetchClosing,
  fetchClosings,
  fetchComplexOptions,
  fetchCredits,
  fetchOverview,
  fetchPayouts,
  fetchProcessOptions,
  fetchReceipt,
  fetchReceipts,
  fetchRecipients,
  fetchReserveMovements,
  fetchReserves,
  fetchRules,
  fetchStatement,
  type ReceiptStatus,
  type StatementQuery,
} from './finance.service'

export const financeKeys = {
  all: ['finance'] as const,
  overview: () => [...financeKeys.all, 'overview'] as const,
  recipients: () => [...financeKeys.all, 'recipients'] as const,
  rules: () => [...financeKeys.all, 'rules'] as const,
  complexes: () => [...financeKeys.all, 'complexes'] as const,
  processes: (search: string) =>
    [...financeKeys.all, 'processes', search] as const,
  receipts: () => [...financeKeys.all, 'receipts'] as const,
  receiptList: (query: { status?: ReceiptStatus[]; search?: string }) =>
    [...financeKeys.receipts(), 'list', query] as const,
  receipt: (id: string) => [...financeKeys.receipts(), 'detail', id] as const,
  closings: () => [...financeKeys.all, 'closings'] as const,
  closing: (id: string) => [...financeKeys.closings(), 'detail', id] as const,
  credits: (query: { closingId?: string; recipientId?: string }) =>
    [...financeKeys.all, 'credits', query] as const,
  statement: (query: StatementQuery) =>
    [...financeKeys.all, 'statement', query] as const,
  reserves: () => [...financeKeys.all, 'reserves'] as const,
  reserveMovements: (poolKey?: string) =>
    [...financeKeys.reserves(), 'movements', poolKey ?? 'todas'] as const,
  attachments: (ownerKind: string, ownerId: string) =>
    [...financeKeys.all, 'attachments', ownerKind, ownerId] as const,
}

export const overviewQuery = () =>
  queryOptions({ queryKey: financeKeys.overview(), queryFn: fetchOverview })
export const recipientsQuery = () =>
  queryOptions({ queryKey: financeKeys.recipients(), queryFn: fetchRecipients })
export const rulesQuery = () =>
  queryOptions({ queryKey: financeKeys.rules(), queryFn: fetchRules })
export const complexOptionsQuery = () =>
  queryOptions({
    queryKey: financeKeys.complexes(),
    queryFn: fetchComplexOptions,
    staleTime: 5 * 60 * 1000,
  })
export const processOptionsQuery = (search: string) =>
  queryOptions({
    queryKey: financeKeys.processes(search),
    queryFn: () => fetchProcessOptions(search),
  })
export const receiptsQuery = (query: {
  status?: ReceiptStatus[]
  search?: string
}) =>
  queryOptions({
    queryKey: financeKeys.receiptList(query),
    queryFn: () => fetchReceipts(query),
  })
export const receiptQuery = (id: string) =>
  queryOptions({
    queryKey: financeKeys.receipt(id),
    queryFn: () => fetchReceipt(id),
  })
export const closingsQuery = () =>
  queryOptions({ queryKey: financeKeys.closings(), queryFn: fetchClosings })
export const closingQuery = (id: string) =>
  queryOptions({
    queryKey: financeKeys.closing(id),
    queryFn: () => fetchClosing(id),
  })
export const creditsQuery = (query: {
  closingId?: string
  recipientId?: string
}) =>
  queryOptions({
    queryKey: financeKeys.credits(query),
    queryFn: () => fetchCredits(query),
  })
export const statementQuery = (query: StatementQuery) =>
  queryOptions({
    queryKey: financeKeys.statement(query),
    queryFn: () => fetchStatement(query),
  })
export const reservesQuery = () =>
  queryOptions({ queryKey: financeKeys.reserves(), queryFn: fetchReserves })
export const reserveMovementsQuery = (poolKey?: string) =>
  queryOptions({
    queryKey: financeKeys.reserveMovements(poolKey),
    queryFn: () => fetchReserveMovements({ poolKey }),
  })
export const attachmentsQuery = (
  ownerKind: 'receipt' | 'payout' | 'reserve',
  ownerId: string,
) =>
  queryOptions({
    queryKey: financeKeys.attachments(ownerKind, ownerId),
    queryFn: () => fetchAttachments(ownerKind, ownerId),
  })

export const payoutsQuery = (creditId: string) =>
  queryOptions({
    queryKey: [...financeKeys.all, 'payouts', creditId] as const,
    queryFn: () => fetchPayouts({ creditId }),
  })
