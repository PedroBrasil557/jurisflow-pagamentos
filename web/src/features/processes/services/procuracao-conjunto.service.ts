import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const processRoute = apiClient.api.processes[':processId']
const aiAnalysesRoute = processRoute['ai-analyses']
const aiAnalysisDetailRoute = aiAnalysesRoute[':id']
const reanalyzeRoute = processRoute['procuracao-conjunto'].reanalyze

type ListAnalysesResponse = InferResponseType<typeof aiAnalysesRoute.$get, 200>
type AnalysisDetailResponse = InferResponseType<
  typeof aiAnalysisDetailRoute.$get,
  200
>
type ReanalyzeResponse = InferResponseType<typeof reanalyzeRoute.$post, 202>

export type ProcuracaoAnalysisListItem = ListAnalysesResponse['items'][number]
export type ProcuracaoAnalysisDetail = AnalysisDetailResponse['analysis']

export async function fetchProcuracaoAnalyses(
  processId: string,
): Promise<ListAnalysesResponse> {
  const response = await aiAnalysesRoute.$get({
    param: { processId },
    query: { kind: 'procuracao_conjunto', limit: '5' },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as analises da procuracao.',
      ),
    )
  }

  return (await response.json()) as ListAnalysesResponse
}

export async function fetchProcuracaoAnalysisDetail(
  processId: string,
  id: string,
): Promise<AnalysisDetailResponse> {
  const response = await aiAnalysisDetailRoute.$get({
    param: { processId, id },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(response, 'Nao foi possivel carregar a evidencia.'),
    )
  }

  return (await response.json()) as AnalysisDetailResponse
}

export async function reanalyzeProcuracaoConjuntoRequest(
  processId: string,
): Promise<ReanalyzeResponse> {
  const response = await reanalyzeRoute.$post({ param: { processId } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel iniciar a reanalise da procuracao.',
      ),
    )
  }

  return (await response.json()) as ReanalyzeResponse
}
