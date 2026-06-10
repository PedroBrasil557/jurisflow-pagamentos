import { queryOptions } from '@tanstack/react-query'
import {
  fetchCaixaAnalyses,
  fetchCaixaAnalysisDetail,
} from './caixa-owner.service'

export const caixaOwnerKeys = {
  all: ['caixa-owner'] as const,
  analyses: (processId: string) =>
    [...caixaOwnerKeys.all, 'analyses', processId] as const,
  detail: (processId: string, id: string) =>
    [...caixaOwnerKeys.all, 'detail', processId, id] as const,
}

export function caixaAnalysesOptions(processId: string) {
  return queryOptions({
    queryKey: caixaOwnerKeys.analyses(processId),
    queryFn: () => fetchCaixaAnalyses(processId),
  })
}

export function caixaAnalysisDetailOptions(processId: string, id: string) {
  return queryOptions({
    queryKey: caixaOwnerKeys.detail(processId, id),
    queryFn: () => fetchCaixaAnalysisDetail(processId, id),
  })
}
