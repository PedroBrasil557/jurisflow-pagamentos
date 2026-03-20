import type { InferRequestType, InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import type {
  PlatformUserOption,
  ProcessDraftRecord,
  ProcessFormValues,
} from '../process-form.types'
import { formatCpf } from '../process-form.utils'

const processClientRoute = apiClient.api.processes[':processId']
const processPdfModelsClientRoute = processClientRoute.pdf.models
const processPdfModelGenerateClientRoute =
  processPdfModelsClientRoute[':modelKey'].generate
const processMarkDocumentationReadyClientRoute =
  processClientRoute['mark-documentation-ready']
const processChecklistClientRoute = processClientRoute.checklist
const processChecklistItemClientRoute =
  processChecklistClientRoute[':processDocumentId']
const processChecklistSubmitClientRoute = processChecklistItemClientRoute.submit
const processChecklistFileDownloadClientRoute =
  processChecklistItemClientRoute.files[':fileId'].download
const processHistoryClientRoute = processClientRoute.history
const processCancelClientRoute = processClientRoute.cancel
const processStartClientRoute = processClientRoute.start
const processLegalClientRoute = processClientRoute.legal
const processFinalizeClientRoute = processClientRoute.finalize

type ListProcessesResponse = InferResponseType<
  typeof apiClient.api.processes.$get,
  200
>
type GetProcessResponse = InferResponseType<typeof processClientRoute.$get, 200>
type GetProcessChecklistResponse = InferResponseType<
  typeof processChecklistClientRoute.$get,
  200
>
type GetProcessPdfModelsResponse = InferResponseType<
  typeof processPdfModelsClientRoute.$get,
  200
>
type GenerateProcessPdfResponse = InferResponseType<
  typeof processPdfModelGenerateClientRoute.$post,
  201
>
type MarkProcessDocumentationReadyResponse = InferResponseType<
  typeof processMarkDocumentationReadyClientRoute.$post,
  200
>
export type GenerateProcessPdfModelKey = InferRequestType<
  typeof processPdfModelGenerateClientRoute.$post
>['param']['modelKey']
type FinalizeProcessResponse = InferResponseType<
  typeof processFinalizeClientRoute.$post,
  200
>
type StartProcessResponse = InferResponseType<
  typeof processStartClientRoute.$post,
  200
>
type UpdateLegalProcessResponse = InferResponseType<
  typeof processLegalClientRoute.$patch,
  200
>
type CancelProcessResponse = InferResponseType<
  typeof processCancelClientRoute.$post,
  200
>
type SubmitProcessChecklistResponse = InferResponseType<
  typeof processChecklistSubmitClientRoute.$post,
  200
>
type GetProcessChecklistFileDownloadResponse = InferResponseType<
  typeof processChecklistFileDownloadClientRoute.$get,
  200
>
type GetProcessHistoryResponse = InferResponseType<
  typeof processHistoryClientRoute.$get,
  200
>
type UserOptionsResponse = InferResponseType<
  typeof apiClient.api.users.options.$get,
  200
>
type CreateProcessRequest = InferRequestType<
  typeof apiClient.api.processes.$post
>['json']
type UpdateProcessRequest = InferRequestType<
  typeof processClientRoute.$patch
>['json']

type ProcessRecord = GetProcessResponse['process']
type ProcessUserOptionRecord = UserOptionsResponse['items'][number]

export type ProcessesPageData = ListProcessesResponse
export type ProcessListItem = ListProcessesResponse['items'][number]
export type ProcessChecklistData = GetProcessChecklistResponse
export type ProcessChecklistItem = GetProcessChecklistResponse['items'][number]
export type ProcessChecklistFile =
  GetProcessChecklistResponse['items'][number]['currentFiles'][number]
export type ProcessPdfModelOption = GetProcessPdfModelsResponse['items'][number]
export type ProcessChecklistPageData = {
  checklist: ProcessChecklistData
  process: ProcessRecord
}
export type ProcessHistoryItem = GetProcessHistoryResponse['items'][number]

export type LegalProcessInput = {
  causeValue: string
  legalProcessNumber: string
  protocolDate: string
}

export type ProcessListQuery = {
  limit?: number
  page?: number
  search?: string
}

export const defaultProcessPageLimit = 10

const processStatusLabels = {
  EM_DOCUMENTACAO: 'Em documentacao',
  DOCUMENTACAO_PRONTA: 'Documentacao pronta',
  EM_PROCESSO: 'Em processo',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
} as const

function mapPlatformUserOption(
  input: ProcessUserOptionRecord,
): PlatformUserOption {
  return {
    id: input.id,
    label: input.name,
    cpf: input.username ? formatCpf(input.username) : '',
  }
}

function mapProcessStatusLabel(status: string) {
  if (status in processStatusLabels) {
    return processStatusLabels[status as keyof typeof processStatusLabels]
  }

  return status.replaceAll('_', ' ')
}

function mapProcessToFormValues(
  currentProcess: ProcessRecord,
): ProcessFormValues {
  return {
    fullName: currentProcess.fullName,
    birthDate: currentProcess.birthDate,
    nationality: currentProcess.nationality,
    maritalStatus:
      currentProcess.maritalStatus as ProcessFormValues['maritalStatus'],
    profession: currentProcess.profession,
    ownerType: currentProcess.ownerType as ProcessFormValues['ownerType'],
    cpf: formatCpf(currentProcess.cpf),
    rg: currentProcess.rg,
    cadunico: currentProcess.cadunico as ProcessFormValues['cadunico'],
    propertyPaidOff:
      currentProcess.propertyPaidOff as ProcessFormValues['propertyPaidOff'],
    deliveredMoreThanTenYears:
      currentProcess.deliveredMoreThanTenYears as ProcessFormValues['deliveredMoreThanTenYears'],
    purchaseAgreementLessThanTenYears:
      currentProcess.purchaseAgreementLessThanTenYears as ProcessFormValues['purchaseAgreementLessThanTenYears'],
    state: currentProcess.state,
    city: currentProcess.city,
    district: currentProcess.district,
    housingComplex: currentProcess.housingComplex,
    street: currentProcess.street,
    number: currentProcess.number,
    complement: currentProcess.complement,
    zipcode: currentProcess.zipcode,
    email: currentProcess.email,
    whatsapp: currentProcess.whatsapp,
    witness1Id: currentProcess.witness1Id,
    witness2Id: currentProcess.witness2Id,
    observation: currentProcess.observation,
  }
}

export function mapProcessToDraft(
  currentProcess: ProcessRecord,
): ProcessDraftRecord {
  return {
    code: currentProcess.code,
    status: mapProcessStatusLabel(currentProcess.status),
    values: mapProcessToFormValues(currentProcess),
  }
}

function toProcessPayload(
  values: ProcessFormValues,
): CreateProcessRequest | UpdateProcessRequest {
  return {
    fullName: values.fullName,
    birthDate: values.birthDate,
    nationality: values.nationality,
    maritalStatus:
      values.maritalStatus as CreateProcessRequest['maritalStatus'],
    profession: values.profession,
    ownerType: values.ownerType as CreateProcessRequest['ownerType'],
    cpf: values.cpf,
    rg: values.rg,
    cadunico: values.cadunico,
    propertyPaidOff: values.propertyPaidOff,
    deliveredMoreThanTenYears: values.deliveredMoreThanTenYears,
    purchaseAgreementLessThanTenYears: values.purchaseAgreementLessThanTenYears,
    state: values.state,
    city: values.city,
    district: values.district,
    housingComplex: values.housingComplex,
    street: values.street,
    number: values.number,
    complement: values.complement,
    zipcode: values.zipcode,
    email: values.email,
    whatsapp: values.whatsapp,
    witness1Id: values.witness1Id,
    witness2Id: values.witness2Id,
    observation: values.observation,
  }
}

export function getProcessStatusLabel(status: string) {
  return mapProcessStatusLabel(status)
}

export async function fetchProcesses(
  query: ProcessListQuery,
): Promise<ListProcessesResponse> {
  const trimmedSearch = query.search?.trim() ?? ''
  const response = await apiClient.api.processes.$get({
    query: {
      limit: String(query.limit ?? defaultProcessPageLimit),
      page: String(query.page ?? 1),
      ...(trimmedSearch
        ? {
            search: trimmedSearch,
          }
        : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to fetch processes from API.'),
    )
  }

  return (await response.json()) as ListProcessesResponse
}

export async function fetchProcess(
  processId: string,
): Promise<GetProcessResponse> {
  const response = await processClientRoute.$get({
    param: {
      processId,
    },
  })

  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Failed to fetch process.'))
  }

  return (await response.json()) as GetProcessResponse
}

export async function fetchProcessChecklist(
  processId: string,
): Promise<GetProcessChecklistResponse> {
  const response = await processChecklistClientRoute.$get({
    param: {
      processId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to fetch process checklist.'),
    )
  }

  return (await response.json()) as GetProcessChecklistResponse
}

export type UserOptionsQuery = {
  search?: string
  limit?: number
  page?: number
}

export type UserOptionsPageData = {
  witnessUsers: PlatformUserOption[]
  page: number
  pageSize: number
  total: number
}

export async function fetchUserOptions(
  query: UserOptionsQuery = {},
): Promise<UserOptionsPageData> {
  const response = await apiClient.api.users.options.$get({
    query: {
      ...(query.search ? { search: query.search } : {}),
      limit: String(query.limit ?? 20),
      page: String(query.page ?? 1),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to fetch user options from API.'),
    )
  }

  const result = (await response.json()) as UserOptionsResponse & {
    page: number
    pageSize: number
    total: number
  }

  return {
    witnessUsers: result.items.map(mapPlatformUserOption),
    page: result.page,
    pageSize: result.pageSize,
    total: result.total,
  }
}

export async function createProcessRequest(values: ProcessFormValues) {
  const response = await apiClient.api.processes.$post({
    json: toProcessPayload(values) as CreateProcessRequest,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to create process.'),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof apiClient.api.processes.$post,
    201
  >
}

export async function updateProcessRequest(
  processId: string,
  values: ProcessFormValues,
) {
  const response = await processClientRoute.$patch({
    param: {
      processId,
    },
    json: toProcessPayload(values) as UpdateProcessRequest,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to update process.'),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof processClientRoute.$patch,
    200
  >
}

export async function submitProcessChecklistItemRequest(input: {
  file?: File | null
  markOkWithoutFile?: boolean
  observation?: string
  processDocumentId: string
  processId: string
}) {
  const response = await processChecklistSubmitClientRoute.$post({
    param: {
      processId: input.processId,
      processDocumentId: input.processDocumentId,
    },
    form: {
      observation: input.observation?.trim() ?? '',
      ...(input.markOkWithoutFile
        ? {
            markOkWithoutFile: 'true',
          }
        : {}),
      ...(input.file
        ? {
            file: input.file,
          }
        : {}),
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to submit checklist item.'),
    )
  }

  return (await response.json()) as SubmitProcessChecklistResponse
}

export async function getProcessPdfModelsRequest(processId: string) {
  const response = await processPdfModelsClientRoute.$get({
    param: {
      processId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to fetch process PDF models.'),
    )
  }

  return (await response.json()) as GetProcessPdfModelsResponse
}

export async function generateProcessPdfRequest(input: {
  modelKey: GenerateProcessPdfModelKey
  processId: string
}) {
  const response = await processPdfModelGenerateClientRoute.$post({
    param: {
      processId: input.processId,
      modelKey: input.modelKey,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to generate process PDF.'),
    )
  }

  return (await response.json()) as GenerateProcessPdfResponse
}

export async function getProcessChecklistFileDownloadRequest(input: {
  fileId: string
  processDocumentId: string
  processId: string
}) {
  const response = await processChecklistFileDownloadClientRoute.$get({
    param: {
      processId: input.processId,
      processDocumentId: input.processDocumentId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Failed to generate checklist file download URL.',
      ),
    )
  }

  return (await response.json()) as GetProcessChecklistFileDownloadResponse
}

export async function markProcessDocumentationReadyRequest(processId: string) {
  const response = await processMarkDocumentationReadyClientRoute.$post({
    param: {
      processId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Failed to mark process documentation as ready.',
      ),
    )
  }

  return (await response.json()) as MarkProcessDocumentationReadyResponse
}

export async function fetchProcessHistory(
  processId: string,
  options?: { cursor?: string; limit?: number },
) {
  const params = new URLSearchParams()

  if (options?.cursor) {
    params.set('cursor', options.cursor)
  }

  if (options?.limit) {
    params.set('limit', String(options.limit))
  }

  const qs = params.toString()
  const url = `${apiClient.api.processes[':processId'].history.$url({ param: { processId } })}${qs ? `?${qs}` : ''}`

  const response = await fetch(url, { credentials: 'include' })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Failed to fetch process history.'),
    )
  }

  return (await response.json()) as GetProcessHistoryResponse
}

export async function cancelProcessRequest(processId: string, reason?: string) {
  const response = await processCancelClientRoute.$post({
    param: { processId },
    json: { reason },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel cancelar o processo.'),
    )
  }

  return (await response.json()) as CancelProcessResponse
}

export async function startProcessRequest(
  processId: string,
  payload: LegalProcessInput,
) {
  const response = await processStartClientRoute.$post({
    param: { processId },
    json: payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel iniciar o processo.'),
    )
  }

  return (await response.json()) as StartProcessResponse
}

export async function updateLegalProcessRequest(
  processId: string,
  payload: LegalProcessInput,
) {
  const response = await processLegalClientRoute.$patch({
    param: { processId },
    json: payload,
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel atualizar os dados do processo juridico.',
      ),
    )
  }

  return (await response.json()) as UpdateLegalProcessResponse
}

export async function finalizeProcessRequest(processId: string) {
  const response = await processFinalizeClientRoute.$post({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel finalizar o processo.'),
    )
  }

  return (await response.json()) as FinalizeProcessResponse
}
