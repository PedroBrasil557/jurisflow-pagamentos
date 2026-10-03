import type { InferRequestType, InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const finance = apiClient.api.finance

async function ok<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) throw new Error(await getErrorMessage(response, fallback))
  return (await response.json()) as T
}

/** Chave de idempotencia por intencao do usuario (reenvio = mesma chave). */
export function newIdempotencyKey() {
  return crypto.randomUUID()
}

// ---- tipos inferidos da API
export type FinanceOverview = InferResponseType<
  typeof finance.overview.$get,
  200
>
export type Recipient = InferResponseType<
  typeof finance.recipients.$get,
  200
>['items'][number]
export type Rule = InferResponseType<
  typeof finance.rules.$get,
  200
>['items'][number]
export type RulePayload = InferRequestType<typeof finance.rules.$post>['json']
export type RecipientPayload = InferRequestType<
  typeof finance.recipients.$post
>['json']
export type RecipientUpdatePayload = InferRequestType<
  (typeof finance.recipients)[':id']['$patch']
>['json']
export type ReceiptListItem = InferResponseType<
  typeof finance.receipts.$get,
  200
>['items'][number]
export type ReceiptPayload = InferRequestType<
  typeof finance.receipts.$post
>['json']
export type ReceiptUpdatePayload = InferRequestType<
  (typeof finance.receipts)[':id']['$patch']
>['json']
export type ReceiptDetail = InferResponseType<
  (typeof finance.receipts)[':id']['$get'],
  200
>
export type ClosingListItem = InferResponseType<
  typeof finance.closings.$get,
  200
>['items'][number]
export type ClosingPreview = InferResponseType<
  (typeof finance.closings)['preview']['$post'],
  200
>
export type ClosingDetail = InferResponseType<
  (typeof finance.closings)[':id']['$get'],
  200
>
export type Credit = InferResponseType<
  typeof finance.credits.$get,
  200
>['items'][number]
export type PayoutPayload = InferRequestType<
  typeof finance.payouts.$post
>['json']
export type Statement = InferResponseType<typeof finance.statement.$get, 200>
export type StatementRecipientOption = InferResponseType<
  (typeof finance)['statement-recipient-options']['$get'],
  200
>['items'][number]
export type StatementQuery = InferRequestType<
  typeof finance.statement.$get
>['query']
export type ReserveBalance = InferResponseType<
  typeof finance.reserves.$get,
  200
>['items'][number]
export type ReserveMovement = InferResponseType<
  (typeof finance.reserves)['movements']['$get'],
  200
>['items'][number]
export type ReserveDebitPayload = InferRequestType<
  (typeof finance.reserves)['movements']['$post']
>['json']
export type ProcessOption = InferResponseType<
  (typeof finance.processes)['$get'],
  200
>['items'][number]
export type ComplexOption = InferResponseType<
  (typeof finance)['housing-complexes']['$get'],
  200
>['items'][number]
export type ReceiptStatus = ReceiptListItem['status']

export type ImportPreview = {
  fileName: string
  fileSha256: string
  headers: string[]
  mapping: Record<string, string>
  fields: { field: string; label: string; required: boolean }[]
  mappingErrors: string[]
  rows: { line: number; values: Record<string, string>; errors: string[] }[]
  summary: {
    total: number
    valid: number
    invalid: number
    newRecipients: string[]
  }
}

export type Attachment = {
  id: string
  originalFileName: string
  mimeType: string
  sizeInBytes: number
  uploadedAt: string
}

