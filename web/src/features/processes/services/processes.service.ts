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
const processChecklistFileClientRoute =
  processChecklistItemClientRoute.files[':fileId']
const processChecklistFileDownloadClientRoute =
  processChecklistFileClientRoute.download
const processChecklistFileContentClientRoute =
  processChecklistClientRoute.files[':fileId'].conteudo
const processBatchClientRoute = processClientRoute.batch
const processBatchFileClientRoute = processBatchClientRoute[':fileId']
const processBatchFileSplitClientRoute = processBatchFileClientRoute.split
const processHistoryClientRoute = processClientRoute.history
const processCancelClientRoute = processClientRoute.cancel
const processStartClientRoute = processClientRoute.start
const processLegalClientRoute = processClientRoute.legal
const processFinalizeClientRoute = processClientRoute.finalize
const processDocumentationAssigneeClientRoute =
  processClientRoute['documentation-assignee']

type ListProcessesResponse = InferResponseType<
  typeof apiClient.api.processes.$get,
  200
>
type GetProcessResponse = InferResponseType<typeof processClientRoute.$get, 200>
type GetProcessBatchFilesResponse = InferResponseType<
  typeof processBatchClientRoute.$get,
  200
>
type UploadBatchFilesResponse = InferResponseType<
  typeof processBatchClientRoute.upload.$post,
  201
>
type DeleteBatchFileResponse = InferResponseType<
  typeof processBatchFileClientRoute.$delete,
  200
>
type SplitBatchFileResponse = InferResponseType<
  typeof processBatchFileSplitClientRoute.$post,
  202
>
type GetBatchFileDownloadResponse = InferResponseType<
  typeof processBatchFileClientRoute.download.$get,
  200
>
type DownloadAllBatchFilesResponse = InferResponseType<
  (typeof processBatchClientRoute)['download-all']['$get'],
  200
>
type DownloadAllChecklistFilesResponse = InferResponseType<
  (typeof processChecklistClientRoute)['download-all']['$get'],
  200
>
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
type SetDocumentationAssigneeResponse = InferResponseType<
  typeof processDocumentationAssigneeClientRoute.$put,
  200
>
type RemoveDocumentationAssigneeResponse = InferResponseType<
  typeof processDocumentationAssigneeClientRoute.$delete,
  200
>
type SubmitProcessChecklistResponse = InferResponseType<
  typeof processChecklistSubmitClientRoute.$post,
  200
>
type DeleteChecklistFileResponse = InferResponseType<
  typeof processChecklistFileClientRoute.$delete,
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

export type ProcessBatchFilesData = GetProcessBatchFilesResponse
export type ProcessBatchFile = GetProcessBatchFilesResponse['files'][number]
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
  statuses?: ProcessStatusValue[]
  ownerTypes?: OwnerTypeValue[]
  housingComplexIds?: string[]
  createdFrom?: string
  createdTo?: string
  needsClassificationReview?: boolean
}

export const defaultProcessPageLimit = 10

export const processStatusLabels = {
  RASCUNHO: 'Rascunho',
  CADASTRADO: 'Cadastrado',
  EM_LOTE: 'Em lote',
  EM_DOCUMENTACAO: 'Documentacao pendente',
  DOCUMENTACAO_PRONTA: 'Documentacao pronta',
  EM_PROCESSO: 'Em processo',
  FINALIZADO: 'Finalizado',
  CANCELADO: 'Cancelado',
} as const

export type ProcessStatusValue = keyof typeof processStatusLabels

export const processStatusOptions = (
  Object.keys(processStatusLabels) as ProcessStatusValue[]
).map((value) => ({ value, label: processStatusLabels[value] }))

export const ownerTypeLabels = {
  titular_contrato_caixa: 'Titular contrato caixa',
  nao_titular_contrato_caixa: 'Nao titular contrato caixa',
} as const

export type OwnerTypeValue = keyof typeof ownerTypeLabels

