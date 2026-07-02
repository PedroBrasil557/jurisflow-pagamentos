import type { InferResponseType } from 'hono/client'
import { apiClient } from '@/shared/services/api-client'
import { getErrorMessage } from '@/shared/services/api-error'

const processRoute = apiClient.api.processes[':processId']
const aiAnalysesRoute = processRoute['ai-analyses']
const aiAnalysisDetailRoute = aiAnalysesRoute[':id']
const reanalyzeRoute = processRoute['caixa-owner'].reanalyze

type ListAnalysesResponse = InferResponseType<typeof aiAnalysesRoute.$get, 200>
type AnalysisDetailResponse = InferResponseType<
  typeof aiAnalysisDetailRoute.$get,
  200
>
type ReanalyzeResponse = InferResponseType<typeof reanalyzeRoute.$post, 202>

export type CaixaAnalysisListItem = ListAnalysesResponse['items'][number]
export type CaixaAnalysisDetail = AnalysisDetailResponse['analysis']

export async function fetchCaixaAnalyses(
  processId: string,
): Promise<ListAnalysesResponse> {
  const response = await aiAnalysesRoute.$get({
    param: { processId },
    // v3: a decisao de ownerType vive na evidencia unica process_derivation (a
    // analise caixa_owner separada foi removida). Mantem alguns legados visiveis.
    query: { kind: 'process_derivation', limit: '5' },
  })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel carregar as analises do contrato Caixa.',
      ),
    )
  }

  return (await response.json()) as ListAnalysesResponse
}

export async function fetchCaixaAnalysisDetail(
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

export async function reanalyzeCaixaOwnerRequest(
  processId: string,
): Promise<ReanalyzeResponse> {
  const response = await reanalyzeRoute.$post({ param: { processId } })

  if (!response.ok) {
    throw new Error(
      await getErrorMessage(
        response,
        'Nao foi possivel iniciar a reanalise do contrato Caixa.',
      ),
    )
  }

  return (await response.json()) as ReanalyzeResponse
}