// ---- leitura
export async function fetchOverview() {
  return ok<FinanceOverview>(
    await finance.overview.$get(),
    'Não foi possível carregar a visão geral.',
  )
}
export async function fetchRecipients() {
  return (
    await ok<{ items: Recipient[] }>(
      await finance.recipients.$get(),
      'Não foi possível carregar os recebedores.',
    )
  ).items
}
export async function fetchRules() {
  return (
    await ok<{ items: Rule[] }>(
      await finance.rules.$get(),
      'Não foi possível carregar as regras.',
    )
  ).items
}
export async function fetchComplexOptions() {
  return (
    await ok<{ items: ComplexOption[] }>(
      await finance['housing-complexes'].$get(),
      'Não foi possível carregar os condomínios.',
    )
  ).items
}
export async function fetchStatementRecipientOptions() {
  return (
    await ok<{ items: StatementRecipientOption[] }>(
      await finance['statement-recipient-options'].$get(),
      'Não foi possível carregar os recebedores do histórico.',
    )
  ).items
}
export async function fetchProcessOptions(search: string) {
  const url = new URL(finance.processes.$url().toString())
  if (search.trim()) url.searchParams.set('search', search.trim())
  return (
    await ok<{ items: ProcessOption[] }>(
      await fetch(url, { credentials: 'include' }),
      'Não foi possível buscar processos.',
    )
  ).items
}
export async function fetchReceipts(query: {
  status?: ReceiptStatus[]
  search?: string
}) {
  return (
    await ok<{ items: ReceiptListItem[] }>(
      await finance.receipts.$get({
        query: { status: query.status, search: query.search || undefined },
      }),
      'Não foi possível carregar os recebimentos.',
    )
  ).items
}
export async function fetchReceipt(id: string) {
  return ok<ReceiptDetail>(
    await finance.receipts[':id'].$get({ param: { id } }),
    'Recebimento não encontrado.',
  )
}
export async function fetchClosings() {
  return (
    await ok<{ items: ClosingListItem[] }>(
      await finance.closings.$get(),
      'Não foi possível carregar os fechamentos.',
    )
  ).items
}
export async function fetchClosing(id: string) {
  return ok<ClosingDetail>(
    await finance.closings[':id'].$get({ param: { id } }),
    'Fechamento não encontrado.',
  )
}
export async function fetchCredits(query: {
  closingId?: string
  recipientId?: string
}) {
  return (
    await ok<{ items: Credit[] }>(
      await finance.credits.$get({ query }),
      'Não foi possível carregar os créditos.',
    )
  ).items
}
export async function fetchStatement(query: StatementQuery) {
  return ok<Statement>(
    await finance.statement.$get({ query }),
    'Não foi possível carregar o extrato.',
  )
}
export async function fetchReserves() {
  return (
    await ok<{ items: ReserveBalance[] }>(
      await finance.reserves.$get(),
      'Não foi possível carregar as reservas.',
    )
  ).items
}
export async function fetchReserveMovements(query: { poolKey?: string }) {
  return (
    await ok<{ items: ReserveMovement[] }>(
      await finance.reserves.movements.$get({ query }),
      'Não foi possível carregar os movimentos.',
    )
  ).items
}
export async function fetchAttachments(
  ownerKind: 'receipt' | 'payout' | 'reserve',
  ownerId: string,
) {
  return (
    await ok<{ items: Attachment[] }>(
      await finance.attachments[':ownerKind'][':ownerId'].$get({
        param: { ownerKind, ownerId },
      }),
      'Não foi possível carregar os comprovantes.',
    )
  ).items
}

// ---- escrita
export async function createRecipientRequest(payload: RecipientPayload) {
  return ok(
    await finance.recipients.$post({ json: payload }),
    'Não foi possível cadastrar o recebedor.',
  )
}
export async function updateRecipientRequest(input: {
  id: string
  payload: RecipientUpdatePayload
}) {
  return ok(
    await finance.recipients[':id'].$patch({
      param: { id: input.id },
      json: input.payload,
    }),
    'Não foi possível atualizar o recebedor.',
  )
}
export async function createRuleRequest(payload: RulePayload) {
  return ok(
    await finance.rules.$post({ json: payload }),
    'Não foi possível salvar a regra.',
  )
}
export async function createRuleVersionRequest(
  lineageId: string,
  payload: RulePayload,
) {
  return ok(
    await finance.rules[':id'].versions.$post({
      param: { id: lineageId },
      json: payload,
    }),
    'Não foi possível criar a nova versão.',
  )
}
export async function revokeRuleRequest(id: string, reason: string) {
  return ok(
    await finance.rules[':id'].revoke.$post({
      param: { id },
      json: { reason },
    }),
    'Não foi possível revogar a regra.',
  )
}
export async function createReceiptRequest(payload: ReceiptPayload) {
  return ok<{ receipt: { id: string } }>(
    await finance.receipts.$post({ json: payload }),
    'Não foi possível registrar o recebimento.',
  )
}
export async function updateReceiptRequest(input: {
  id: string
  payload: ReceiptUpdatePayload
}) {
  return ok(
    await finance.receipts[':id'].$patch({
      param: { id: input.id },
      json: input.payload,
    }),
    'Não foi possível atualizar a entrada.',
  )
}
export async function calculateReceiptRequest(id: string) {
  return ok(
    await finance.receipts[':id'].calculate.$post({ param: { id } }),
    'Não foi possível calcular a prévia.',
  )
}
export async function approveReceiptRequest(id: string) {
  return ok(
    await finance.receipts[':id'].approve.$post({ param: { id } }),
    'Não foi possível aprovar a prévia.',
  )
}
export async function cancelReceiptRequest(id: string, reason: string) {
  return ok(
    await finance.receipts[':id'].cancel.$post({
      param: { id },
      json: { reason },
    }),
    'Não foi possível cancelar.',
  )
}
export async function previewClosingRequest(json: {
  receiptIds: string[]
  periodStart: string
  periodEnd: string
}) {
  return ok<ClosingPreview>(
    await finance.closings.preview.$post({ json }),
    'Não foi possível validar o fechamento.',
  )
}
export async function createClosingRequest(json: {
  receiptIds: string[]
  periodStart: string
  periodEnd: string
  notes?: string
  idempotencyKey: string
}) {
  return ok<{ closing: { id: string; code: string } }>(
    await finance.closings.$post({ json }),
    'Não foi possível fechar o lote.',
  )
}
export async function reverseClosingRequest(id: string, reason: string) {
  return ok(
    await finance.closings[':id'].reverse.$post({
      param: { id },
      json: { reason },
    }),
    'Não foi possível estornar o fechamento.',
  )
}
export async function createPayoutRequest(json: PayoutPayload) {
  return ok<{ payout: { id: string } }>(
    await finance.payouts.$post({ json }),
    'Não foi possível registrar a baixa.',
  )
}
export async function reversePayoutRequest(id: string, reason: string) {
  return ok(
    await finance.payouts[':id'].reverse.$post({
      param: { id },
      json: { reason },
    }),
    'Não foi possível estornar a baixa.',
  )
}
export async function createAdjustmentRequest(json: {
  creditId: string
  amountCents: number
  reason: string
  idempotencyKey: string
}) {
  return ok(
    await finance.adjustments.$post({ json }),
    'Não foi possível registrar o ajuste.',
  )
}
export async function createReserveDebitRequest(json: ReserveDebitPayload) {
  return ok(
    await finance.reserves.movements.$post({ json }),
    'Não foi possível registrar o movimento.',
  )
}
export async function reverseReserveMovementRequest(id: string, reason: string) {
  return ok(
    await finance.reserves.movements[':id'].reverse.$post({
      param: { id },
      json: { reason },
    }),
    'Não foi possível estornar o movimento.',
  )
}

