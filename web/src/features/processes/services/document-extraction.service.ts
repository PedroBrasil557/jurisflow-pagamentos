import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const processRoute = apiClient.api.processes[':processId']
const aiAnalysesRoute = processRoute['ai-analyses']
const aiAnalysisDetailRoute = aiAnalysesRoute[':id']

type ListAnalysesResponse = InferResponseType<typeof aiAnalysesRoute.$get, 200>
type AnalysisDetailResponse = InferResponseType<
  typeof aiAnalysisDetailRoute.$get,
  200
>

export type DocumentExtractionListItem = ListAnalysesResponse['items'][number]
export type DocumentExtractionDetail = AnalysisDetailResponse['analysis']

// Lista as auditorias de classificacao (kind document_extraction) do processo. A
// lista traz `context` (fileId) — usado para ligar cada auditoria ao arquivo de
// lote — mas NAO traz output/decision (PII-safe); o detalhe completo vem do $get
// por id.
export async function fetchDocumentExtractions(
  processId: string,
): Promise<ListAnalysesResponse> {
  const response = await aiAnalysesRoute.$get({
    param: { processId },
    query: { kind: 'document_extraction', limit: '20' },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as classificacoes de documentos.',
      ),
    )
  }

  return (await response.json()) as ListAnalysesResponse
}

export async function fetchDocumentExtractionDetail(
  processId: string,
  id: string,
): Promise<AnalysisDetailResponse> {
  const response = await aiAnalysisDetailRoute.$get({
    param: { processId, id },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar a classificacao.',
      ),
    )
  }

  return (await response.json()) as AnalysisDetailResponse
}
