import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'
import { reportClientError } from '@/shared/services/telemetry'

const extractDocumentsClientRoute = apiClient.api.processes['extract-documents']
const importBundleClientRoute =
  apiClient.api.processes[':processId']['import-bundle']
const scanClientRoute = apiClient.api.processes.scan

export type CreateProcessViaScanResponse = InferResponseType<
  typeof scanClientRoute.$post,
  202
>

// Cria um processo RASCUNHO a partir do scan e dispara a ingestao em background.
// Retorna na hora { processId, batchFileId }; o andamento e acompanhado pelo
// splitStatus do lote (polling).
export async function createProcessViaScanRequest(
  file: File,
): Promise<CreateProcessViaScanResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(scanClientRoute.$url(), {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel iniciar a digitalizacao.',
      ),
    )
  }

  return (await response.json()) as CreateProcessViaScanResponse
}

export type ExtractDocumentsResponse = InferResponseType<
  typeof extractDocumentsClientRoute.$post,
  200
>

export type ExtractedField = ExtractDocumentsResponse['fields'][number]
export type ExtractedDocument = ExtractDocumentsResponse['documents'][number]

// Envia o PDF unico (com todos os documentos) para extracao + classificacao via IA.
// Stateless: o backend nao grava nada — o arquivo segue em memoria no cliente.
export async function extractDocumentsRequest(
  file: File,
): Promise<ExtractDocumentsResponse> {
  const formData = new FormData()
  formData.append('files', file)

  const url = extractDocumentsClientRoute.$url()

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel extrair os dados do documento.',
      ),
    )
  }

  return (await response.json()) as ExtractDocumentsResponse
}

// Desmembra o PDF no backend e anexa cada parte ao checklist do processo.
export async function importBundleRequest(input: {
  processId: string
  file: File
  documents: ExtractedDocument[]
}) {
  const formData = new FormData()
  formData.append('file', input.file)
  formData.append('documents', JSON.stringify(input.documents))

  const url = importBundleClientRoute.$url({
    param: { processId: input.processId },
  })

  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
  } catch (error) {
    // Falha de REDE: a requisicao nem completou (ex.: "Failed to fetch"/
    // ERR_FAILED — conexao caiu, antivirus/proxy/extensao bloqueou). Como nunca
    // chega ao endpoint, reporta via telemetria com contexto para diagnostico.
    reportClientError('import_bundle_network_error', {
      processId: input.processId,
      fileName: input.file.name,
      fileSizeBytes: input.file.size,
      errorName: error instanceof Error ? error.name : 'unknown',
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    throw new Error(
      'Falha de rede ao enviar o documento (a conexao caiu ou foi bloqueada por antivirus/proxy/extensao). Verifique a rede e tente novamente.',
    )
  }

  if (!response.ok) {
    const requestId = response.headers.get('x-request-id') ?? undefined
    reportClientError('import_bundle_http_error', {
      processId: input.processId,
      status: response.status,
      requestId,
    })
    const base = await getErrorMessage(
      response,
      'Nao foi possivel anexar os documentos ao checklist.',
    )
    throw new Error(requestId ? `${base} (cod: ${requestId})` : base)
  }

  return (await response.json()) as InferResponseType<
    typeof importBundleClientRoute.$post,
    200
  >
}
