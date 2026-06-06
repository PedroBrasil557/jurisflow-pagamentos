import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const extractDocumentsClientRoute = apiClient.api.processes['extract-documents']

export type ExtractDocumentsResponse = InferResponseType<
  typeof extractDocumentsClientRoute.$post,
  200
>

export type ExtractedField = ExtractDocumentsResponse['fields'][number]

// Envia os documentos (RG/CNH + comprovante) para extracao via IA.
// Stateless: o backend nao grava nada — os arquivos seguem em memoria no cliente.
export async function extractDocumentsRequest(
  files: File[],
): Promise<ExtractDocumentsResponse> {
  const formData = new FormData()

  for (const file of files) {
    formData.append('files', file)
  }

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
        'Nao foi possivel extrair os dados dos documentos.',
      ),
    )
  }

  return (await response.json()) as ExtractDocumentsResponse
}