export const ownerTypeFilterOptions = (
  Object.keys(ownerTypeLabels) as OwnerTypeValue[]
).map((value) => ({ value, label: ownerTypeLabels[value] }))

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
    birthDate: currentProcess.birthDate ?? '',
    nationality: currentProcess.nationality || 'Brasileira',
    maritalStatus:
      currentProcess.maritalStatus as ProcessFormValues['maritalStatus'],
    profession: currentProcess.profession,
    ownerType: currentProcess.ownerType as ProcessFormValues['ownerType'],
    cpf: formatCpf(currentProcess.cpf),
    rg: currentProcess.rg,
    cadunico: currentProcess.cadunico as ProcessFormValues['cadunico'],
    propertyPaidOff:
      currentProcess.propertyPaidOff as ProcessFormValues['propertyPaidOff'],
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
    spouseContractSigned: (currentProcess.spouseContractSigned ??
      '') as ProcessFormValues['spouseContractSigned'],
    spouseFullName: currentProcess.spouseFullName ?? '',
    spouseBirthDate: currentProcess.spouseBirthDate ?? '',
    spouseNationality: currentProcess.spouseNationality || 'BRASILEIRA',
    spouseMaritalStatus: (currentProcess.spouseMaritalStatus ??
      '') as ProcessFormValues['spouseMaritalStatus'],
    spouseProfession: currentProcess.spouseProfession ?? '',
    spouseCpf: currentProcess.spouseCpf
      ? formatCpf(currentProcess.spouseCpf)
      : '',
    spouseRg: currentProcess.spouseRg ?? '',
    spouseCadunico: (currentProcess.spouseCadunico ??
      '') as ProcessFormValues['spouseCadunico'],
    spouseSameAddress: (currentProcess.spouseSameAddress ??
      '') as ProcessFormValues['spouseSameAddress'],
    spouseState: currentProcess.spouseState ?? '',
    spouseCity: currentProcess.spouseCity ?? '',
    spouseDistrict: currentProcess.spouseDistrict ?? '',
    spouseHousingComplex: currentProcess.spouseHousingComplex ?? '',
    spouseStreet: currentProcess.spouseStreet ?? '',
    spouseNumber: currentProcess.spouseNumber ?? '',
    spouseComplement: currentProcess.spouseComplement ?? '',
    spouseZipcode: currentProcess.spouseZipcode ?? '',
    witness1Id: currentProcess.witness1Id ?? '',
    witness2Id: currentProcess.witness2Id ?? '',
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
    spouseContractSigned: values.spouseContractSigned,
    spouseFullName: values.spouseFullName,
    spouseBirthDate: values.spouseBirthDate,
    spouseNationality: values.spouseNationality,
    spouseMaritalStatus:
      values.spouseMaritalStatus as CreateProcessRequest['spouseMaritalStatus'],
    spouseProfession: values.spouseProfession,
    spouseCpf: values.spouseCpf,
    spouseRg: values.spouseRg,
    spouseCadunico: values.spouseCadunico,
    spouseSameAddress: values.spouseSameAddress,
    spouseState: values.spouseState,
    spouseCity: values.spouseCity,
    spouseDistrict: values.spouseDistrict,
    spouseHousingComplex: values.spouseHousingComplex,
    spouseStreet: values.spouseStreet,
    spouseNumber: values.spouseNumber,
    spouseComplement: values.spouseComplement,
    spouseZipcode: values.spouseZipcode,
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
      ...(query.statuses?.length ? { statuses: query.statuses } : {}),
      ...(query.ownerTypes?.length ? { ownerTypes: query.ownerTypes } : {}),
      ...(query.housingComplexIds?.length
        ? { housingComplexIds: query.housingComplexIds }
        : {}),
      ...(query.createdFrom ? { createdFrom: query.createdFrom } : {}),
      ...(query.createdTo ? { createdTo: query.createdTo } : {}),
      ...(query.needsClassificationReview
        ? { needsClassificationReview: 'true' }
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

// URL do CONTEUDO (bytes) same-origin de um arquivo do checklist — consumida pelo
// DocumentViewer (react-pdf / <img>). `source` distingue arquivo do processo vs do
// conjunto habitacional. A navegacao inclui o cookie de sessao (same-origin).
export function processChecklistFileContentUrl(input: {
  processId: string
  fileId: string
  source: 'process' | 'housing_complex'
}): string {
  return processChecklistFileContentClientRoute
    .$url({
      param: { processId: input.processId, fileId: input.fileId },
      query: { source: input.source },
    })
    .toString()
}

export async function deleteChecklistFileRequest(input: {
  fileId: string
  processDocumentId: string
  processId: string
}) {
  const response = await processChecklistFileClientRoute.$delete({
    param: {
      processId: input.processId,
      processDocumentId: input.processDocumentId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel remover o arquivo.'),
    )
  }

  return (await response.json()) as DeleteChecklistFileResponse
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

export async function setDocumentationAssigneeRequest(input: {
  processId: string
  assigneeUserId: string
}) {
  const response = await processDocumentationAssigneeClientRoute.$put({
    param: { processId: input.processId },
    json: { assigneeUserId: input.assigneeUserId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel designar o responsavel pela documentacao.',
      ),
    )
  }

  return (await response.json()) as SetDocumentationAssigneeResponse
}

export async function removeDocumentationAssigneeRequest(processId: string) {
  const response = await processDocumentationAssigneeClientRoute.$delete({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel remover o responsavel pela documentacao.',
      ),
    )
  }

  return (await response.json()) as RemoveDocumentationAssigneeResponse
}

export async function fetchBatchFiles(
  processId: string,
): Promise<GetProcessBatchFilesResponse> {
  const response = await processBatchClientRoute.$get({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar os arquivos em lote.',
      ),
    )
  }

  return (await response.json()) as GetProcessBatchFilesResponse
}

export async function uploadBatchFilesRequest(input: {
  processId: string
  files: File[]
}) {
  const formData = new FormData()

  for (const file of input.files) {
    formData.append('files', file)
  }

  const url = processBatchClientRoute.upload.$url({
    param: { processId: input.processId },
  })

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel enviar os arquivos em lote.',
      ),
    )
  }

  return (await response.json()) as UploadBatchFilesResponse
}

