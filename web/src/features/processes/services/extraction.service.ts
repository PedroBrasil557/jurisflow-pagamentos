import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const extractDocumentsClientRoute = apiClient.api.processes['extract-documents']
const importBundleClientRoute =
  apiClient.api.processes[':processId']['import-bundle']
const ocrClientRoute = apiClient.api.processes.ocr

export type CreateProcessViaOcrResponse = InferResponseType<
  typeof ocrClientRoute.$post,
  202
>

// Cria um processo RASCUNHO a partir do scan e dispara a ingestao OCR em
// background. Retorna na hora { processId, batchFileId }; o andamento e
// acompanhado pelo splitStatus do lote (polling).
export async function createProcessViaOcrRequest(
  file: File,
): Promise<CreateProcessViaOcrResponse> {
  const formData = new FormData()
  formData.append('file', file)

  const response = await fetch(ocrClientRoute.$url(), {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel iniciar o cadastro por OCR.',
      ),
    )
  }

  return (await response.json()) as CreateProcessViaOcrResponse
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

  const response = await fetch(url, {
    method: 'POST',
    body: formData,
    credentials: 'include',
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel anexar os documentos ao checklist.',
      ),
    )
  }

  return (await response.json()) as InferResponseType<
    typeof importBundleClientRoute.$post,
    200
  >
}