async function postFile<T>(
  url: string,
  file: File,
  extra: Record<string, string>,
  fallback: string,
) {
  const form = new FormData()
  form.append('file', file)
  for (const [k, v] of Object.entries(extra)) form.append(k, v)
  return ok<T>(
    await fetch(url, { method: 'POST', body: form, credentials: 'include' }),
    fallback,
  )
}
export async function previewImportRequest(
  file: File,
  mapping?: Record<string, string>,
) {
  return postFile<ImportPreview>(
    finance.imports.preview.$url().toString(),
    file,
    mapping ? { mapping: JSON.stringify(mapping) } : {},
    'Não foi possível ler a planilha.',
  )
}
export async function confirmImportRequest(
  file: File,
  mapping: Record<string, string>,
) {
  return postFile<{ replayed: boolean }>(
    finance.imports.confirm.$url().toString(),
    file,
    { mapping: JSON.stringify(mapping) },
    'Não foi possível confirmar a importação.',
  )
}
export async function uploadAttachmentRequest(
  ownerKind: 'receipt' | 'payout' | 'reserve',
  ownerId: string,
  file: File,
) {
  return postFile(
    finance.attachments[':ownerKind'][':ownerId']
      .$url({ param: { ownerKind, ownerId } })
      .toString(),
    file,
    {},
    'Não foi possível anexar o comprovante.',
  )
}
export async function removeAttachmentRequest(input: {
  id: string
  reason: string
}) {
  return ok(
    await finance['attachment-files'][':id'].remove.$post({
      param: { id: input.id },
      json: { reason: input.reason },
    }),
    'Não foi possível remover o comprovante.',
  )
}

/** Download autenticado (sem URL publica): baixa via fetch e aciona o navegador. */
export async function downloadAuthenticated(url: string, fallbackName: string) {
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok)
    throw new Error(
      await getErrorMessage(response, 'Não foi possível baixar o arquivo.'),
    )
  const blob = await response.blob()
  const href = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = fallbackName
  anchor.click()
  URL.revokeObjectURL(href)
}
export function attachmentDownloadUrl(id: string) {
  return finance['attachment-files'][':id'].$url({ param: { id } }).toString()
}
export function statementCsvUrl(query: Record<string, string | undefined>) {
  const url = new URL(finance['statement.csv'].$url().toString())
  for (const [k, v] of Object.entries(query)) if (v) url.searchParams.set(k, v)
  return url.toString()
}

export type Payout = InferResponseType<
  typeof finance.payouts.$get,
  200
>['items'][number]
export async function fetchPayouts(query: {
  creditId?: string
  recipientId?: string
}) {
  return (
    await ok<{ items: Payout[] }>(
      await finance.payouts.$get({ query }),
      'Não foi possível carregar as baixas.',
    )
  ).items
}