export async function deleteBatchFileRequest(input: {
  processId: string
  fileId: string
}) {
  const response = await processBatchFileClientRoute.$delete({
    param: {
      processId: input.processId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel remover o arquivo em lote.',
      ),
    )
  }

  return (await response.json()) as DeleteBatchFileResponse
}

export async function splitBatchFileRequest(input: {
  processId: string
  fileId: string
}) {
  const response = await processBatchFileSplitClientRoute.$post({
    param: {
      processId: input.processId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel desmembrar o arquivo.'),
    )
  }

  return (await response.json()) as SplitBatchFileResponse
}

export async function getBatchFileDownloadRequest(input: {
  processId: string
  fileId: string
}) {
  const response = await processBatchFileClientRoute.download.$get({
    param: {
      processId: input.processId,
      fileId: input.fileId,
    },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel preparar o download do arquivo.',
      ),
    )
  }

  return (await response.json()) as GetBatchFileDownloadResponse
}

export async function downloadAllBatchFilesRequest(processId: string) {
  const response = await processBatchClientRoute['download-all'].$get({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel preparar o download dos arquivos em lote.',
      ),
    )
  }

  return (await response.json()) as DownloadAllBatchFilesResponse
}

export async function downloadAllChecklistFilesRequest(processId: string) {
  const response = await processChecklistClientRoute['download-all'].$get({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel preparar o download dos documentos.',
      ),
    )
  }

  return (await response.json()) as DownloadAllChecklistFilesResponse
}

// Baixa um ZIP unico com todos os documentos do checklist. O servidor monta o
// ZIP, sobe no storage e retorna a URL assinada — o download vai do S3 direto ao
// navegador (sem passar pela API/gateway, que limitava o tamanho do payload).
export async function downloadAllChecklistZipRequest(processId: string) {
  const response = await processChecklistClientRoute['download-all.zip'].$get({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel baixar os documentos.'),
    )
  }

  return (await response.json()) as {
    downloadUrl: string
    fileName: string
    fileCount: number
  }
}

// Baixa um ZIP unico com todos os arquivos do lote (mesmo fluxo via storage).
export async function downloadAllBatchZipRequest(processId: string) {
  const response = await processBatchClientRoute['download-all.zip'].$get({
    param: { processId },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel baixar os arquivos em lote.',
      ),
    )
  }

  return (await response.json()) as {
    downloadUrl: string
    fileName: string
    fileCount: number
  }
}
