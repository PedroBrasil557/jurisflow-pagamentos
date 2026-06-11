import { queryOptions } from '@tanstack/react-query'
import {
  fetchProcuracaoAnalyses,
  fetchProcuracaoAnalysisDetail,
} from './procuracao-conjunto.service'

export const procuracaoConjuntoKeys = {
  all: ['procuracao-conjunto'] as const,
  analyses: (processId: string) =>
    [...procuracaoConjuntoKeys.all, 'analyses', processId] as const,
  detail: (processId: string, id: string) =>
    [...procuracaoConjuntoKeys.all, 'detail', processId, id] as const,
}

export function procuracaoAnalysesOptions(processId: string) {
  return queryOptions({
    queryKey: procuracaoConjuntoKeys.analyses(processId),
    queryFn: () => fetchProcuracaoAnalyses(processId),
  })
}

export function procuracaoAnalysisDetailOptions(processId: string, id: string) {
  return queryOptions({
    queryKey: procuracaoConjuntoKeys.detail(processId, id),
    queryFn: () => fetchProcuracaoAnalysisDetail(processId, id),
  })
}
